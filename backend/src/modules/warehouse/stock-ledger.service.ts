import { ClientSession, Types } from 'mongoose';
import {
  WarehouseStockModel,
  StockBucket,
  BUCKET_FIELD,
} from '../../models/warehouse-stock.model';
import {
  StockMovementModel,
  StockMovementType,
  StockRefType,
  COST_BEARING_TYPES,
} from '../../models/stock-movement.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { ProductModel } from '../../models/product.model';
import { badRequest, notFound } from '../../utils/app-error';
import { withOptionalTransaction } from '../../utils/mongo-session';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { averageCostFromReceipts } from './stock-costing';

/**
 * THE CHOKE POINT.
 *
 * This is the only module in the codebase permitted to write `WarehouseStock` or
 * `Product.quantity`. Everything else — Stock In, transfers, damage claims, orders, returns,
 * stock counts — calls `applyStockMovements` and gets, for free:
 *
 *   • stock can never go negative (guarded `$inc`, not a read-then-write check)
 *   • all-or-nothing multi-line application (compensation, so no half-applied movement)
 *   • replay safety (unique `idempotencyKey` on the ledger)
 *   • an append-only audit row per bucket change, with actor and business date
 *   • `Product.quantity` kept equal to Σ sellable, so every pre-warehouse reader still works
 *   • weighted-average cost recomputed only when a cost-bearing line is involved
 *
 * If you find yourself reaching for `WarehouseStockModel.updateOne` elsewhere, add a movement
 * type instead.
 */

export interface StockMovementLine {
  warehouseId: string;
  productId: string;
  bucket: StockBucket;
  /** Signed, non-zero, whole pieces. */
  delta: number;
  type: StockMovementType;
  /** Only allowed on `COST_BEARING_TYPES`. */
  unitCost?: number;
  /**
   * The movement this line undoes. Per line rather than per call because a cancellation reverses
   * one original row per (warehouse, product, bucket), and `recomputeProductCost` drops a receipt
   * from the weighted average only when it can see the pointer.
   */
  reversalOf?: string;
  refLine?: number;
}

export interface ApplyStockOptions {
  refType: StockRefType;
  refId: string;
  actorId?: string;
  /** Business date for the movement (e.g. the receipt date). Defaults to now. */
  occurredAt?: Date;
  reason?: string;
  reversalOf?: string;
  /**
   * Extra discriminator on the idempotency key. Needed when the same document legitimately
   * moves stock more than once — e.g. a transfer's `approve` then `receive`, or successive
   * edits to one order.
   */
  idempotencyScope?: string;
}

export interface StockBalanceSnapshot {
  warehouseId: string;
  productId: string;
  sellable: number;
  damaged: number;
  inTransit: number;
}

export interface ApplyStockResult {
  movementIds: string[];
  balances: StockBalanceSnapshot[];
  /** True when the idempotency key short-circuited — this operation had already been applied. */
  alreadyApplied: boolean;
}

interface NormalisedLine extends StockMovementLine {
  key: string;
}

interface AppliedLine {
  line: NormalisedLine;
  balanceAfter: number;
}

/**
 * Replay key for one ledger row.
 *
 * The discriminator is (warehouse, product, bucket) — NOT `refLine`. Lines are merged by exactly
 * that triple in `normaliseLines`, so it is unique within a call and stable across replays,
 * whereas `refLine` is optional and every caller that forgot it would make a multi-line movement
 * collide with itself and look like a replay.
 */
function idempotencyKeyFor(line: NormalisedLine, opts: ApplyStockOptions): string {
  const parts = [opts.refType, opts.refId];
  if (opts.idempotencyScope) parts.push(opts.idempotencyScope);
  parts.push(line.type, line.warehouseId, line.productId, line.bucket);
  return parts.join(':');
}

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: number }).code === 11000);
}

/**
 * Merge duplicate (warehouse, product, bucket) lines, reject anything that is not a whole
 * non-zero piece count, and sort into one global order so two concurrent multi-line movements
 * always touch documents in the same sequence.
 */
