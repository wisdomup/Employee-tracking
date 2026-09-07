import { Types } from 'mongoose';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { ProductModel } from '../../models/product.model';
import { badRequest, notFound } from '../../utils/app-error';
import { shouldExposeProductPurchasePrice } from '../../utils/product-privacy';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  postStockReceipt,
  postStockReceiptReversal,
} from '../finance/inventory-posting.service';
import {
  applyStockMovements,
  findPostedMovementIds,
  StockMovementLine,
} from './stock-ledger.service';
import { resolveMainWarehouseId } from './warehouse-resolver';
import { allocateNextDocumentNo } from './warehouse-counters';
import { resolveWarehouseScope } from './warehouse-scope';

/**
 * Stock In (spec §6): pick the product, enter pieces and rate, stock lands in the Main warehouse,
 * the average cost updates, and a printable receipt is produced.
 *
 * Deliberately not a purchase order — no supplier master, no approval step. `supplierName` is free
 * text because the client tracks suppliers on paper today.
 */

interface StockReceiptLineInput {
  productId: string;
  quantity: number;
  rate: number;
}

export async function createStockReceipt(
  data: {
    receiptDate: Date;
    supplierName?: string;
    notes?: string;
    products: StockReceiptLineInput[];
  },
  userId: string,
) {
  // The destination is never taken from the request: all new purchases go into Main first, and
  // stock is transferred out from there (spec §3).
  const warehouseId = await resolveMainWarehouseId();

  const productIds = data.products.map((p) => p.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('The same product appears on more than one line — combine them into one');
  }

  const found = await ProductModel.find({ _id: { $in: productIds }, isTrashed: { $ne: true } })
    .select('_id')
    .lean();
  if (found.length !== productIds.length) {
    throw notFound('One or more products could not be found');
  }

  const totalPieces = data.products.reduce((sum, p) => sum + p.quantity, 0);
  const totalAmount = Number(
    data.products.reduce((sum, p) => sum + p.quantity * p.rate, 0).toFixed(2),
  );

  const receipt = await StockReceiptModel.create({
    receiptDate: data.receiptDate,
    supplierName: data.supplierName,
    notes: data.notes,
    warehouseId,
    products: data.products.map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      rate: p.rate,
    })),
    totalPieces,
    totalAmount,
    status: 'posted',
    createdBy: new Types.ObjectId(userId),
  });

  const lines: StockMovementLine[] = data.products.map((p, index) => ({
    warehouseId: String(warehouseId),
    productId: p.productId,
    bucket: 'sellable',
    delta: p.quantity,
    type: 'stock_in',
    // Only cost-bearing movements may carry a rate — this is what feeds the running average.
    ...(p.rate > 0 ? { unitCost: p.rate } : {}),
    refLine: index,
  }));

  try {
    await applyStockMovements(lines, {
      refType: 'stock_in',
      refId: String(receipt._id),
      actorId: userId,
      // The business date, so a backdated receipt sorts by when the goods arrived.
      occurredAt: data.receiptDate,
    });
  } catch (err) {
    await StockReceiptModel.findByIdAndDelete(receipt._id);
    throw err;
  }

  // Allocate the printed document number only once the stock actually moved, so a failure never
  // punches a permanent gap in the receipt series.
  receipt.documentNo = await allocateNextDocumentNo('stockReceiptNo');
  await receipt.save();

  logActivityAsync({
    employeeId: userId,
    module: 'stock_receipt',
    entityId: String(receipt._id),
    action: 'created',
    meta: {
      documentNo: receipt.documentNo,
      warehouseId: String(warehouseId),
      totalPieces,
      totalAmount,
      supplierName: data.supplierName,
    },
  });

  // Goods on the shelf, a liability to the supplier until their bill arrives.
  await postStockReceipt(String(receipt._id), userId);

  return findStockReceiptById(String(receipt._id));
}

export interface StockReceiptFilters {
  startDate?: string;
  endDate?: string;
  supplierName?: string;
  productId?: string;
  status?: string;
}

export async function findAllStockReceipts(
  filters: StockReceiptFilters,
  viewer: { userId: string; role: string },
) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  // Receipts only ever exist at Main, so a caller scoped to another warehouse sees none.
  const scope = await resolveWarehouseScope(viewer.userId, viewer.role);
  if (scope !== null) query.warehouseId = scope;

  if (filters.status) query.status = filters.status;
  if (filters.productId) query['products.productId'] = new Types.ObjectId(filters.productId);
  if (filters.supplierName) {
    query.supplierName = { $regex: filters.supplierName, $options: 'i' };
  }
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
    query.receiptDate = range;
  }

  return StockReceiptModel.find(query)
    .populate('warehouseId', 'name city isMain')
    .populate('products.productId', 'name barcode')
    .populate('createdBy', 'username fullName userID')
    .populate('cancelledBy', 'username fullName userID')
    .sort({ receiptDate: -1, createdAt: -1 })
    .lean();
}

