import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { TaskModel } from '../../models/task.model';
import { OrderModel } from '../../models/order.model';
import { CategoryModel } from '../../models/category.model';
import { ProductModel } from '../../models/product.model';
import { ReturnModel } from '../../models/return.model';
import { RouteModel } from '../../models/route.model';
import { getRecentActivity } from '../activity-logs/activity-logs.service';

export async function getDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    activeEmployees,
    inactiveEmployees,
    totalClients,
    totalTasks,
    tasksCompletedToday,
    tasksInProgress,
    totalProducts,
    totalCategories,
    totalOrders,
    totalPendingOrders,
    totalRoutes,
    recentActivity,
  ] = await Promise.all([
    UserModel.countDocuments({ role: { $ne: 'admin' }, isActive: true, isTrashed: { $ne: true } }),
    UserModel.countDocuments({ role: { $ne: 'admin' }, isActive: false, isTrashed: { $ne: true } }),
    DealerModel.countDocuments({ status: 'active', isTrashed: { $ne: true } }),
    TaskModel.countDocuments({ isTrashed: { $ne: true } }),
    TaskModel.countDocuments({ status: 'completed', completedAt: { $gte: today, $lt: tomorrow } }),
    TaskModel.countDocuments({ status: 'in_progress' }),
    ProductModel.countDocuments({ isTrashed: { $ne: true } }),
    CategoryModel.countDocuments({ isTrashed: { $ne: true } }),
    OrderModel.countDocuments({ isTrashed: { $ne: true } }),
    OrderModel.countDocuments({ status: 'pending', isTrashed: { $ne: true } }),
    RouteModel.countDocuments({ isTrashed: { $ne: true } }),
    getRecentActivity(10),
  ]);

  const completedTasksForMap = await TaskModel.find({
    status: 'completed',
    latitude: { $exists: true },
    longitude: { $exists: true },
  })
    .populate('dealerId')
    .populate('assignedTo', 'username')
    .limit(50)
    .exec();

  return {
    stats: {
      activeEmployees,
      inactiveEmployees,
      totalClients,
      totalTasks,
      tasksCompletedToday,
      tasksInProgress,
      totalProducts,
      totalCategories,
      totalOrders,
      totalPendingOrders,
      totalRoutes,
    },
    recentActivity,
    completedTasksForMap: completedTasksForMap.map((task) => {
      const dealer: any = task.dealerId;
      return {
        taskName: task.taskName,
        employeeName: (task.assignedTo as any)?.username,
        dealerLocation: dealer
          ? { latitude: dealer.latitude, longitude: dealer.longitude, name: dealer.name }
          : null,
        completionLocation: { latitude: task.latitude, longitude: task.longitude },
        completedAt: task.completedAt,
      };
    }),
  };
}

type GroupBy = 'day' | 'month' | 'year';
type ViewBy = 'item' | 'category';

function getDateRange(startDate?: string, endDate?: string) {
  const end = endDate ? new Date(endDate) : new Date();
  end.setUTCHours(23, 59, 59, 999);

  const start = startDate ? new Date(startDate) : new Date(end);
  if (!startDate) {
    start.setUTCDate(start.getUTCDate() - 29);
  }
  start.setUTCHours(0, 0, 0, 0);

  return { start, end };
}