function normaliseLines(lines: StockMovementLine[]): NormalisedLine[] {
  if (lines.length === 0) throw badRequest('No stock lines to apply');

  const merged = new Map<string, NormalisedLine>();

  for (const line of lines) {
    if (!Number.isInteger(line.delta)) {
      throw badRequest('Stock is counted in whole pieces — fractional quantities are not allowed');
    }
    if (line.delta === 0) continue;
    if (line.unitCost !== undefined && !COST_BEARING_TYPES.includes(line.type)) {
      // Structural guarantee: only receipts can shift average cost. A transfer or a write-off
      // carrying a rate would silently re-price inventory.
      throw badRequest(`Movement type "${line.type}" may not carry a unit cost`);
    }
    if (line.unitCost !== undefined && (!Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      throw badRequest('Unit cost must be zero or more');
    }

    const key = `${line.warehouseId}:${line.productId}:${line.bucket}`;
    const existing = merged.get(key);
    if (existing) {
      existing.delta += line.delta;
    } else {
      merged.set(key, { ...line, key });
    }
  }

  const result = [...merged.values()].filter((l) => l.delta !== 0);
  if (result.length === 0) throw badRequest('No stock lines to apply');

  result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return result;
}

/** One `$in` per collection so a bad reference fails before anything is written. */
async function validateReferences(lines: NormalisedLine[], session?: ClientSession) {
  const warehouseIds = [...new Set(lines.map((l) => l.warehouseId))];
  const productIds = [...new Set(lines.map((l) => l.productId))];

  const warehouses = await WarehouseModel.find({
    _id: { $in: warehouseIds },
    isTrashed: { $ne: true },
  })
    .select('_id name isActive')
    .session(session ?? null)
    .lean();

  if (warehouses.length !== warehouseIds.length) {
    throw notFound('One or more warehouses could not be found');
  }
  const inactive = warehouses.find((w) => w.isActive === false);
  if (inactive) {
    throw badRequest(`Warehouse "${inactive.name}" is inactive and cannot move stock`);
  }

  const products = await ProductModel.find({
    _id: { $in: productIds },
    isTrashed: { $ne: true },
  })
    .select('_id name')
    .session(session ?? null)
    .lean();

  if (products.length !== productIds.length) {
    throw notFound('One or more products could not be found');
  }

  return {
    warehouseNames: new Map(warehouses.map((w) => [String(w._id), w.name])),
    productNames: new Map(products.map((p) => [String(p._id), p.name])),
  };
}

/**
 * Undo what this request already did. Deliberately unguarded (the stock was ours a moment ago)
 * and deliberately never throws — a failed compensation must not mask the original error, so it
 * is logged loudly and flagged for reconciliation instead.
 */
async function compensate(applied: AppliedLine[], opts: ApplyStockOptions, session?: ClientSession) {
  for (const { line } of [...applied].reverse()) {
    try {
      await WarehouseStockModel.findOneAndUpdate(
        { warehouseId: line.warehouseId, productId: line.productId },
        { $inc: { [BUCKET_FIELD[line.bucket]]: -line.delta } },
        { session },
      );
    } catch (err) {
      console.error('STOCK COMPENSATION FAILED — manual reconciliation required', {
        refType: opts.refType,
        refId: opts.refId,
        line,
        err,
      });
      logActivityAsync({
        employeeId: opts.actorId,
        module: 'stock',
        entityId: opts.refId,
        action: 'flagged',
        meta: {
          reconciliationNeeded: true,
          warehouseId: line.warehouseId,
          productId: line.productId,
          bucket: line.bucket,
          delta: line.delta,
          error: String(err),
        },
      });
    }
  }
}

/** Apply one bucket delta, guarded so the bucket can never go below zero. */
async function applyOne(
  line: NormalisedLine,
  names: { warehouseNames: Map<string, string>; productNames: Map<string, string> },
  session?: ClientSession,
): Promise<number> {
  const field = BUCKET_FIELD[line.bucket];

  if (line.delta > 0) {
    // `$setOnInsert` must NOT name the field `$inc` touches ("would create a conflict"), so seed
    // only the identity and the OTHER buckets; `$inc` creates its own field from an implicit 0.
    const otherBuckets = (['sellable', 'damaged', 'inTransit'] as const).filter((b) => b !== field);
    const doc = await WarehouseStockModel.findOneAndUpdate(
      { warehouseId: line.warehouseId, productId: line.productId },
      {
        $inc: { [field]: line.delta },
        $set: { lastMovementAt: new Date() },
        $setOnInsert: {
          warehouseId: new Types.ObjectId(line.warehouseId),
          productId: new Types.ObjectId(line.productId),
          ...Object.fromEntries(otherBuckets.map((b) => [b, 0])),
        },
      },
      { new: true, upsert: true, session },
    );
    return (doc as unknown as Record<string, number>)[field];
  }

  const required = -line.delta;
  const doc = await WarehouseStockModel.findOneAndUpdate(
    { warehouseId: line.warehouseId, productId: line.productId, [field]: { $gte: required } },
    { $inc: { [field]: line.delta }, $set: { lastMovementAt: new Date() } },
    { new: true, session },
  );

  if (!doc) {
    const current = await WarehouseStockModel.findOne({
      warehouseId: line.warehouseId,
      productId: line.productId,
    })
      .session(session ?? null)
      .lean();
    const available = current ? (current as unknown as Record<string, number>)[field] ?? 0 : 0;
    const bucketLabel = line.bucket === 'in_transit' ? 'in-transit' : line.bucket;
    throw badRequest(
      `Insufficient ${bucketLabel} stock for "${names.productNames.get(line.productId) ?? line.productId}" ` +
        `at "${names.warehouseNames.get(line.warehouseId) ?? line.warehouseId}". ` +
        `Available: ${available}, required: ${required}.`,
    );
  }

  return (doc as unknown as Record<string, number>)[field];
}

/**
 * Recompute `Product.quantity` from the balance documents.
 *
 * Always an absolute `$set` over a fresh aggregate, never an `$inc` of a delta: a lost or
 * duplicated mirror write then self-heals on the next movement, whereas an `$inc`-built mirror
 * drifts forever. `updateOne` (not `save()`) because `save()` runs the `min: 0` validator and
 * would throw mid-movement if the value were ever negative.
 */
export async function syncProductQuantityMirror(
  productIds: string[],
  session?: ClientSession,
): Promise<void> {
  const unique = [...new Set(productIds)];

  for (const productId of unique) {
    const rows = await WarehouseStockModel.aggregate([
      { $match: { productId: new Types.ObjectId(productId) } },
      // Both mirrors come out of the SAME group — the damaged total costs no extra round trip.
      { $group: { _id: null, total: { $sum: '$sellable' }, damaged: { $sum: '$damaged' } } },
    ]).session(session ?? null);

    const total = rows[0]?.total ?? 0;
    const damaged = rows[0]?.damaged ?? 0;
    await ProductModel.updateOne(
      { _id: productId },
      { $set: { quantity: Math.max(0, total), damagedQuantity: Math.max(0, damaged) } },
      { session },
    );
  }
}

/**
 * Recompute a product's weighted-average cost from its live receipt history, and refresh the
 * `lastPurchaseRate` reference. Reversed receipts are excluded — the formula is never run
 * backwards, because a moving average is not invertible once later receipts have landed.
 */
export async function recomputeProductCost(
  productId: string,
  session?: ClientSession,
): Promise<void> {
  const receipts = await StockMovementModel.find({
    productId: new Types.ObjectId(productId),
    type: { $in: COST_BEARING_TYPES },
    delta: { $gt: 0 },
    unitCost: { $gt: 0 },
  })
    .select('_id delta unitCost occurredAt')
    .sort({ occurredAt: -1, _id: -1 })
    .session(session ?? null)
    .lean();

  if (receipts.length === 0) return;

  const reversed = await StockMovementModel.find({
    reversalOf: { $in: receipts.map((r) => r._id) },
  })
    .select('reversalOf')
    .session(session ?? null)
    .lean();
  const reversedIds = new Set(reversed.map((r) => String(r.reversalOf)));

  const live = receipts.filter((r) => !reversedIds.has(String(r._id)));
  if (live.length === 0) return;

  const avgCost = averageCostFromReceipts(
    live.map((r) => ({ qty: r.delta, rate: r.unitCost ?? 0 })),
  );

  await ProductModel.updateOne(
    { _id: productId },
    { $set: { purchasePrice: avgCost, lastPurchaseRate: live[0].unitCost ?? 0 } },
    { session },
  );
}

/**
 * Apply a set of stock movements atomically (or compensated), write the ledger, keep the mirror
 * and the average cost in step, and log the action.
 */
export async function applyStockMovements(
  lines: StockMovementLine[],
  opts: ApplyStockOptions,
): Promise<ApplyStockResult> {
  const normalised = normaliseLines(lines);
  const occurredAt = opts.occurredAt ?? new Date();

  return withOptionalTransaction(async (session) => {
    const names = await validateReferences(normalised, session);

    const applied: AppliedLine[] = [];
    try {
      for (const line of normalised) {
        const balanceAfter = await applyOne(line, names, session);
        applied.push({ line, balanceAfter });
      }

      const ledgerRows = applied.map(({ line, balanceAfter }) => ({
        warehouseId: new Types.ObjectId(line.warehouseId),
        productId: new Types.ObjectId(line.productId),
        bucket: line.bucket,
        delta: line.delta,
        balanceAfter,
        type: line.type,
        refType: opts.refType,
        refId: Types.ObjectId.isValid(opts.refId) ? new Types.ObjectId(opts.refId) : undefined,
        refLine: line.refLine,
        ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
        ...(line.reversalOf || opts.reversalOf
          ? { reversalOf: new Types.ObjectId(line.reversalOf ?? opts.reversalOf) }
          : {}),
        ...(opts.reason ? { reason: opts.reason } : {}),
        ...(opts.actorId ? { actorId: new Types.ObjectId(opts.actorId) } : {}),
        occurredAt,
        idempotencyKey: idempotencyKeyFor(line, opts),
      }));

      let movementIds: string[];
      try {
        const inserted = await StockMovementModel.insertMany(ledgerRows, {
          ordered: false,
          session: session ?? undefined,
        });
        movementIds = inserted.map((m) => String(m._id));
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          // This exact operation already ran (a replayed request, a retried webhook). Undo the
          // second application and hand back the original movements.
          await compensate(applied, opts, session);
          const existing = await StockMovementModel.find({
            idempotencyKey: { $in: ledgerRows.map((r) => r.idempotencyKey) },
          })
            .select('_id')
            .session(session ?? null)
            .lean();
          return {
            movementIds: existing.map((m) => String(m._id)),
            balances: await readBalances(normalised, session),
            alreadyApplied: true,
          };
        }
        throw err;
      }

      const productIds = [...new Set(normalised.map((l) => l.productId))];

      // A reversal carries no rate of its own — it can't, only receipts may — so without this second
      // condition cancelling a Stock In would leave the cancelled rate weighting the average forever.
      const touchesCost = normalised.some(
        (l) => l.unitCost !== undefined || l.reversalOf !== undefined,
      );
      if (touchesCost) {
        for (const productId of productIds) {
          await recomputeProductCost(productId, session);
        }
      }

      await syncProductQuantityMirror(productIds, session);

      logActivityAsync({
        employeeId: opts.actorId,
        module: 'stock',
        entityId: opts.refId,
        action: 'stock_moved',
        meta: {
          refType: opts.refType,
          reason: opts.reason,
          lines: normalised.map((l) => ({
            warehouseId: l.warehouseId,
            productId: l.productId,
            bucket: l.bucket,
            delta: l.delta,
            type: l.type,
          })),
        },
      });

      return {
        movementIds,
        balances: await readBalances(normalised, session),
        alreadyApplied: false,
      };
    } catch (err) {
      await compensate(applied, opts, session);
      throw err;
    }
  });
}