export async function findStockReceiptById(id: string) {
  const receipt = await StockReceiptModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('warehouseId', 'name city address isMain')
    .populate('products.productId', 'name barcode')
    .populate('createdBy', 'username fullName userID')
    .populate('cancelledBy', 'username fullName userID')
    .lean();
  if (!receipt) throw notFound('Stock in receipt not found');
  return receipt;
}

/**
 * The lines that undo everything a receipt posted.
 *
 * Each reversing line points at the exact ledger row it undoes (`reversalOf`). Without that
 * pointer the reversed rate keeps weighting the product's average cost for ever, because a
 * reversal cannot carry a rate of its own — only `COST_BEARING_TYPES` may.
 */
async function buildReversalLines(receipt: {
  _id: unknown;
  warehouseId: unknown;
  products: { productId: unknown; quantity: number }[];
}): Promise<StockMovementLine[]> {
  const posted = await findPostedMovementIds('stock_in', String(receipt._id), ['stock_in']);

  return receipt.products.map((p, index) => ({
    warehouseId: String(receipt.warehouseId),
    productId: String(p.productId),
    bucket: 'sellable' as const,
    delta: -p.quantity,
    type: 'stock_in_reversal' as const,
    ...(posted.get(`${String(p.productId)}:sellable`)
      ? { reversalOf: posted.get(`${String(p.productId)}:sellable`) }
      : {}),
    refLine: index,
  }));
}

/**
 * Cancel a receipt — the row stays, marked cancelled, and the stock is reversed.
 *
 * The reversal is guarded, so if the pieces have already left Main the cancel is refused with a
 * clear message rather than driving the balance negative.
 */
export async function cancelStockReceipt(id: string, reason: string, actorId: string) {
  const receipt = await StockReceiptModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!receipt) throw notFound('Stock in receipt not found');
  if (receipt.status === 'cancelled') {
    throw badRequest('This receipt has already been cancelled');
  }

  const lines = await buildReversalLines(receipt);

  await applyStockMovements(lines, {
    refType: 'stock_in',
    refId: String(receipt._id),
    actorId,
    reason,
    idempotencyScope: 'cancel',
  });

  receipt.status = 'cancelled';
  receipt.cancelledBy = new Types.ObjectId(actorId);
  receipt.cancelledAt = new Date();
  receipt.cancelReason = reason;
  await receipt.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_receipt',
    entityId: String(receipt._id),
    action: 'cancelled',
    changes: { status: { from: 'posted', to: 'cancelled' } },
    meta: { documentNo: receipt.documentNo, reason },
  });

  // The stock went back out, so the value follows it.
  await postStockReceiptReversal(id, actorId);

  return findStockReceiptById(id);
}

/**
 * Correct a posted receipt in place — admin only.
 *
 * WHY THIS IS A REVERSE-AND-REPOST, NOT A DIFF
 *
 * The obvious implementation is to move only the difference per product. It is wrong as soon as
 * a *rate* changes: the weighted average is rebuilt from the live `stock_in` rows, so leaving
 * the original row in place would keep the wrong rate weighting the cost for ever. Reversing
 * every original row (each carrying a `reversalOf` pointer) drops them all out of the average,
 * and the new rows enter it at the corrected rates. A quantity-only edit takes the same path;
 * one code path is worth more here than a saved `$inc`.
 *
 * WHY TWO LEDGER CALLS
 *
 * `normaliseLines` merges lines by (warehouse, product, bucket) regardless of type, so a −10
 * reversal and a +12 re-post of the same product inside one call would collapse into a single
 * +2 row and lose the reversal pointer. They must be separate calls. The reversal goes first
 * because it is the one that can legitimately fail — if the pieces have already been sold or
 * transferred out of Main, the guarded `$inc` refuses and the edit is rejected, which is the
 * correct answer: you cannot retroactively rewrite a receipt whose goods have moved on. If the
 * re-post then fails anyway, the original lines are put back before the error surfaces.
 */
