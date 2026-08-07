import { Types } from 'mongoose';
import { StockCountModel, IStockCountLine } from '../../models/stock-count.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { ProductModel } from '../../models/product.model';
import { badRequest, forbidden, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { applyStockMovements, StockMovementLine } from './stock-ledger.service';
import { allocateNextDocumentNo } from './warehouse-counters';
import { resolveWarehouseScope, assertWarehouseAccess } from './warehouse-scope';
import { notifyStockCountSubmitted } from './warehouse-notifications';
import { localDayKey } from '../region-sales/region-sales.rules';

/**
 * Monthly stock count (spec §12).
 *
 * The rule that matters: approval applies the DELTA between the counted figure and the system figure
 * AS AT SUBMISSION — never an absolute overwrite. A sale that happens while the sheet is waiting for
 * approval is a real movement, and setting stock to the counted number would silently erase it. The
 * approval screen shows the drift so the admin can see when that has happened.
 */

/** `YYYY-MM` in the business timezone, so a count on the 1st at 00:30 isn't filed to last month. */
function currentPeriodMonth(): string {
  return localDayKey(new Date()).slice(0, 7);
}

interface CountSheetRow {
  productId: string;
  productName: string;
  barcode: string;
  systemSellable: number;
  systemDamaged: number;
}

/**
 * Blank count sheet: every product this warehouse currently holds, with the system figures to count
 * against. Products with no balance row are omitted — a warehouse that has never held an item does
 * not need it on the sheet.
 */
export async function getCountSheet(
  warehouseId: string,
  viewer: { userId: string; role: string },
): Promise<{ warehouseId: string; periodMonth: string; rows: CountSheetRow[] }> {
  await assertWarehouseAccess(viewer.userId, viewer.role, warehouseId);

  const balances = await WarehouseStockModel.find({ warehouseId })
    .populate('productId', 'name barcode isTrashed')
    .lean();

  const rows: CountSheetRow[] = [];
  for (const row of balances) {
    const product = row.productId as unknown as {
      _id: Types.ObjectId; name: string; barcode: string; isTrashed?: boolean;
    } | null;
    if (!product || product.isTrashed) continue;
    rows.push({
      productId: String(product._id),
      productName: product.name,
      barcode: product.barcode,
      systemSellable: row.sellable,
      systemDamaged: row.damaged,
    });
  }

  rows.sort((a, b) => a.productName.localeCompare(b.productName));
  return { warehouseId, periodMonth: currentPeriodMonth(), rows };
}

export async function openStockCount(
  data: { warehouseId: string; periodMonth?: string },
  actor: { userId: string; role: string },
) {
  const scope = await resolveWarehouseScope(actor.userId, actor.role);
  if (scope !== null && String(scope) !== data.warehouseId) {
    throw forbidden('You can only count your own warehouse');
  }

  const periodMonth = data.periodMonth ?? currentPeriodMonth();

  // One open count per warehouse. Two sheets both computing their delta against the same snapshot
  // would apply the correction twice.
  const open = await StockCountModel.findOne({
    warehouseId: data.warehouseId,
    status: { $in: ['draft', 'submitted'] },
    isTrashed: { $ne: true },
  })
    .select('documentNo status periodMonth')
    .lean();
  if (open) {
    throw badRequest(
      `A stock count for this warehouse is already ${open.status} (#${open.documentNo ?? ''}, ${open.periodMonth}). Finish or cancel it first.`,
    );
  }

  const sheet = await getCountSheet(data.warehouseId, actor);

  const count = await StockCountModel.create({
    documentNo: await allocateNextDocumentNo('stockCountNo'),
    warehouseId: new Types.ObjectId(data.warehouseId),
    periodMonth,
    // Prefilled with the system figures, so an untouched sheet means "everything matches".
    lines: sheet.rows.map((row) => ({
      productId: new Types.ObjectId(row.productId),
      systemSellable: row.systemSellable,
      systemDamaged: row.systemDamaged,
      countedSellable: row.systemSellable,
      countedDamaged: row.systemDamaged,
    })),
    status: 'draft',
    createdBy: new Types.ObjectId(actor.userId),
  });

  logActivityAsync({
    employeeId: actor.userId,
    module: 'stock_count',
    entityId: String(count._id),
    action: 'created',
    meta: { documentNo: count.documentNo, warehouseId: data.warehouseId, periodMonth, lines: sheet.rows.length },
  });

  return findStockCountById(String(count._id));
}

/** Save counted figures while the sheet is still a draft. */
export async function saveStockCountLines(
  id: string,
  lines: { productId: string; countedSellable: number; countedDamaged: number; note?: string }[],
  actor: { userId: string; role: string },
) {
  const count = await StockCountModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!count) throw notFound('Stock count not found');
  if (count.status !== 'draft') {
    throw badRequest(`Only a draft can be edited. This count is "${count.status}".`);
  }
  await assertWarehouseAccess(actor.userId, actor.role, String(count.warehouseId));

  const byProduct = new Map(lines.map((l) => [l.productId, l]));
  const known = new Set(count.lines.map((l) => String(l.productId)));
  for (const productId of byProduct.keys()) {
    if (!known.has(productId)) {
      throw badRequest('A counted line refers to a product that is not on this count sheet');
    }
  }

  count.lines = count.lines.map((line) => {
    const update = byProduct.get(String(line.productId));
    if (!update) return line;
    return {
      ...line,
      countedSellable: update.countedSellable,
      countedDamaged: update.countedDamaged,
      ...(update.note ? { note: update.note } : {}),
    } as IStockCountLine;
  });

  await count.save();
  return findStockCountById(id);
}