async function readBalances(
  lines: NormalisedLine[],
  session?: ClientSession,
): Promise<StockBalanceSnapshot[]> {
  const pairs = [...new Set(lines.map((l) => `${l.warehouseId}:${l.productId}`))];
  const out: StockBalanceSnapshot[] = [];

  for (const pair of pairs) {
    const [warehouseId, productId] = pair.split(':');
    const doc = await WarehouseStockModel.findOne({ warehouseId, productId })
      .session(session ?? null)
      .lean();
    out.push({
      warehouseId,
      productId,
      sellable: doc?.sellable ?? 0,
      damaged: doc?.damaged ?? 0,
      inTransit: doc?.inTransit ?? 0,
    });
  }

  return out;
}

/** Current buckets for one warehouse+product. Zeroes when no balance row exists yet. */
export async function getStockBalance(
  warehouseId: string,
  productId: string,
): Promise<{ sellable: number; damaged: number; inTransit: number }> {
  const doc = await WarehouseStockModel.findOne({ warehouseId, productId }).lean();
  return {
    sellable: doc?.sellable ?? 0,
    damaged: doc?.damaged ?? 0,
    inTransit: doc?.inTransit ?? 0,
  };
}

/**
 * The rows a document already posted, keyed by `productId:bucket`.
 *
 * A cancellation uses this to point each reversing line at the exact row it undoes, which is what
 * lets `recomputeProductCost` drop a cancelled receipt out of the weighted average. It also answers
 * "did this document ever actually move stock?" — a claim auto-created alongside a return has not,
 * and must not be reversed as though it had.
 *
 * **The sort is load-bearing.** A document used to post exactly one row per (product, bucket), so
 * the map had a single candidate and order never mattered. Editing a Stock In receipt reverses and
 * re-posts against the SAME `refId`, so a product can now carry several `stock_in` rows. Building
 * the map from an unsorted find would leave the winner up to whichever index the planner picked.
 * Ascending `_id` means the newest row wins (later entries overwrite in a Map), which is the one a
 * subsequent cancel or delete has to reverse — the earlier rows already carry their own reversals.
 */
