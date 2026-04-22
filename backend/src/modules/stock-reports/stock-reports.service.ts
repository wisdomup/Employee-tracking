import { Types } from 'mongoose';
import { ProductModel } from '../../models/product.model';
import { OrderModel } from '../../models/order.model';
import { ReturnModel } from '../../models/return.model';

function buildDateRange(startDate?: string, endDate?: string) {
  const end = endDate ? new Date(endDate) : new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = startDate ? new Date(startDate) : new Date(end);
  if (!startDate) start.setUTCDate(start.getUTCDate() - 29);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

export interface StockReportFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  search?: string;
}

// ─── 1. Current Stock Report ─────────────────────────────────────────────────
export async function getCurrentStockReport(filters: StockReportFilters = {}) {
  const productMatch: Record<string, unknown> = { isTrashed: { $ne: true } };
  if (filters.categoryId) productMatch.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.search) {
    productMatch.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { barcode: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const { start, end } = buildDateRange(filters.startDate, filters.endDate);

  const rows = await ProductModel.aggregate([
    { $match: productMatch },
    {
      $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'orders',
        let: { pid: '$_id' },
        pipeline: [
          {
            $match: {
              isTrashed: { $ne: true },
              status: { $in: ['pending', 'approved', 'packed', 'dispatched'] },
            },
          },
          { $unwind: '$products' },
          { $match: { $expr: { $eq: ['$products.productId', '$$pid'] } } },
          { $group: { _id: null, qty: { $sum: '$products.quantity' } } },
        ],
        as: 'holdAgg',
      },
    },
    {
      $lookup: {
        from: 'orders',
        let: { pid: '$_id' },
        pipeline: [
          {
            $match: {
              isTrashed: { $ne: true },
              status: 'delivered',
              createdAt: { $gte: start, $lte: end },
            },
          },
          { $unwind: '$products' },
          { $match: { $expr: { $eq: ['$products.productId', '$$pid'] } } },
          { $group: { _id: null, qty: { $sum: '$products.quantity' } } },
        ],
        as: 'soldAgg',
      },
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        name: 1,
        barcode: 1,
        categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
        availableQty: { $ifNull: ['$quantity', 0] },
        onHoldQty: { $ifNull: [{ $arrayElemAt: ['$holdAgg.qty', 0] }, 0] },
        soldQtyInPeriod: { $ifNull: [{ $arrayElemAt: ['$soldAgg.qty', 0] }, 0] },
        salePrice: { $ifNull: ['$salePrice', 0] },
        purchasePrice: { $ifNull: ['$purchasePrice', 0] },
        survivalQuantity: { $ifNull: ['$survivalQuantity', null] },
      },
    },
    { $sort: { name: 1 } },
  ]);

  return rows;
}

