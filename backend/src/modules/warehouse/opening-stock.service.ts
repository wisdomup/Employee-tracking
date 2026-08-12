import { Types } from 'mongoose';
import { OpeningStockModel } from '../../models/opening-stock.model';
import { badRequest, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  applyStockMovements,
  findPostedMovementIds,
  StockMovementLine,
} from './stock-ledger.service';

/**
 * One-time starting stock (spec §11): "when the module goes live, existing physical stock is
 * entered once — per warehouse, per product, split as Sellable / Damaged / Claim, with quantity
 * and rate".
 *
 * The rate matters: opening stock is stock you paid for, so it seeds the weighted-average cost.
 * Both the sellable and the damaged pieces are weighted — damage is a value writedown reported
 * separately, not a change to what the goods cost.
 *
 * "One-time" is enforced by a unique partial index on posted rows: one ROW per warehouse+product,
 * for as long as it stands. Two ways to correct it:
 *   • edit  — `updateOpeningStock` reverses the old movement and re-posts the new figures against
 *             the same row, so the ledger shows both halves and the average cost follows.
 *   • cancel — reverses the movement and frees the slot so the pair can be entered afresh.
 *
 * Movements are stamped `refId = warehouseId` (NOT the entry id), because a whole warehouse's
 * lines post in one call. Anything looking for the rows an entry posted therefore has to search by
 * warehouse and pick out its own product — `buildReversalLines` is the single place that does it.
 */

interface OpeningStockLineInput {
  productId: string;
  sellableQty: number;
  damagedQty?: number;
  rate?: number;
}

/** The `opening_stock` ledger lines one entry's figures produce. Zero-quantity buckets post nothing. */
function buildPostLines(
  warehouseId: string,
  productId: string,
  qty: { sellableQty: number; damagedQty: number; rate: number },
  refLineBase = 0,
): StockMovementLine[] {
  const lines: StockMovementLine[] = [];
  if (qty.sellableQty > 0) {
    lines.push({
      warehouseId,
      productId,
      bucket: 'sellable',
      delta: qty.sellableQty,
      type: 'opening_stock',
      ...(qty.rate > 0 ? { unitCost: qty.rate } : {}),
      refLine: refLineBase,
    });
  }
  if (qty.damagedQty > 0) {
    lines.push({
      warehouseId,
      productId,
      bucket: 'damaged',
      delta: qty.damagedQty,
      type: 'opening_stock',
      ...(qty.rate > 0 ? { unitCost: qty.rate } : {}),
      refLine: refLineBase + 1,
    });
  }
  return lines;
}

/**
 * The lines that undo what one entry currently has applied.
 *
 * Each reversing line names the row it undoes: opening stock is cost-bearing, so without the
 * pointer `recomputeProductCost` cannot drop the old rate out of the weighted average. The lookup
 * is by WAREHOUSE — that is the `refId` the posting side writes — and the newest `opening_stock`
 * row per (product, bucket) wins, which after an earlier edit is the re-posted one.
 */
async function buildReversalLines(doc: {
  warehouseId: unknown;
  productId: unknown;
  sellableQty: number;
  damagedQty: number;
}): Promise<StockMovementLine[]> {
  const warehouseId = String(doc.warehouseId);
  const productId = String(doc.productId);
  const posted = await findPostedMovementIds('opening_stock', warehouseId, ['opening_stock']);

  const lines: StockMovementLine[] = [];
  if (doc.sellableQty > 0) {
    lines.push({
      warehouseId,
      productId,
      bucket: 'sellable',
      delta: -doc.sellableQty,
      type: 'manual_adjustment',
      ...(posted.get(`${productId}:sellable`)
        ? { reversalOf: posted.get(`${productId}:sellable`) }
        : {}),
      refLine: 0,
    });
  }
  if (doc.damagedQty > 0) {
    lines.push({
      warehouseId,
      productId,
      bucket: 'damaged',
      delta: -doc.damagedQty,
      type: 'manual_adjustment',
      ...(posted.get(`${productId}:damaged`)
        ? { reversalOf: posted.get(`${productId}:damaged`) }
        : {}),
      refLine: 1,
    });
  }
  return lines;
}

/**
 * Write one warehouse's entries and move the stock.
 *
 * The documents are written first so each has an id, then the stock moves in ONE call — a failure
 * part-way through leaves no stock applied and the documents are removed again.
 */