export async function findPostedMovementIds(
  refType: StockRefType,
  refId: string,
  types: StockMovementType[],
): Promise<Map<string, string>> {
  const rows = await StockMovementModel.find({
    refType,
    refId: new Types.ObjectId(refId),
    type: { $in: types },
  })
    .select('_id productId bucket')
    .sort({ _id: 1 })
    .lean();

  return new Map(rows.map((r) => [`${String(r.productId)}:${r.bucket}`, String(r._id)]));
}

export interface MovementHistoryFilters {
  productId?: string;
  warehouseId?: string;
  warehouseIds?: string[];
  bucket?: string;
  type?: string;
  refType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/** Movement history — "everything that happened to this product" (spec report 1). */
export async function getMovementHistory(filters: MovementHistoryFilters = {}) {
  const query: Record<string, unknown> = {};

  if (filters.productId) query.productId = new Types.ObjectId(filters.productId);
  if (filters.warehouseId) {
    query.warehouseId = new Types.ObjectId(filters.warehouseId);
  } else if (filters.warehouseIds) {
    query.warehouseId = { $in: filters.warehouseIds.map((id) => new Types.ObjectId(id)) };
  }
  if (filters.bucket) query.bucket = filters.bucket;
  if (filters.type) query.type = filters.type;
  if (filters.refType) query.refType = filters.refType;

  if (filters.startDate || filters.endDate) {
    const range: Record<string, Date> = {};
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      start.setUTCHours(0, 0, 0, 0);
      range.$gte = start;
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setUTCHours(23, 59, 59, 999);
      range.$lte = end;
    }
    query.occurredAt = range;
  }