// ─── 2. Hold Stock Report ─────────────────────────────────────────────────────
export async function getHoldStockReport(filters: StockReportFilters = {}) {
  const { start, end } = buildDateRange(filters.startDate, filters.endDate);

  const orderMatch: Record<string, unknown> = {
    isTrashed: { $ne: true },
    status: { $in: ['pending', 'approved', 'packed', 'dispatched'] },
    createdAt: { $gte: start, $lte: end },
  };

  const rows = await OrderModel.aggregate([
    { $match: orderMatch },
    { $unwind: '$products' },
    {
      $lookup: {
        from: 'products',
        localField: 'products.productId',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.categoryId',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'dealers',
        localField: 'dealerId',
        foreignField: '_id',
        as: 'dealer',
      },
    },
    { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
    ...(filters.categoryId
      ? [{ $match: { 'product.categoryId': new Types.ObjectId(filters.categoryId) } }]
      : []),
    ...(filters.search
      ? [
          {
            $match: {
              $or: [
                { 'product.name': { $regex: filters.search, $options: 'i' } },
                { 'product.barcode': { $regex: filters.search, $options: 'i' } },
              ],
            },
          },
        ]
      : []),
    {
      $project: {
        _id: 0,
        orderId: '$_id',
        productId: '$product._id',
        productName: { $ifNull: ['$product.name', 'Unknown'] },
        barcode: { $ifNull: ['$product.barcode', ''] },
        categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
        dealerName: {
          $ifNull: [
            { $ifNull: ['$dealer.shopName', '$dealer.name'] },
            'Unknown Dealer',
          ],
        },
        qtyOnHold: '$products.quantity',
        unitPrice: '$products.price',
        orderStatus: '$status',
        orderDate: '$createdAt',
      },
    },
    { $sort: { orderDate: -1 } },
  ]);

  return rows;
}

// ─── 3. Damage Stock Report ───────────────────────────────────────────────────
export async function getDamageStockReport(filters: StockReportFilters = {}) {
  const { start, end } = buildDateRange(filters.startDate, filters.endDate);

  const returnMatch: Record<string, unknown> = {
    isTrashed: { $ne: true },
    returnType: 'damage',
    createdAt: { $gte: start, $lte: end },
  };

  const rows = await ReturnModel.aggregate([
    { $match: returnMatch },
    { $unwind: '$products' },
    {
      $lookup: {
        from: 'products',
        localField: 'products.productId',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.categoryId',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'dealers',
        localField: 'dealerId',
        foreignField: '_id',
        as: 'dealer',
      },
    },
    { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
    ...(filters.categoryId
      ? [{ $match: { 'product.categoryId': new Types.ObjectId(filters.categoryId) } }]
      : []),
    ...(filters.search
      ? [
          {
            $match: {
              $or: [
                { 'product.name': { $regex: filters.search, $options: 'i' } },
                { 'product.barcode': { $regex: filters.search, $options: 'i' } },
              ],
            },
          },
        ]
      : []),
    {
      $project: {
        _id: 0,
        returnId: '$_id',
        productId: '$product._id',
        productName: { $ifNull: ['$product.name', 'Unknown'] },
        barcode: { $ifNull: ['$product.barcode', ''] },
        categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
        dealerName: {
          $ifNull: [
            { $ifNull: ['$dealer.shopName', '$dealer.name'] },
            'Unknown Dealer',
          ],
        },
        damagedQty: '$products.quantity',
        unitPrice: '$products.price',
        returnReason: { $ifNull: ['$returnReason', ''] },
        returnStatus: '$status',
        returnDate: '$createdAt',
      },
    },
    { $sort: { returnDate: -1 } },
  ]);

  return rows;
}

// ─── 4. Profit & Loss Report ──────────────────────────────────────────────────
export async function getProfitLossReport(filters: StockReportFilters = {}) {
  const { start, end } = buildDateRange(filters.startDate, filters.endDate);

  const [revenueAgg, returnPayoutAgg, damageValueAgg] = await Promise.all([
    // Revenue + COGS from delivered orders
    OrderModel.aggregate([
      {
        $match: {
          isTrashed: { $ne: true },
          status: 'delivered',
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $unwind: '$products' },
      {
        $lookup: {
          from: 'products',
          localField: 'products.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          revenue: { $sum: { $multiply: ['$products.quantity', '$products.price'] } },
          cogs: {
            $sum: {
              $multiply: [
                '$products.quantity',
                { $ifNull: ['$product.purchasePrice', 0] },
              ],
            },
          },
          soldOrders: { $addToSet: '$_id' },
          soldQty: { $sum: '$products.quantity' },
        },
      },
      {
        $project: {
          _id: 0,
          revenue: { $round: ['$revenue', 2] },
          cogs: { $round: ['$cogs', 2] },
          orderCount: { $size: '$soldOrders' },
          soldQty: 1,
        },
      },
    ]),

    // Return payouts from completed returns (type=return)
    ReturnModel.aggregate([
      {
        $match: {
          isTrashed: { $ne: true },
          returnType: 'return',
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          totalReturnPayout: { $sum: { $ifNull: ['$amount', 0] } },
          returnCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          totalReturnPayout: { $round: ['$totalReturnPayout', 2] },
          returnCount: 1,
        },
      },
    ]),

    // Damage value from completed damage returns (purchasePrice × qty)
    ReturnModel.aggregate([
      {
        $match: {
          isTrashed: { $ne: true },
          returnType: 'damage',
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $unwind: '$products' },
      {
        $lookup: {
          from: 'products',
          localField: 'products.productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          damageValue: {
            $sum: {
              $multiply: [
                '$products.quantity',
                { $ifNull: ['$product.purchasePrice', 0] },
              ],
            },
          },
          damagedQty: { $sum: '$products.quantity' },
        },
      },
      {
        $project: {
          _id: 0,
          damageValue: { $round: ['$damageValue', 2] },
          damagedQty: 1,
        },
      },
    ]),
  ]);

  const revenue = revenueAgg[0]?.revenue ?? 0;
  const cogs = revenueAgg[0]?.cogs ?? 0;
  const orderCount = revenueAgg[0]?.orderCount ?? 0;
  const soldQty = revenueAgg[0]?.soldQty ?? 0;
  const grossProfit = Number((revenue - cogs).toFixed(2));
  const totalReturnPayout = returnPayoutAgg[0]?.totalReturnPayout ?? 0;
  const returnCount = returnPayoutAgg[0]?.returnCount ?? 0;
  const damageValue = damageValueAgg[0]?.damageValue ?? 0;
  const damagedQty = damageValueAgg[0]?.damagedQty ?? 0;
  const netProfitLoss = Number((grossProfit - totalReturnPayout - damageValue).toFixed(2));

  return {
    period: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    summary: {
      revenue,
      cogs,
      grossProfit,
      totalReturnPayout,
      damageValue,
      netProfitLoss,
      orderCount,
      soldQty,
      returnCount,
      damagedQty,
    },
  };
}

// ─── 5. Low Stock Alerts ──────────────────────────────────────────────────────
export async function getLowStockReport(filters: StockReportFilters = {}) {
  const productMatch: Record<string, unknown> = {
    isTrashed: { $ne: true },
    survivalQuantity: { $exists: true, $gt: 0 },
    $expr: { $lte: [{ $ifNull: ['$quantity', 0] }, '$survivalQuantity'] },
  };
  if (filters.categoryId) productMatch.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.search) {
    productMatch.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { barcode: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const rows = await ProductModel.aggregate([
    { $match: productMatch },
    {
      $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        name: 1,
        barcode: 1,
        categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
        currentStock: { $ifNull: ['$quantity', 0] },
        survivalQuantity: 1,
        deficit: {
          $subtract: ['$survivalQuantity', { $ifNull: ['$quantity', 0] }],
        },
      },
    },
    { $sort: { deficit: -1, name: 1 } },
  ]);

  return rows;
}