export async function updateStockReceipt(
  id: string,
  data: {
    receiptDate: Date;
    supplierName?: string;
    notes?: string;
    reason?: string;
    products: StockReceiptLineInput[];
  },
  actorId: string,
) {
  const receipt = await StockReceiptModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!receipt) throw notFound('Stock in receipt not found');
  if (receipt.status === 'cancelled') {
    throw badRequest('A cancelled receipt cannot be edited — record a new Stock In instead');
  }

  const productIds = data.products.map((p) => p.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('The same product appears on more than one line — combine them into one');
  }

  // Validate the new products before touching stock, so the only realistic failure left after
  // the reversal is an infrastructure one.
  const found = await ProductModel.find({ _id: { $in: productIds }, isTrashed: { $ne: true } })
    .select('_id')
    .lean();
  if (found.length !== productIds.length) {
    throw notFound('One or more products could not be found');
  }

  const warehouseId = String(receipt.warehouseId);
  const before = {
    receiptDate: receipt.receiptDate,
    supplierName: receipt.supplierName,
    notes: receipt.notes,
    totalPieces: receipt.totalPieces,
    totalAmount: receipt.totalAmount,
    products: receipt.products.map((p) => ({
      productId: String(p.productId),
      quantity: p.quantity,
      rate: p.rate,
    })),
  };

  // A replayed edit request must not double-apply. The pre-edit `updatedAt` is unique per edit
  // and identical across retries of the same one, which is exactly the property the key needs.
  // The catch block below is responsible for moving it on again after a rolled-back attempt.
  const stamp = receipt.updatedAt ? new Date(receipt.updatedAt).toISOString() : String(Date.now());

  const reversalLines = await buildReversalLines(receipt);
  await applyStockMovements(reversalLines, {
    refType: 'stock_in',
    refId: String(receipt._id),
    actorId,
    reason: data.reason ?? 'Receipt edited',
    idempotencyScope: `edit-reverse:${stamp}`,
  });

  const newLines: StockMovementLine[] = data.products.map((p, index) => ({
    warehouseId,
    productId: p.productId,
    bucket: 'sellable',
    delta: p.quantity,
    type: 'stock_in',
    ...(p.rate > 0 ? { unitCost: p.rate } : {}),
    refLine: index,
  }));

  try {
    await applyStockMovements(newLines, {
      refType: 'stock_in',
      refId: String(receipt._id),
      actorId,
      occurredAt: data.receiptDate,
      reason: data.reason ?? 'Receipt edited',
      idempotencyScope: `edit-apply:${stamp}`,
    });
  } catch (err) {
    // Put the original stock back rather than leaving the receipt silently reversed. A distinct
    // scope, so this restoration is its own visible pair of rows in the ledger.
    await applyStockMovements(
      before.products.map((p, index) => ({
        warehouseId,
        productId: p.productId,
        bucket: 'sellable' as const,
        delta: p.quantity,
        type: 'stock_in' as const,
        ...(p.rate > 0 ? { unitCost: p.rate } : {}),
        refLine: index,
      })),
      {
        refType: 'stock_in',
        refId: String(receipt._id),
        actorId,
        occurredAt: before.receiptDate,
        reason: 'Edit failed — original receipt restored',
        idempotencyScope: `edit-restore:${stamp}`,
      },
    );

    // Burn the stamp. `updatedAt` has not moved (nothing was saved), so a retry would reuse
    // this same scope — and `edit-reverse:<stamp>` is now a REPLAY, which short-circuits and
    // moves no stock. The retry's re-apply would then land on top of the stock we just put
    // back and double it. Recording the failed attempt bumps `updatedAt`, so the next attempt
    // gets a fresh stamp and reverses for real. It is also worth knowing an edit was tried
    // and rolled back, which is why this is a field rather than a throwaway touch.
    receipt.lastEditFailedAt = new Date();
    await receipt.save();

    throw err;
  }

  receipt.receiptDate = data.receiptDate;
  receipt.supplierName = data.supplierName;
  receipt.notes = data.notes;
  receipt.products = data.products.map((p) => ({
    productId: new Types.ObjectId(p.productId),
    quantity: p.quantity,
    rate: p.rate,
  })) as typeof receipt.products;
  receipt.totalPieces = data.products.reduce((sum, p) => sum + p.quantity, 0);
  receipt.totalAmount = Number(
    data.products.reduce((sum, p) => sum + p.quantity * p.rate, 0).toFixed(2),
  );
  receipt.lastEditedBy = new Types.ObjectId(actorId);
  receipt.lastEditedAt = new Date();
  receipt.editReason = data.reason;
  receipt.editCount = (receipt.editCount ?? 0) + 1;
  await receipt.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_receipt',
    entityId: String(receipt._id),
    action: 'updated',
    changes: {
      products: { from: before.products, to: receipt.products },
      totalPieces: { from: before.totalPieces, to: receipt.totalPieces },
      totalAmount: { from: before.totalAmount, to: receipt.totalAmount },
    },
    meta: {
      documentNo: receipt.documentNo,
      reason: data.reason,
      editCount: receipt.editCount,
    },
  });

  // Reverses whatever the previous version posted and re-posts at the corrected rates, keyed on
  // the new `updatedAt` — the same scope the stock ledger uses for the same edit.
  await postStockReceipt(id, actorId);

  return findStockReceiptById(id);
}