  return StockMovementModel.find(query)
    .populate('warehouseId', 'name city isMain')
    .populate('productId', 'name barcode')
    .populate('actorId', 'username fullName userID')
    .sort({ occurredAt: -1, _id: -1 })
    .limit(Math.min(filters.limit ?? 500, 5000))
    .lean();
}

export interface IntegrityRow {
  kind: 'mirror_drift' | 'ledger_drift';
  productId: string;
  productName?: string;
  warehouseId?: string;
  bucket?: string;
  /** Which mirror drifted. Only set on `mirror_drift` rows. */
  field?: 'quantity' | 'damagedQuantity';
  expected: number;
  actual: number;
}

/**
 * The drift detector. Three independent equalities must hold:
 *   A. `Product.quantity === Σ WarehouseStock.sellable`
 *   A'. `Product.damagedQuantity === Σ WarehouseStock.damaged`
 *   B. `WarehouseStock[bucket] === Σ StockMovement.delta` for that warehouse+product+bucket
 *
 * A non-empty result means some write path bypassed this service.
 */
export async function getIntegrityReport(): Promise<IntegrityRow[]> {
  const rows: IntegrityRow[] = [];

  // Both mirrors are checked independently, so a report can say WHICH one drifted rather than
  // just that the product is wrong — they have separate writers' worth of blast radius even
  // though one function writes both today.
  const mirrorDrift = await WarehouseStockModel.aggregate([
    {
      $group: {
        _id: '$productId',
        sellable: { $sum: '$sellable' },
        damaged: { $sum: '$damaged' },
      },
    },
    {
      $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' },
    },
    { $unwind: '$product' },
    {
      $match: {
        $expr: {
          $or: [
            { $ne: ['$sellable', { $ifNull: ['$product.quantity', 0] }] },
            { $ne: ['$damaged', { $ifNull: ['$product.damagedQuantity', 0] }] },
          ],
        },
      },
    },
    {
      $project: {
        productId: '$_id',
        productName: '$product.name',
        sellable: 1,
        damaged: 1,
        mirror: { $ifNull: ['$product.quantity', 0] },
        damagedMirror: { $ifNull: ['$product.damagedQuantity', 0] },
      },
    },
  ]);

  for (const row of mirrorDrift) {
    if (row.sellable !== row.mirror) {
      rows.push({
        kind: 'mirror_drift',
        productId: String(row.productId),
        productName: row.productName,
        field: 'quantity',
        expected: row.sellable,
        actual: row.mirror,
      });
    }
    if (row.damaged !== row.damagedMirror) {
      rows.push({
        kind: 'mirror_drift',
        productId: String(row.productId),
        productName: row.productName,
        field: 'damagedQuantity',
        expected: row.damaged,
        actual: row.damagedMirror,
      });
    }
  }

  const ledgerTotals = await StockMovementModel.aggregate([
    {
      $group: {
        _id: { warehouseId: '$warehouseId', productId: '$productId', bucket: '$bucket' },
        net: { $sum: '$delta' },
      },
    },
  ]);

  const balances = await WarehouseStockModel.find({}).lean();
  const balanceMap = new Map<string, Record<string, number>>();
  for (const b of balances) {
    balanceMap.set(`${String(b.warehouseId)}:${String(b.productId)}`, {
      sellable: b.sellable,
      damaged: b.damaged,
      in_transit: b.inTransit,
    });
  }

  for (const row of ledgerTotals) {
    const key = `${String(row._id.warehouseId)}:${String(row._id.productId)}`;
    const actual = balanceMap.get(key)?.[row._id.bucket] ?? 0;
    if (actual !== row.net) {
      rows.push({
        kind: 'ledger_drift',
        productId: String(row._id.productId),
        warehouseId: String(row._id.warehouseId),
        bucket: row._id.bucket,
        expected: row.net,
        actual,
      });
    }
  }

  return rows;
}

/** Repair tool: rebuild every product mirror from the balance documents. */
export async function resyncMirror(productIds?: string[]): Promise<{ updated: number }> {
  const ids = productIds?.length
    ? productIds
    : (await ProductModel.find({}).select('_id').lean()).map((p) => String(p._id));
  await syncProductQuantityMirror(ids);
  return { updated: ids.length };
}