/**
 * Submit for approval. The system figures are RE-SNAPSHOTTED here, not at draft creation, so the
 * variance recorded is the one the counter was actually looking at when they finished.
 */
export async function submitStockCount(id: string, actor: { userId: string; role: string }) {
  const count = await StockCountModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!count) throw notFound('Stock count not found');
  if (count.status !== 'draft') {
    throw badRequest(`Only a draft can be submitted. This count is "${count.status}".`);
  }
  await assertWarehouseAccess(actor.userId, actor.role, String(count.warehouseId));

  const balances = await WarehouseStockModel.find({
    warehouseId: count.warehouseId,
    productId: { $in: count.lines.map((l) => l.productId) },
  }).lean();
  const balanceByProduct = new Map(
    balances.map((b) => [String(b.productId), { sellable: b.sellable, damaged: b.damaged }]),
  );

  count.lines = count.lines.map((line) => {
    const current = balanceByProduct.get(String(line.productId)) ?? { sellable: 0, damaged: 0 };
    return {
      ...line,
      systemSellable: current.sellable,
      systemDamaged: current.damaged,
    } as IStockCountLine;
  });

  count.status = 'submitted';
  count.submittedBy = new Types.ObjectId(actor.userId);
  count.submittedAt = new Date();
  await count.save();

  const differenceCount = count.lines.filter(
    (l) => l.countedSellable !== l.systemSellable || l.countedDamaged !== l.systemDamaged,
  ).length;

  logActivityAsync({
    employeeId: actor.userId,
    module: 'stock_count',
    entityId: id,
    action: 'submitted',
    changes: { status: { from: 'draft', to: 'submitted' } },
    meta: { documentNo: count.documentNo, differenceCount },
  });

  notifyStockCountSubmitted({
    _id: count._id,
    documentNo: count.documentNo,
    warehouseId: count.warehouseId,
    differenceCount,
  });

  return findStockCountById(id);
}

export interface StockCountApprovalDrift {
  productId: string;
  bucket: 'sellable' | 'damaged';
  systemAtSubmission: number;
  systemNow: number;
}

/**
 * Approve: apply `counted − systemAtSubmission` as a delta to each covered line.
 *
 * Any line whose live figure has moved since submission is reported back as drift so the admin can
 * see it — but the delta is still applied, because the intervening movements are real and the
 * counter's variance is real too.
 */