function getPeriodExpression(groupBy: GroupBy) {
  if (groupBy === 'year') {
    return { $dateToString: { format: '%Y', date: '$createdAt' } };
  }
  if (groupBy === 'month') {
    return { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
  }
  return { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
}

export async function getDashboardReports(params: {
  startDate?: string;
  endDate?: string;
  groupBy?: GroupBy;
  viewBy?: ViewBy;
}) {
  const groupBy: GroupBy = params.groupBy ?? 'month';
  const viewBy: ViewBy = params.viewBy ?? 'item';
  const { start, end } = getDateRange(params.startDate, params.endDate);
  const periodExpr = getPeriodExpression(groupBy);

  const salesTrendPromise = OrderModel.aggregate([
    {
      $match: {
        isTrashed: { $ne: true },
        status: 'delivered',
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: periodExpr,
        totalSales: { $sum: { $ifNull: ['$grandTotal', 0] } },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        period: '$_id',
        totalSales: { $round: ['$totalSales', 2] },
        orderCount: 1,
      },
    },
  ]);

  const bookedSalesKpiPromise = OrderModel.aggregate([
    {
      $match: {
        isTrashed: { $ne: true },
        status: { $in: ['pending', 'approved', 'packed', 'dispatched'] },
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        bookedSalesInRange: { $sum: { $ifNull: ['$grandTotal', 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        bookedSalesInRange: { $round: ['$bookedSalesInRange', 2] },
      },
    },
  ]);

  const bookedSalesTrendPromise = OrderModel.aggregate([
    {
      $match: {
        isTrashed: { $ne: true },
        status: { $in: ['pending', 'approved', 'packed', 'dispatched'] },
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: periodExpr,
        bookedSales: { $sum: { $ifNull: ['$grandTotal', 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, period: '$_id', bookedSales: { $round: ['$bookedSales', 2] } } },
  ]);

  const categoryGrowthPromise = CategoryModel.aggregate([
    { $match: { isTrashed: { $ne: true }, createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: periodExpr, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, period: '$_id', count: 1 } },
  ]);

  const productGrowthPromise = ProductModel.aggregate([
    { $match: { isTrashed: { $ne: true }, createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: periodExpr, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, period: '$_id', count: 1 } },
  ]);

  const returnTrendPromise = ReturnModel.aggregate([
    { $match: { isTrashed: { $ne: true }, status: 'completed', createdAt: { $gte: start, $lte: end } } },
    { $unwind: '$products' },
    {
      $group: {
        _id: { period: periodExpr, returnType: '$returnType' },
        qty: { $sum: { $ifNull: ['$products.quantity', 0] } },
      },
    },
    {
      $group: {
        _id: '$_id.period',
        returnedQty: {
          $sum: { $cond: [{ $eq: ['$_id.returnType', 'return'] }, '$qty', 0] },
        },
        damagedQty: {
          $sum: { $cond: [{ $eq: ['$_id.returnType', 'damage'] }, '$qty', 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, period: '$_id', returnedQty: 1, damagedQty: 1 } },
  ]);

  const returnPayoutPromise = ReturnModel.aggregate([
    {
      $match: {
        isTrashed: { $ne: true },
        status: 'completed',
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        totalReturnPayout: { $sum: { $ifNull: ['$amount', 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        totalReturnPayout: { $round: ['$totalReturnPayout', 2] },
      },
    },
  ]);

  const returnPayoutTrendPromise = ReturnModel.aggregate([
    {
      $match: {
        isTrashed: { $ne: true },
        status: 'completed',
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: periodExpr,
        paidBack: { $sum: { $ifNull: ['$amount', 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, period: '$_id', paidBack: { $round: ['$paidBack', 2] } } },
  ]);

  const soldQtyTrendPromise = OrderModel.aggregate([
    {
      $match: {
        isTrashed: { $ne: true },
        status: 'delivered',
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $unwind: '$products' },
    {
      $group: {
        _id: periodExpr,
        soldQty: { $sum: { $ifNull: ['$products.quantity', 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, period: '$_id', soldQty: 1 } },
  ]);

  const stockByItemPromise = ProductModel.aggregate([
    { $match: { isTrashed: { $ne: true } } },
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
        from: 'returns',
        let: { pid: '$_id' },
        pipeline: [
          { $match: { isTrashed: { $ne: true }, status: 'completed' } },
          { $unwind: '$products' },
          { $match: { $expr: { $eq: ['$products.productId', '$$pid'] } } },
          {
            $group: {
              _id: '$returnType',
              qty: { $sum: { $ifNull: ['$products.quantity', 0] } },
            },
          },
        ],
        as: 'returnAgg',
      },
    },
    {
      $addFields: {
        onHoldQty: { $ifNull: [{ $arrayElemAt: ['$holdAgg.qty', 0] }, 0] },
        returnedQty: {
          $ifNull: [
            {
              $first: {
                $map: {
                  input: {
                    $filter: {
                      input: '$returnAgg',
                      as: 'r',
                      cond: { $eq: ['$$r._id', 'return'] },
                    },
                  },
                  as: 'r',
                  in: '$$r.qty',
                },
              },
            },
            0,
          ],
        },
        damagedQty: {
          $ifNull: [
            {
              $first: {
                $map: {
                  input: {
                    $filter: {
                      input: '$returnAgg',
                      as: 'r',
                      cond: { $eq: ['$$r._id', 'damage'] },
                    },
                  },
                  as: 'r',
                  in: '$$r.qty',
                },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        productName: '$name',
        categoryId: '$category._id',
        categoryName: '$category.name',
        availableQty: { $ifNull: ['$quantity', 0] },
        onHoldQty: 1,
        returnedQty: 1,
        damagedQty: 1,
      },
    },
    { $sort: { productName: 1 } },
  ]);

  const salesByItemPromise = OrderModel.aggregate([
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
      $lookup: {
        from: 'categories',
        localField: 'product.categoryId',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$products.productId',
        productName: { $first: '$product.name' },
        categoryId: { $first: '$category._id' },
        categoryName: { $first: '$category.name' },
        soldQty: { $sum: { $ifNull: ['$products.quantity', 0] } },
        salesAmount: {
          $sum: {
            $multiply: [
              { $ifNull: ['$products.quantity', 0] },
              { $ifNull: ['$products.price', 0] },
            ],
          },
        },
        orderIds: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        productName: { $ifNull: ['$productName', 'Unknown product'] },
        categoryId: 1,
        categoryName: { $ifNull: ['$categoryName', 'Uncategorized'] },
        soldQty: 1,
        salesAmount: { $round: ['$salesAmount', 2] },
        orderCount: { $size: '$orderIds' },
      },
    },
    { $sort: { productName: 1 } },
  ]);

  const [salesTrend, soldQtyTrend, bookedSalesTrend, bookedSalesRows, categoryGrowth, productGrowth, returnTrend, returnPayoutRows, returnPayoutTrend, stockByItem, salesByItem] = await Promise.all([
    salesTrendPromise,
    soldQtyTrendPromise,
    bookedSalesTrendPromise,
    bookedSalesKpiPromise,
    categoryGrowthPromise,
    productGrowthPromise,
    returnTrendPromise,
    returnPayoutPromise,
    returnPayoutTrendPromise,
    stockByItemPromise,
    salesByItemPromise,
  ]);

  const stockByCategoryMap = new Map<
    string,
    {
      categoryId: string | null;
      categoryName: string;
      availableQty: number;
      onHoldQty: number;
      returnedQty: number;
      damagedQty: number;
      productCount: number;
    }
  >();

  for (const item of stockByItem as any[]) {
    const categoryId = item.categoryId ? String(item.categoryId) : 'uncategorized';
    const existing = stockByCategoryMap.get(categoryId) ?? {
      categoryId: item.categoryId ? String(item.categoryId) : null,
      categoryName: item.categoryName ?? 'Uncategorized',
      availableQty: 0,
      onHoldQty: 0,
      returnedQty: 0,
      damagedQty: 0,
      productCount: 0,
    };
    existing.availableQty += item.availableQty ?? 0;
    existing.onHoldQty += item.onHoldQty ?? 0;
    existing.returnedQty += item.returnedQty ?? 0;
    existing.damagedQty += item.damagedQty ?? 0;
    existing.productCount += 1;
    stockByCategoryMap.set(categoryId, existing);
  }

  const stockByCategory = Array.from(stockByCategoryMap.values()).sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName),
  );

  const salesByCategoryMap = new Map<
    string,
    {
      categoryId: string | null;
      categoryName: string;
      soldQty: number;
      salesAmount: number;
      orderCount: number;
      productCount: number;
    }
  >();

  for (const item of salesByItem as any[]) {
    const categoryId = item.categoryId ? String(item.categoryId) : 'uncategorized';
    const existing = salesByCategoryMap.get(categoryId) ?? {
      categoryId: item.categoryId ? String(item.categoryId) : null,
      categoryName: item.categoryName ?? 'Uncategorized',
      soldQty: 0,
      salesAmount: 0,
      orderCount: 0,
      productCount: 0,
    };
    existing.soldQty += item.soldQty ?? 0;
    existing.salesAmount += item.salesAmount ?? 0;
    existing.orderCount += item.orderCount ?? 0;
    existing.productCount += 1;
    salesByCategoryMap.set(categoryId, existing);
  }

  const salesByCategory = Array.from(salesByCategoryMap.values())
    .map((row) => ({ ...row, salesAmount: Number((row.salesAmount ?? 0).toFixed(2)) }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));

  const stockSource = viewBy === 'category' ? stockByCategory : (stockByItem as any[]);
  const salesSource = viewBy === 'category' ? salesByCategory : (salesByItem as any[]);
  const totalCurrentStock = stockByItem.reduce((sum: number, row: any) => sum + (row.availableQty ?? 0), 0);
  const totalHoldStock = stockByItem.reduce((sum: number, row: any) => sum + (row.onHoldQty ?? 0), 0);
  const totalReturnedQty = stockByItem.reduce((sum: number, row: any) => sum + (row.returnedQty ?? 0), 0);
  const totalDamagedQty = stockByItem.reduce((sum: number, row: any) => sum + (row.damagedQty ?? 0), 0);
  const totalSoldQty = salesByItem.reduce((sum: number, row: any) => sum + (row.soldQty ?? 0), 0);
  const salesInRange = salesTrend.reduce((sum: number, row: any) => sum + (row.totalSales ?? 0), 0);
  const bookedSalesInRange = Number(bookedSalesRows?.[0]?.bookedSalesInRange ?? 0);
  const totalReturnPayout = Number(returnPayoutRows?.[0]?.totalReturnPayout ?? 0);
  const netAfterReturns = Number((salesInRange - totalReturnPayout).toFixed(2));

  const totalProducts = await ProductModel.countDocuments({ isTrashed: { $ne: true } });
  const totalCategories = await CategoryModel.countDocuments({ isTrashed: { $ne: true } });

  return {
    filters: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      groupBy,
      viewBy,
    },
    kpis: {
      totalCurrentStock,
      totalHoldStock,
      totalReturnedQty,
      totalDamagedQty,
      totalSoldQty,
      salesInRange: Number(salesInRange.toFixed(2)),
      bookedSalesInRange,
      totalReturnPayout,
      netAfterReturns,
      totalProducts,
      totalCategories,
    },
    salesTrend,
    soldQtyTrend,
    bookedSalesTrend,
    returnPayoutTrend,
    categoryGrowth,
    productGrowth,
    returnTrend,
    stockByItem,
    stockByCategory,
    stockReport: stockSource,
    salesByItem,
    salesByCategory,
    salesReport: salesSource,
  };
}
