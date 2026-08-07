import { Types } from 'mongoose';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { ProductModel } from '../../models/product.model';
import { badRequest, notFound } from '../../utils/app-error';
import { shouldExposeProductPurchasePrice } from '../../utils/product-privacy';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
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
 * Cancel a receipt. Never a delete — the spec is explicit that "mistakes are never deleted;
 * they're cancelled with a reason and the stock is reversed".
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

  // Point each reversing line at the receipt row it undoes. Without the pointer the cancelled rate
  // keeps weighting the product's average cost for ever, because a reversal cannot carry a rate of
  // its own.
  const posted = await findPostedMovementIds('stock_in', String(receipt._id), ['stock_in']);

  const lines: StockMovementLine[] = receipt.products.map((p, index) => ({
    warehouseId: String(receipt.warehouseId),
    productId: String(p.productId),
    bucket: 'sellable',
    delta: -p.quantity,
    type: 'stock_in_reversal',
    ...(posted.get(`${String(p.productId)}:sellable`)
      ? { reversalOf: posted.get(`${String(p.productId)}:sellable`) }
      : {}),
    refLine: index,
  }));

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

  return findStockReceiptById(id);
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