export async function approveStockCount(id: string, actorId: string) {
  const count = await StockCountModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!count) throw notFound('Stock count not found');
  if (count.status !== 'submitted') {
    throw badRequest(`Only a submitted count can be approved. This one is "${count.status}".`);
  }
  if (String(count.submittedBy ?? count.createdBy) === actorId) {
    throw forbidden('You cannot approve a count you submitted — ask another admin');
  }

  const balances = await WarehouseStockModel.find({
    warehouseId: count.warehouseId,
    productId: { $in: count.lines.map((l) => l.productId) },
  }).lean();
  const liveByProduct = new Map(
    balances.map((b) => [String(b.productId), { sellable: b.sellable, damaged: b.damaged }]),
  );

  const drift: StockCountApprovalDrift[] = [];
  const movements: StockMovementLine[] = [];

  count.lines.forEach((line, index) => {
    const live = liveByProduct.get(String(line.productId)) ?? { sellable: 0, damaged: 0 };

    const sellableDelta = line.countedSellable - line.systemSellable;
    const damagedDelta = line.countedDamaged - line.systemDamaged;

    if (live.sellable !== line.systemSellable) {
      drift.push({
        productId: String(line.productId),
        bucket: 'sellable',
        systemAtSubmission: line.systemSellable,
        systemNow: live.sellable,
      });
    }
    if (live.damaged !== line.systemDamaged) {
      drift.push({
        productId: String(line.productId),
        bucket: 'damaged',
        systemAtSubmission: line.systemDamaged,
        systemNow: live.damaged,
      });
    }

    if (sellableDelta !== 0) {
      movements.push({
        warehouseId: String(count.warehouseId),
        productId: String(line.productId),
        bucket: 'sellable',
        delta: sellableDelta,
        // A count adjustment carries no unit cost, so it can never shift the average cost. A
        // positive adjustment therefore enters at the existing average — which is the right answer
        // when you have no idea what the extra pieces cost.
        type: 'count_adjustment',
        refLine: index * 2,
      });
    }
    if (damagedDelta !== 0) {
      movements.push({
        warehouseId: String(count.warehouseId),
        productId: String(line.productId),
        bucket: 'damaged',
        delta: damagedDelta,
        type: 'count_adjustment',
        refLine: index * 2 + 1,
      });
    }
  });

  const claimed = await StockCountModel.findOneAndUpdate(
    { _id: id, status: 'submitted' },
    { $set: { status: 'approved', approvedBy: new Types.ObjectId(actorId), approvedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw badRequest('This count was already actioned by someone else');

  if (movements.length > 0) {
    try {
      await applyStockMovements(movements, {
        refType: 'stock_count',
        refId: id,
        actorId,
        reason: `Stock count #${count.documentNo ?? ''} for ${count.periodMonth}`,
        idempotencyScope: 'approve',
      });
    } catch (err) {
      await StockCountModel.updateOne(
        { _id: id },
        { $set: { status: 'submitted' }, $unset: { approvedBy: '', approvedAt: '' } },
      );
      throw err;
    }
  }

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_count',
    entityId: id,
    action: 'approved',
    changes: { status: { from: 'submitted', to: 'approved' } },
    meta: {
      documentNo: count.documentNo,
      adjustments: movements.length,
      driftDetected: drift.length,
    },
  });

  return { count: await findStockCountById(id), drift };
}

export async function rejectStockCount(id: string, reason: string, actorId: string) {
  const count = await StockCountModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!count) throw notFound('Stock count not found');
  if (count.status !== 'submitted') {
    throw badRequest(`Only a submitted count can be rejected. This one is "${count.status}".`);
  }

  count.status = 'rejected';
  count.rejectedBy = new Types.ObjectId(actorId);
  count.rejectedAt = new Date();
  count.rejectionReason = reason;
  await count.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_count',
    entityId: id,
    action: 'rejected',
    changes: { status: { from: 'submitted', to: 'rejected' } },
    meta: { documentNo: count.documentNo, reason, stockMoved: false },
  });

  return findStockCountById(id);
}