async function createEntries(
  warehouseId: string,
  usable: OpeningStockLineInput[],
  effectiveAt: Date,
  userId: string,
) {
  const docs = await OpeningStockModel.create(
    usable.map((l) => ({
      warehouseId: new Types.ObjectId(warehouseId),
      productId: new Types.ObjectId(l.productId),
      sellableQty: l.sellableQty ?? 0,
      damagedQty: l.damagedQty ?? 0,
      rate: l.rate ?? 0,
      effectiveAt,
      status: 'posted',
      createdBy: new Types.ObjectId(userId),
    })),
  );

  const lines = docs.flatMap((doc, index) =>
    buildPostLines(
      warehouseId,
      String(doc.productId),
      { sellableQty: doc.sellableQty, damagedQty: doc.damagedQty, rate: doc.rate },
      index * 2,
    ),
  );

  try {
    await applyStockMovements(lines, {
      refType: 'opening_stock',
      refId: warehouseId,
      actorId: userId,
      occurredAt: effectiveAt,
      idempotencyScope: String(docs[0]._id),
    });
  } catch (err) {
    await OpeningStockModel.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
    throw err;
  }

  return docs;
}

export async function postOpeningStock(
  data: { warehouseId: string; effectiveAt?: Date; lines: OpeningStockLineInput[] },
  userId: string,
) {
  const effectiveAt = data.effectiveAt ?? new Date();

  const usable = data.lines.filter(
    (l) => (l.sellableQty ?? 0) > 0 || (l.damagedQty ?? 0) > 0,
  );
  if (usable.length === 0) {
    throw badRequest('Enter a quantity for at least one product');
  }

  const productIds = usable.map((l) => l.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('The same product appears more than once');
  }

  const alreadyPosted = await OpeningStockModel.find({
    warehouseId: data.warehouseId,
    productId: { $in: productIds },
    status: 'posted',
  })
    .populate('productId', 'name')
    .lean();

  if (alreadyPosted.length > 0) {
    const names = alreadyPosted
      .map((r) => (r.productId as unknown as { name?: string })?.name ?? String(r.productId))
      .join(', ');
    throw badRequest(
      `Opening stock has already been entered at this warehouse for: ${names}. Edit those entries from the warehouse grid, cancel them, or use Stock In.`,
    );
  }

  const docs = await createEntries(data.warehouseId, usable, effectiveAt, userId);

  logActivityAsync({
    employeeId: userId,
    module: 'opening_stock',
    entityId: String(data.warehouseId),
    action: 'created',
    meta: { warehouseId: data.warehouseId, lines: docs.length },
  });

  return { message: `Opening stock posted for ${docs.length} product(s)`, count: docs.length };
}

/**
 * Correct a posted entry's figures in place.
 *
 * The old movement is reversed and the new one posted against the same row, so the average cost
 * follows the corrected rate and the ledger keeps both halves. Setting both quantities to zero is
 * legal and simply reverses everything — the row stays posted, holding the slot; use cancel to
 * free it.
 */
export async function updateOpeningStock(
  id: string,
  data: { sellableQty: number; damagedQty: number; rate?: number; reason?: string },
  actorId: string,
) {
  const doc = await OpeningStockModel.findById(id);
  if (!doc) throw notFound('Opening stock entry not found');
  if (doc.status === 'cancelled') {
    throw badRequest('A cancelled entry cannot be edited — enter the opening stock again instead');
  }

  const next = {
    sellableQty: data.sellableQty,
    damagedQty: data.damagedQty,
    rate: data.rate ?? doc.rate,
  };
  const before = { sellableQty: doc.sellableQty, damagedQty: doc.damagedQty, rate: doc.rate };
  if (
    before.sellableQty === next.sellableQty &&
    before.damagedQty === next.damagedQty &&
    before.rate === next.rate
  ) {
    return doc;
  }

  const warehouseId = String(doc.warehouseId);
  const productId = String(doc.productId);
  const reason = data.reason ?? 'Opening stock edited';

  // Same trick as a Stock In edit: the pre-edit `updatedAt` is unique per edit and identical
  // across retries of the same one, which is exactly what the idempotency scope needs.
  const stamp = doc.updatedAt ? new Date(doc.updatedAt).toISOString() : String(Date.now());
  const scope = `${String(doc._id)}:${stamp}`;

  const reversalLines = await buildReversalLines(doc);
  if (reversalLines.length > 0) {
    await applyStockMovements(reversalLines, {
      refType: 'opening_stock',
      refId: warehouseId,
      actorId,
      reason,
      idempotencyScope: `edit-reverse:${scope}`,
    });
  }

  const newLines = buildPostLines(warehouseId, productId, next);
  try {
    if (newLines.length > 0) {
      await applyStockMovements(newLines, {
        refType: 'opening_stock',
        refId: warehouseId,
        actorId,
        occurredAt: doc.effectiveAt,
        reason,
        idempotencyScope: `edit-apply:${scope}`,
      });
    }
  } catch (err) {
    // Put the original figures back rather than leaving the entry silently reversed.
    const restoreLines = buildPostLines(warehouseId, productId, before);
    if (restoreLines.length > 0 && reversalLines.length > 0) {
      await applyStockMovements(restoreLines, {
        refType: 'opening_stock',
        refId: warehouseId,
        actorId,
        occurredAt: doc.effectiveAt,
        reason: 'Edit failed — original opening stock restored',
        idempotencyScope: `edit-restore:${scope}`,
      });
    }

    // Burn the stamp. Nothing was saved, so a retry would reuse this scope — and
    // `edit-reverse:<scope>` is now a REPLAY that moves no stock, so the retry's re-apply would
    // land on top of the stock just restored and double it. Recording the failed attempt moves
    // `updatedAt` on, so the next attempt reverses for real.
    doc.lastEditFailedAt = new Date();
    await doc.save();

    throw err;
  }

  doc.sellableQty = next.sellableQty;
  doc.damagedQty = next.damagedQty;
  doc.rate = next.rate;
  doc.lastEditedBy = new Types.ObjectId(actorId);
  doc.lastEditedAt = new Date();
  doc.editReason = data.reason;
  doc.editCount = (doc.editCount ?? 0) + 1;
  await doc.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'opening_stock',
    entityId: String(doc._id),
    action: 'updated',
    changes: {
      sellableQty: { from: before.sellableQty, to: next.sellableQty },
      damagedQty: { from: before.damagedQty, to: next.damagedQty },
      rate: { from: before.rate, to: next.rate },
    },
    meta: { warehouseId, productId, reason: data.reason },
  });

  return doc;
}

