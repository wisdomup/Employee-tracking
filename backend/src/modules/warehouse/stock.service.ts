import { Types } from 'mongoose';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { ProductModel } from '../../models/product.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { notFound } from '../../utils/app-error';
import { shouldExposeProductPurchasePrice } from '../../utils/product-privacy';
import { resolveWarehouseScope } from './warehouse-scope';

/**
 * Read side of the stock ledger: "current stock — per warehouse, per product, split
 * Sellable / Damaged / Claim" (spec report 2), plus the last-purchase-rate lookup the Stock In
 * form shows as a reference.
 */

export interface StockRowFilters {
  warehouseId?: string;
  productId?: string;
  categoryId?: string;
  search?: string;
  /** Only rows at or below the product's low-stock level (measured on the all-warehouse total). */
  lowOnly?: string;
  /** Include rows where every bucket is zero. Off by default — the catalogue is long. */
  includeEmpty?: string;
}

export interface StockRow {
  warehouseId: string;
  warehouseName: string;
  warehouseCity?: string;
  isMainWarehouse: boolean;
  productId: string;
  productName: string;
  barcode: string;
  categoryId?: string;
  categoryName?: string;
  sellable: number;
  damaged: number;
  inTransit: number;
  /** Mirror total across every warehouse — what the low-stock level is compared against. */
  totalSellableAllWarehouses: number;
  survivalQuantity: number | null;
  isLow: boolean;
  salePrice: number;
  /** Admin-only. Stripped for every other role, like `Product.purchasePrice` already is. */
  avgCost?: number;
  lastPurchaseRate?: number;
  stockValue?: number;
  potentialSaleValue: number;
  lastMovementAt?: Date;
}

/**
 * Per-warehouse stock rows. Costs are stripped for non-admins — warehouse staff need piece counts
 * and their own receipt rates, not the company's cost basis.
 */
export async function getWarehouseStock(
  filters: StockRowFilters,
  viewer: { userId: string; role: string },
): Promise<StockRow[]> {
  const scope = await resolveWarehouseScope(viewer.userId, viewer.role);

  const match: Record<string, unknown> = {};
  if (filters.warehouseId) {
    match.warehouseId = new Types.ObjectId(filters.warehouseId);
  } else if (scope !== null) {
    match.warehouseId = scope;
  }
  if (scope !== null && filters.warehouseId && String(scope) !== filters.warehouseId) {
    // Scoped caller asking for someone else's warehouse: return nothing rather than leaking.
    return [];
  }
  if (filters.productId) match.productId = new Types.ObjectId(filters.productId);

  if (filters.includeEmpty !== 'true') {
    match.$or = [{ sellable: { $gt: 0 } }, { damaged: { $gt: 0 } }, { inTransit: { $gt: 0 } }];
  }

  const rows = await WarehouseStockModel.find(match)
    .populate('warehouseId', 'name city isMain')
    .populate({
      path: 'productId',
      select: 'name barcode categoryId salePrice purchasePrice lastPurchaseRate survivalQuantity isTrashed',
      populate: { path: 'categoryId', select: 'name' },
    })
    .lean();

  // Mirror totals in one pass rather than a lookup per row.
  const totals = new Map<string, number>();
  const totalRows = await WarehouseStockModel.aggregate([
    { $group: { _id: '$productId', total: { $sum: '$sellable' } } },
  ]);
  for (const t of totalRows) totals.set(String(t._id), t.total ?? 0);

  const exposeCost = shouldExposeProductPurchasePrice(viewer.role);
  const out: StockRow[] = [];

  for (const row of rows) {
    const warehouse = row.warehouseId as unknown as {
      _id: Types.ObjectId; name: string; city?: string; isMain?: boolean;
    } | null;
    const product = row.productId as unknown as {
      _id: Types.ObjectId; name: string; barcode: string; salePrice?: number;
      purchasePrice?: number; lastPurchaseRate?: number; survivalQuantity?: number;
      isTrashed?: boolean; categoryId?: { _id: Types.ObjectId; name: string } | null;
    } | null;

    // Trashed products keep their balances (restoring a product brings its stock back) but must
    // not clutter the live stock report.
    if (!warehouse || !product || product.isTrashed) continue;

    const totalSellable = totals.get(String(product._id)) ?? 0;
    const survival = typeof product.survivalQuantity === 'number' ? product.survivalQuantity : null;
    const isLow = survival !== null && totalSellable <= survival;

    if (filters.categoryId && String(product.categoryId?._id ?? '') !== filters.categoryId) continue;
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      const haystack = `${product.name} ${product.barcode}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    if (filters.lowOnly === 'true' && !isLow) continue;

    const avgCost = product.purchasePrice ?? 0;
    const salePrice = product.salePrice ?? 0;

    out.push({
      warehouseId: String(warehouse._id),
      warehouseName: warehouse.name,
      warehouseCity: warehouse.city,
      isMainWarehouse: Boolean(warehouse.isMain),
      productId: String(product._id),
      productName: product.name,
      barcode: product.barcode,
      categoryId: product.categoryId ? String(product.categoryId._id) : undefined,
      categoryName: product.categoryId?.name,
      sellable: row.sellable,
      damaged: row.damaged,
      inTransit: row.inTransit,
      totalSellableAllWarehouses: totalSellable,
      survivalQuantity: survival,
      isLow,
      salePrice,
      ...(exposeCost
        ? {
            avgCost,
            lastPurchaseRate: product.lastPurchaseRate ?? 0,
            stockValue: Number((row.sellable * avgCost).toFixed(2)),
          }
        : {}),
      potentialSaleValue: Number((row.sellable * salePrice).toFixed(2)),
      lastMovementAt: row.lastMovementAt,
    });
  }

  out.sort(
    (a, b) =>
      a.warehouseName.localeCompare(b.warehouseName) || a.productName.localeCompare(b.productName),
  );
  return out;
}

/**
 * The reference figure shown next to the rate input on the Stock In form: "the last purchase rate
 * is shown as a reference when entering a new one" (spec §4).
 */
export async function getLastPurchaseRate(productId: string, role: string) {
  const product = await ProductModel.findOne({ _id: productId, isTrashed: { $ne: true } })
    .select('name lastPurchaseRate purchasePrice')
    .lean();
  if (!product) throw notFound('Product not found');

  const lastReceipt = await StockReceiptModel.findOne({
    'products.productId': new Types.ObjectId(productId),
    status: 'posted',
    isTrashed: { $ne: true },
  })
    .select('receiptDate supplierName products')
    .sort({ receiptDate: -1, _id: -1 })
    .lean();

  const line = lastReceipt?.products.find((p) => String(p.productId) === String(productId));

  return {
    productId,
    productName: product.name,
    lastPurchaseRate: line?.rate ?? product.lastPurchaseRate ?? null,
    lastReceiptDate: lastReceipt?.receiptDate ?? null,
    lastSupplierName: lastReceipt?.supplierName ?? null,
    // The running average is cost data — admin only, same rule as `Product.purchasePrice`.
    ...(shouldExposeProductPurchasePrice(role) ? { avgCost: product.purchasePrice ?? 0 } : {}),
  };
}