/** Cancel a draft or submitted count. An approved count is history — reverse it with a new count. */
export async function cancelStockCount(id: string, reason: string, actorId: string) {
  const count = await StockCountModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!count) throw notFound('Stock count not found');
  if (count.status === 'approved') {
    throw badRequest(
      'An approved count has already corrected the stock. Run another count to fix a mistake, so both adjustments stay on the record.',
    );
  }
  if (count.status === 'cancelled') throw badRequest('This count has already been cancelled');

  const previousStatus = count.status;
  count.status = 'cancelled';
  count.cancelledBy = new Types.ObjectId(actorId);
  count.cancelledAt = new Date();
  count.cancelReason = reason;
  await count.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_count',
    entityId: id,
    action: 'cancelled',
    changes: { status: { from: previousStatus, to: 'cancelled' } },
    meta: { documentNo: count.documentNo, reason },
  });

  return findStockCountById(id);
}

export interface StockCountFilters {
  warehouseId?: string;
  status?: string;
  periodMonth?: string;
}

export async function findAllStockCounts(
  filters: StockCountFilters,
  viewer: { userId: string; role: string },
) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  const scope = await resolveWarehouseScope(viewer.userId, viewer.role);
  if (scope !== null) query.warehouseId = scope;
  else if (filters.warehouseId) query.warehouseId = new Types.ObjectId(filters.warehouseId);

  if (filters.status) query.status = filters.status;
  if (filters.periodMonth) query.periodMonth = filters.periodMonth;

  return StockCountModel.find(query)
    .populate('warehouseId', 'name city isMain')
    .populate('createdBy', 'username fullName userID')
    .populate('submittedBy', 'username fullName userID')
    .populate('approvedBy', 'username fullName userID')
    .populate('rejectedBy', 'username fullName userID')
    .sort({ createdAt: -1 })
    .lean();
}

export async function findStockCountById(id: string) {
  const count = await StockCountModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('warehouseId', 'name city isMain')
    .populate('lines.productId', 'name barcode')
    .populate('createdBy', 'username fullName userID')
    .populate('submittedBy', 'username fullName userID')
    .populate('approvedBy', 'username fullName userID')
    .populate('rejectedBy', 'username fullName userID')
    .lean();
  if (!count) throw notFound('Stock count not found');
  return count;
}

/** System vs counted vs difference, per product (spec report 6). */
export async function getStockCountReport(filters: StockCountFilters, viewer: { userId: string; role: string }) {
  const counts = await findAllStockCounts(filters, viewer);
  const ids = counts.map((c) => c._id);

  const detailed = await StockCountModel.find({ _id: { $in: ids } })
    .populate('warehouseId', 'name')
    .populate('lines.productId', 'name barcode')
    .populate('approvedBy', 'username fullName userID')
    .lean();

  const rows: Array<Record<string, unknown>> = [];
  for (const count of detailed) {
    for (const line of count.lines) {
      const product = line.productId as unknown as { name?: string; barcode?: string } | null;
      rows.push({
        countId: String(count._id),
        documentNo: count.documentNo ?? null,
        periodMonth: count.periodMonth,
        warehouseName: (count.warehouseId as unknown as { name?: string })?.name ?? '',
        productName: product?.name ?? '',
        barcode: product?.barcode ?? '',
        systemSellable: line.systemSellable,
        countedSellable: line.countedSellable,
        diffSellable: line.countedSellable - line.systemSellable,
        systemDamaged: line.systemDamaged,
        countedDamaged: line.countedDamaged,
        diffDamaged: line.countedDamaged - line.systemDamaged,
        note: line.note ?? '',
        status: count.status,
        approvedByName:
          (count.approvedBy as unknown as { fullName?: string; username?: string })?.fullName ||
          (count.approvedBy as unknown as { username?: string })?.username ||
          '',
      });
    }
  }

  return rows;
}