export async function findAllOpeningStock(filters: { warehouseId?: string; status?: string } = {}) {
  const query: Record<string, unknown> = {};
  if (filters.warehouseId) query.warehouseId = new Types.ObjectId(filters.warehouseId);
  query.status = filters.status ?? 'posted';

  return OpeningStockModel.find(query)
    .populate('warehouseId', 'name city isMain')
    .populate('productId', 'name barcode')
    .populate('createdBy', 'username fullName userID')
    .sort({ createdAt: -1 })
    .lean();
}

/** Has this warehouse had its opening stock entered? Drives the locked state on the setup screen. */
export async function getOpeningStockStatus(warehouseId: string) {
  const posted = await OpeningStockModel.find({ warehouseId, status: 'posted' })
    .select('createdAt createdBy productId')
    .populate('createdBy', 'username fullName userID')
    .sort({ createdAt: 1 })
    .lean();

  return {
    warehouseId,
    locked: posted.length > 0,
    productCount: posted.length,
    submittedAt: posted[0]?.createdAt ?? null,
    submittedBy: posted[0]?.createdBy ?? null,
    /** Products already covered — the setup screen greys these rows out. */
    postedProductIds: posted.map((p) => String(p.productId)),
  };
}

/** Cancel an opening-stock entry: reverse the movement and free the one-time slot. */
export async function cancelOpeningStock(id: string, reason: string, actorId: string) {
  const doc = await OpeningStockModel.findById(id);
  if (!doc) throw notFound('Opening stock entry not found');
  if (doc.status === 'cancelled') throw badRequest('This entry has already been cancelled');

  // Opening stock is cost-bearing, so each reversing line has to name the row it undoes — otherwise
  // the cancelled rate keeps weighting the product's average cost. The rows are found by warehouse,
  // which is what the posting side stamps as `refId`.
  const lines = await buildReversalLines(doc);

  if (lines.length > 0) {
    await applyStockMovements(lines, {
      refType: 'opening_stock',
      refId: String(doc._id),
      actorId,
      reason,
      idempotencyScope: 'cancel',
    });
  }

  doc.status = 'cancelled';
  doc.cancelledBy = new Types.ObjectId(actorId);
  doc.cancelledAt = new Date();
  doc.cancelReason = reason;
  await doc.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'opening_stock',
    entityId: String(doc._id),
    action: 'cancelled',
    meta: { warehouseId: String(doc.warehouseId), productId: String(doc.productId), reason },
  });

  return doc;
}

// ------------------------------------------------------------------ all-warehouse grid

/**
 * Every posted entry, flattened for the product × warehouse grid on the setup screen.
 *
 * Deliberately unpopulated and id-keyed: the screen already holds the product and warehouse lists,
 * and populating them again for what can be hundreds of cells is wasted payload.
 */
export async function getOpeningStockMatrix() {
  const rows = await OpeningStockModel.find({ status: 'posted' })
    .select('warehouseId productId sellableQty damagedQty rate effectiveAt')
    .lean();

  return rows.map((r) => ({
    _id: String(r._id),
    warehouseId: String(r.warehouseId),
    productId: String(r.productId),
    sellableQty: r.sellableQty,
    damagedQty: r.damagedQty,
    rate: r.rate,
    effectiveAt: r.effectiveAt,
  }));
}

