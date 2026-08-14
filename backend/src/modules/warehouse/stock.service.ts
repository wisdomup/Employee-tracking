import { Types } from 'mongoose';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { WarehouseModel } from '../../models/warehouse.model';
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

// ------------------------------------------------------------------ live matrix

/**
 * The product × warehouse grid: products down, warehouses across, Sellable / Damaged per
 * warehouse, LIVE balances.
 *
 * Deliberately NOT `getWarehouseStock({ includeEmpty: 'true' })`. That endpoint reads the balance
 * collection, and a (warehouse, product) pair that has never held stock has no balance document at
 * all — `applyOne` upserts one only on a positive delta. So the flat report can never produce a
 * complete grid, and a brand-new product would be invisible on the very screen meant for entering
 * its stock. This one is driven from the CATALOGUE and joins the balances in, which is what makes
 * "a row of zeros you can type into" a first-class result rather than a client-side reconstruction.
 *
 * The shape is compact on purpose. The flat report carries the warehouse name, product name,
 * category, prices and valuation on every one of its N×M rows; here each is named once and `cells`
 * is SPARSE — a warehouse absent from the map holds nothing.
 *
 * Known, and matching the flat report: a trashed product is excluded while its balance rows survive
 * (restoring the product brings its stock back), so a sum over this matrix can be less than the sum
 * over WarehouseStock. Do not "fix" that by including trashed products.
 */
export interface StockMatrixFilters {
  search?: string;
  categoryId?: string;
  /** Only products at or below their low-stock level (measured on the all-warehouse total). */
  lowOnly?: string;
  /** Drop products holding nothing anywhere. Off by default — a zero row is the row you type into. */
  nonZeroOnly?: string;
  /** Safety valve for very large catalogues. */
  limit?: string;
}

export interface StockMatrixCell {
  sellable: number;
  damaged: number;
  /** Owned by the transfer documents, never adjustable. Omitted when zero. */
  inTransit?: number;
}

export interface StockMatrixProductRow {
  productId: string;
  name: string;
  barcode: string;
  categoryId?: string;
  categoryName?: string;
  survivalQuantity: number | null;
  /** Measured on the ALL-warehouse sellable mirror, not on the columns returned. */
  isLow: boolean;
  totalSellable: number;
  totalDamaged: number;
  totalInTransit: number;
  /** sellable + damaged. In-transit is excluded: those pieces are at no warehouse. */
  totalOnHand: number;
  /** Admin-only, same rule as `Product.purchasePrice`. Per product, never per cell. */
  avgCost?: number;
  /** Sparse, keyed by warehouseId. An absent warehouse holds nothing. */
  cells: Record<string, StockMatrixCell>;
}

export interface StockMatrix {
  /** Column order, already sorted: Main first, then alphabetical. */
  warehouses: { _id: string; name: string; city?: string; isMain: boolean; isActive: boolean }[];
  products: StockMatrixProductRow[];
  /** When the balances were read — the "as of" label, and the baseline the client edits against. */
  generatedAt: Date;
  /** True when `limit` cut the list short. The page tells the operator to narrow the filter. */
  truncated: boolean;
  /** Set when the caller is pinned to one warehouse; the grid then has a single column. */
  scopedWarehouseId?: string;
}

const MATRIX_DEFAULT_LIMIT = 2000;
const MATRIX_MAX_LIMIT = 5000;

