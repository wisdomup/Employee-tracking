import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { ProductModel } from '../../models/product.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { shouldExposeProductPurchasePrice } from '../../utils/product-privacy';

/**
 * Sales and valuation report (spec §14 report 5): "sales report (pick any date range) — best selling
 * products, current stock value, and what it could sell for".
 *
 * Cost figures are admin-only, so the value columns disappear entirely for other roles rather than
 * arriving as zeroes that look like real data.
 */

export interface ValuationFilters {
  startDate?: string;
  endDate?: string;
  warehouseId?: string;
  categoryId?: string;
}

export interface ValuationReport {
  period: { startDate: string | null; endDate: string | null };
  summary: {
    totalSellablePieces: number;
    totalDamagedPieces: number;
    totalInTransitPieces: number;
    lowStockProductCount: number;
    /** Admin only. */
    currentStockValue?: number;
    damagedStockValue?: number;
    potentialSaleValue: number;
    unitsSoldInPeriod: number;
    salesRevenueInPeriod: number;
    grossProfitInPeriod?: number;
  };
  bestSellers: {
    productId: string;
    productName: string;
    barcode: string;
    qtySold: number;
    revenue: number;
    currentSellableQty: number;
  }[];
}

function dayRange(startDate?: string, endDate?: string) {
  const range: { $gte?: Date; $lte?: Date } = {};
  if (startDate) {
    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    range.$gte = start;
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
}

export async function getValuationReport(
  filters: ValuationFilters,
  role: string,
): Promise<ValuationReport> {
  const exposeCost = shouldExposeProductPurchasePrice(role);

  // ---- Stock on hand -------------------------------------------------------
  const stockMatch: Record<string, unknown> = {};
  if (filters.warehouseId) stockMatch.warehouseId = new Types.ObjectId(filters.warehouseId);

  const balances = await WarehouseStockModel.find(stockMatch)
    .populate('productId', 'name barcode salePrice purchasePrice survivalQuantity categoryId isTrashed')
    .lean();

  let totalSellablePieces = 0;
  let totalDamagedPieces = 0;
  let totalInTransitPieces = 0;
  let currentStockValue = 0;
  let damagedStockValue = 0;
  let potentialSaleValue = 0;

  const sellableByProduct = new Map<string, number>();
  const totalsForLowStock = new Map<string, { total: number; level: number | null }>();

  for (const row of balances) {
    const product = row.productId as unknown as {
      _id: Types.ObjectId; name: string; salePrice?: number; purchasePrice?: number;
      survivalQuantity?: number; categoryId?: Types.ObjectId; isTrashed?: boolean;
    } | null;
    if (!product || product.isTrashed) continue;
    if (filters.categoryId && String(product.categoryId ?? '') !== filters.categoryId) continue;

    const productId = String(product._id);
    totalSellablePieces += row.sellable;
    totalDamagedPieces += row.damaged;
    totalInTransitPieces += row.inTransit;
    currentStockValue += row.sellable * (product.purchasePrice ?? 0);
    damagedStockValue += row.damaged * (product.purchasePrice ?? 0);
    potentialSaleValue += row.sellable * (product.salePrice ?? 0);

    sellableByProduct.set(productId, (sellableByProduct.get(productId) ?? 0) + row.sellable);
    totalsForLowStock.set(productId, {
      total: (totalsForLowStock.get(productId)?.total ?? 0) + row.sellable,
      level:
        typeof product.survivalQuantity === 'number' ? product.survivalQuantity : null,
    });
  }

  // The low-stock level is a company-wide total per the spec, so it is compared against the sum of
  // sellable stock across every warehouse — never against one warehouse's figure.
  const allWarehouseTotals = filters.warehouseId
    ? new Map(
        (
          await WarehouseStockModel.aggregate([
            { $group: { _id: '$productId', total: { $sum: '$sellable' } } },
          ])
        ).map((r) => [String(r._id), r.total as number]),
      )
    : null;

  let lowStockProductCount = 0;
  for (const [productId, entry] of totalsForLowStock) {
    if (entry.level === null) continue;
    const total = allWarehouseTotals ? allWarehouseTotals.get(productId) ?? 0 : entry.total;
    if (total <= entry.level) lowStockProductCount += 1;
  }

  // ---- Sales in the period -------------------------------------------------
  const orderMatch: Record<string, unknown> = {
    isTrashed: { $ne: true },
    status: 'delivered',
  };
  const range = dayRange(filters.startDate, filters.endDate);
  if (range.$gte || range.$lte) orderMatch.createdAt = range;
  if (filters.warehouseId) orderMatch.warehouseId = new Types.ObjectId(filters.warehouseId);

  const sold = await OrderModel.aggregate([
    { $match: orderMatch },
    { $unwind: '$products' },
    {
      $group: {
        _id: '$products.productId',
        qtySold: { $sum: '$products.quantity' },
        revenue: { $sum: { $multiply: ['$products.quantity', '$products.price'] } },
        // The cost snapshot taken when the stock moved, falling back to nothing for legacy lines.
        cost: {
          $sum: { $multiply: ['$products.quantity', { $ifNull: ['$products.unitCost', 0] }] },
        },
      },
    },
    { $sort: { qtySold: -1 } },
  ]);

  const productIds = sold.map((s) => s._id).filter(Boolean);
  const products = await ProductModel.find({ _id: { $in: productIds } })
    .select('name barcode categoryId')
    .lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  let unitsSoldInPeriod = 0;
  let salesRevenueInPeriod = 0;
  let costOfGoodsSold = 0;
  const bestSellers: ValuationReport['bestSellers'] = [];

  for (const row of sold) {
    const product = productById.get(String(row._id));
    if (!product) continue;
    if (filters.categoryId && String(product.categoryId ?? '') !== filters.categoryId) continue;

    unitsSoldInPeriod += row.qtySold;
    salesRevenueInPeriod += row.revenue;
    costOfGoodsSold += row.cost;

    if (bestSellers.length < 25) {
      bestSellers.push({
        productId: String(row._id),
        productName: product.name,
        barcode: product.barcode,
        qtySold: row.qtySold,
        revenue: Number(row.revenue.toFixed(2)),
        currentSellableQty: sellableByProduct.get(String(row._id)) ?? 0,
      });
    }
  }

  return {
    period: { startDate: filters.startDate ?? null, endDate: filters.endDate ?? null },
    summary: {
      totalSellablePieces,
      totalDamagedPieces,
      totalInTransitPieces,
      lowStockProductCount,
      ...(exposeCost
        ? {
            currentStockValue: Number(currentStockValue.toFixed(2)),
            damagedStockValue: Number(damagedStockValue.toFixed(2)),
            grossProfitInPeriod: Number((salesRevenueInPeriod - costOfGoodsSold).toFixed(2)),
          }
        : {}),
      potentialSaleValue: Number(potentialSaleValue.toFixed(2)),
      unitsSoldInPeriod,
      salesRevenueInPeriod: Number(salesRevenueInPeriod.toFixed(2)),
    },
    bestSellers,
  };
}

/**
 * Products at or below their low-stock level, measured on total sellable stock across all
 * warehouses (spec §10). Used by the report and by the scheduled alert.
 */
export async function getLowStockProducts(): Promise<
  { productId: string; name: string; total: number; level: number }[]
> {
  const products = await ProductModel.find({
    isTrashed: { $ne: true },
    survivalQuantity: { $gt: 0 },
  })
    .select('_id name survivalQuantity')
    .lean();

  if (products.length === 0) return [];

  const totals = new Map(
    (
      await WarehouseStockModel.aggregate([
        {
          $match: { productId: { $in: products.map((p) => p._id) } },
        },
        { $group: { _id: '$productId', total: { $sum: '$sellable' } } },
      ])
    ).map((r) => [String(r._id), r.total as number]),
  );

  const low: { productId: string; name: string; total: number; level: number }[] = [];
  for (const product of products) {
    const total = totals.get(String(product._id)) ?? 0;
    const level = product.survivalQuantity ?? 0;
    if (total <= level) {
      low.push({ productId: String(product._id), name: product.name, total, level });
    }
  }

  low.sort((a, b) => a.total - b.total);
  return low;
}