export interface OpeningStockCellInput {
  warehouseId: string;
  productId: string;
  sellableQty: number;
  damagedQty: number;
  rate?: number;
}

/**
 * Save the grid: create the cells that have no entry yet, edit the ones whose figures changed.
 *
 * The client sends only the cells it touched, but the decision of what each one MEANS is taken
 * here against the database — a stale grid must not be able to re-post a product that someone else
 * entered in the meantime, nor silently blank one it never saw.
 *
 * One bad cell does not abandon the rest. A cell whose stock cannot move (a correction that would
 * drive a bucket negative, say) is collected into `failed` and the save carries on, because the
 * alternative — aborting a fifty-cell grid on the last row — leaves the operator guessing what
 * landed. Creates are grouped per warehouse and stay all-or-nothing WITHIN that warehouse, which is
 * the same guarantee the single-warehouse screen gives.
 */
export async function saveOpeningStockMatrix(
  data: { effectiveAt?: Date; reason?: string; cells: OpeningStockCellInput[] },
  userId: string,
) {
  const effectiveAt = data.effectiveAt ?? new Date();
  if (data.cells.length === 0) throw badRequest('Nothing to save — no cell was changed');

  const seen = new Set<string>();
  for (const cell of data.cells) {
    const key = `${cell.warehouseId}:${cell.productId}`;
    if (seen.has(key)) {
      throw badRequest('The same product appears more than once for a warehouse');
    }
    seen.add(key);
  }

  const existing = await OpeningStockModel.find({
    warehouseId: { $in: [...new Set(data.cells.map((c) => c.warehouseId))] },
    productId: { $in: [...new Set(data.cells.map((c) => c.productId))] },
    status: 'posted',
  })
    .select('warehouseId productId sellableQty damagedQty rate')
    .lean();

  const priorByKey = new Map(
    existing.map((e) => [`${String(e.warehouseId)}:${String(e.productId)}`, e]),
  );

  const creates = new Map<string, OpeningStockLineInput[]>();
  const edits: { id: string; cell: OpeningStockCellInput }[] = [];
  let skipped = 0;

  for (const cell of data.cells) {
    const prior = priorByKey.get(`${cell.warehouseId}:${cell.productId}`);
    const rate = cell.rate ?? prior?.rate ?? 0;

    if (!prior) {
      // Nothing to record for an empty cell that never had an entry.
      if (cell.sellableQty <= 0 && cell.damagedQty <= 0) {
        skipped += 1;
        continue;
      }
      const group = creates.get(cell.warehouseId) ?? [];
      group.push({
        productId: cell.productId,
        sellableQty: cell.sellableQty,
        damagedQty: cell.damagedQty,
        rate,
      });
      creates.set(cell.warehouseId, group);
      continue;
    }

    if (
      prior.sellableQty === cell.sellableQty &&
      prior.damagedQty === cell.damagedQty &&
      prior.rate === rate
    ) {
      skipped += 1;
      continue;
    }
    edits.push({ id: String(prior._id), cell: { ...cell, rate } });
  }

  const failed: { warehouseId: string; productId?: string; message: string }[] = [];
  let created = 0;
  let updated = 0;

  for (const [warehouseId, lines] of creates) {
    try {
      const docs = await createEntries(warehouseId, lines, effectiveAt, userId);
      created += docs.length;
    } catch (err) {
      failed.push({
        warehouseId,
        message: err instanceof Error ? err.message : 'Could not post these lines',
      });
    }
  }

  for (const edit of edits) {
    try {
      await updateOpeningStock(
        edit.id,
        {
          sellableQty: edit.cell.sellableQty,
          damagedQty: edit.cell.damagedQty,
          rate: edit.cell.rate,
          reason: data.reason,
        },
        userId,
      );
      updated += 1;
    } catch (err) {
      failed.push({
        warehouseId: edit.cell.warehouseId,
        productId: edit.cell.productId,
        message: err instanceof Error ? err.message : 'Could not update this entry',
      });
    }
  }

  logActivityAsync({
    employeeId: userId,
    module: 'opening_stock',
    entityId: 'matrix',
    action: 'updated',
    meta: { created, updated, skipped, failed: failed.length, reason: data.reason },
  });

  const parts: string[] = [];
  if (created > 0) parts.push(`${created} entered`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (failed.length > 0) parts.push(`${failed.length} failed`);
  if (parts.length === 0) parts.push('nothing changed');

  return {
    message: `Opening stock saved — ${parts.join(', ')}`,
    created,
    updated,
    skipped,
    failed,
  };
}