/**
 * Delete a wrong receipt — admin only. Reverses the stock, then trashes the row.
 *
 * A soft delete on purpose: the ledger rows reference this document, so removing it outright
 * would leave the audit trail pointing at nothing. The receipt disappears from every list and
 * report; the movements it made stay explainable.
 *
 * The reversal is the same guarded one as cancel, so a receipt whose pieces have already left
 * Main is refused rather than driving the balance negative.
 */
export async function deleteStockReceipt(id: string, reason: string | undefined, actorId: string) {
  const receipt = await StockReceiptModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!receipt) throw notFound('Stock in receipt not found');

  // A cancelled receipt already gave its stock back; reversing again would take pieces that
  // were never added.
  if (receipt.status !== 'cancelled') {
    const lines = await buildReversalLines(receipt);
    await applyStockMovements(lines, {
      refType: 'stock_in',
      refId: String(receipt._id),
      actorId,
      reason: reason ?? 'Receipt deleted',
      idempotencyScope: 'delete',
    });
    receipt.status = 'cancelled';
    receipt.cancelledBy = new Types.ObjectId(actorId);
    receipt.cancelledAt = new Date();
    receipt.cancelReason = reason ?? 'Receipt deleted';
  }

  receipt.isTrashed = true;
  receipt.trashedAt = new Date();
  receipt.trashedBy = new Types.ObjectId(actorId);
  await receipt.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_receipt',
    entityId: String(receipt._id),
    action: 'deleted',
    changes: { isTrashed: { from: false, to: true } },
    meta: {
      documentNo: receipt.documentNo,
      reason,
      totalPieces: receipt.totalPieces,
      totalAmount: receipt.totalAmount,
    },
  });

  await postStockReceiptReversal(id, actorId);

  return { message: 'Stock in receipt deleted and its stock reversed' };
}

/** Everything the printable slip needs, already resolved and formatted-ready. */
export async function getStockReceiptSlip(id: string, role: string) {
  const receipt = (await findStockReceiptById(id)) as unknown as {
    documentNo?: number;
    receiptDate: Date;
    supplierName?: string;
    notes?: string;
    status: string;
    cancelReason?: string;
    totalPieces: number;
    totalAmount: number;
    warehouseId?: { name: string; city?: string; address?: string };
    createdBy?: { fullName?: string; username?: string };
    cancelledBy?: { fullName?: string; username?: string };
    products: { productId?: { name: string; barcode: string }; quantity: number; rate: number }[];
  };

  const exposeCost = shouldExposeProductPurchasePrice(role);

  return {
    kind: 'stock-in' as const,
    documentNo: receipt.documentNo ?? null,
    receiptDate: receipt.receiptDate,
    supplierName: receipt.supplierName ?? null,
    notes: receipt.notes ?? null,
    status: receipt.status,
    cancelReason: receipt.cancelReason ?? null,
    warehouseName: receipt.warehouseId?.name ?? '',
    warehouseCity: receipt.warehouseId?.city ?? '',
    warehouseAddress: receipt.warehouseId?.address ?? '',
    preparedBy: receipt.createdBy?.fullName || receipt.createdBy?.username || '',
    cancelledByName: receipt.cancelledBy?.fullName || receipt.cancelledBy?.username || null,
    totalPieces: receipt.totalPieces,
    // A storekeeper enters the rates, so they may see them on their own slip; the running
    // average and the total value stay admin-only.
    totalAmount: exposeCost ? receipt.totalAmount : null,
    lines: receipt.products.map((p) => ({
      productName: p.productId?.name ?? '',
      barcode: p.productId?.barcode ?? '',
      quantity: p.quantity,
      rate: p.rate,
      amount: Number((p.quantity * p.rate).toFixed(2)),
    })),
  };
}

/** Warehouse names for the Stock In form's read-only "Received into" line. */
export async function getMainWarehouse() {
  const id = await resolveMainWarehouseId();
  return WarehouseModel.findById(id).select('name city address isMain').lean();
}