/** `products.service.ts#findAll` feeds user input straight into `$regex`; this one does not. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function getStockMatrix(
  filters: StockMatrixFilters,
  viewer: { userId: string; role: string },
): Promise<StockMatrix> {
  const scope = await resolveWarehouseScope(viewer.userId, viewer.role);

  // Columns. INACTIVE warehouses are KEPT: deactivating one does not empty it (only an empty
  // warehouse may be trashed), so hiding the column would hide pieces that are genuinely on the
  // books. The page renders them read-only, because `validateReferences` refuses to move stock
  // to or from an inactive warehouse.
  const warehouseDocs = await WarehouseModel.find({
    isTrashed: { $ne: true },
    ...(scope !== null ? { _id: scope } : {}),
  })
    .select('name city isMain isActive')
    .sort({ isMain: -1, name: 1 })
    .lean();

  const warehouses = warehouseDocs.map((w) => ({
    _id: String(w._id),
    name: w.name,
    city: w.city,
    isMain: Boolean(w.isMain),
    isActive: w.isActive !== false,
  }));

  // Rows, driven from the catalogue.
  const productQuery: Record<string, unknown> = { isTrashed: { $ne: true } };
  if (filters.categoryId) productQuery.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.search) {
    const needle = escapeRegex(filters.search);
    productQuery.$or = [
      { name: { $regex: needle, $options: 'i' } },
      { barcode: { $regex: needle, $options: 'i' } },
    ];
  }
  const narrowed = Boolean(filters.categoryId || filters.search);

  const limit = Math.min(
    Math.max(Number(filters.limit) || MATRIX_DEFAULT_LIMIT, 1),
    MATRIX_MAX_LIMIT,
  );

  // Alphabetical, not newest-first: this is a grid you scan for a name. One extra row is fetched
  // purely to answer "was there more?".
  const productDocs = await ProductModel.find(productQuery)
    .select('name barcode categoryId survivalQuantity quantity purchasePrice')
    .populate('categoryId', 'name')
    .sort({ name: 1 })
    .limit(limit + 1)
    .lean();

  const truncated = productDocs.length > limit;
  if (truncated) productDocs.pop();

  // Balances: one pass, projected to the five fields the grid needs, all-zero rows dropped — an
  // absent cell already means zero, so shipping a zero row is pure waste. The productId `$in` is
  // added only when a filter narrowed the catalogue; unfiltered it would be a long array against
  // a scan that is cheaper without it.
  const balanceRows: {
    warehouseId: Types.ObjectId;
    productId: Types.ObjectId;
    sellable: number;
    damaged: number;
    inTransit: number;
  }[] =
    warehouses.length === 0 || productDocs.length === 0
      ? []
      : await WarehouseStockModel.aggregate([
          {
            $match: {
              warehouseId: { $in: warehouseDocs.map((w) => w._id) },
              ...(narrowed ? { productId: { $in: productDocs.map((p) => p._id) } } : {}),
              $or: [{ sellable: { $ne: 0 } }, { damaged: { $ne: 0 } }, { inTransit: { $ne: 0 } }],
            },
          },
          {
            $project: {
              _id: 0,
              warehouseId: 1,
              productId: 1,
              sellable: 1,
              damaged: 1,
              inTransit: 1,
            },
          },
        ]);

  const cellsByProduct = new Map<string, Record<string, StockMatrixCell>>();
  const totalsByProduct = new Map<
    string,
    { sellable: number; damaged: number; inTransit: number }
  >();

  for (const row of balanceRows) {
    const productId = String(row.productId);

    let cells = cellsByProduct.get(productId);
    if (!cells) {
      cells = {};
      cellsByProduct.set(productId, cells);
    }
    cells[String(row.warehouseId)] = {
      sellable: row.sellable ?? 0,
      damaged: row.damaged ?? 0,
      ...(row.inTransit ? { inTransit: row.inTransit } : {}),
    };

    const total = totalsByProduct.get(productId) ?? { sellable: 0, damaged: 0, inTransit: 0 };
    total.sellable += row.sellable ?? 0;
    total.damaged += row.damaged ?? 0;
    total.inTransit += row.inTransit ?? 0;
    totalsByProduct.set(productId, total);
  }

  const exposeCost = shouldExposeProductPurchasePrice(viewer.role);
  const products: StockMatrixProductRow[] = [];

  for (const product of productDocs) {
    const productId = String(product._id);
    const total = totalsByProduct.get(productId) ?? { sellable: 0, damaged: 0, inTransit: 0 };
    const survival = typeof product.survivalQuantity === 'number' ? product.survivalQuantity : null;

    // The all-warehouse mirror, NOT `total.sellable`: the low-stock level is a company-wide
    // threshold and a scoped caller sees one column. Same rule as `getWarehouseStock`.
    const allWarehouseSellable = product.quantity ?? 0;
    const isLow = survival !== null && allWarehouseSellable <= survival;

    if (filters.lowOnly === 'true' && !isLow) continue;
    if (
      filters.nonZeroOnly === 'true' &&
      total.sellable === 0 &&
      total.damaged === 0 &&
      total.inTransit === 0
    ) {
      continue;
    }

    const category = product.categoryId as unknown as { _id: Types.ObjectId; name: string } | null;

    products.push({
      productId,
      name: product.name,
      barcode: product.barcode,
      categoryId: category?._id ? String(category._id) : undefined,
      categoryName: category?.name,
      survivalQuantity: survival,
      isLow,
      totalSellable: total.sellable,
      totalDamaged: total.damaged,
      totalInTransit: total.inTransit,
      totalOnHand: total.sellable + total.damaged,
      ...(exposeCost ? { avgCost: product.purchasePrice ?? 0 } : {}),
      cells: cellsByProduct.get(productId) ?? {},
    });
  }

  return {
    warehouses,
    products,
    generatedAt: new Date(),
    truncated,
    ...(scope !== null ? { scopedWarehouseId: String(scope) } : {}),
  };
}
