import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { TaskModel } from '../../models/task.model';
import { OrderModel } from '../../models/order.model';
import { CategoryModel } from '../../models/category.model';
import { ProductModel } from '../../models/product.model';
import { ReturnModel } from '../../models/return.model';
import { RouteModel } from '../../models/route.model';
import { VisitModel } from '../../models/visit.model';
import { Types } from 'mongoose';
import { badRequest } from '../../utils/app-error';
// Shared day handling, so "which day is it, and where does it start and end" has one answer
// across the app.
import {
  REPORT_TIMEZONE,
  isValidDayKey,
  localDayRangeUtc,
  todayDayKey,
} from '../region-sales/region-sales.rules';
import { getRecentActivity } from '../activity-logs/activity-logs.service';

/** Order statuses that count as money actually realised. Mirrors the analytics module. */
const DELIVERED_ORDER_STATUSES = ['delivered'];
/** Committed but not yet delivered — the "booked" half of a sale figure. */
const OPEN_ORDER_STATUSES = ['pending', 'approved', 'packed', 'dispatched'];

/**
 * Bounds for a **timestamp** field (`createdAt`, `completedAt`) on one business day.
 *
 * This used to be `setHours(0, 0, 0, 0)` on the process clock. The API container sets no `TZ`,
 * so that clock is UTC while the business day is `REPORT_TIMEZONE` (Asia/Karachi, UTC+5) — the
 * window ran five hours late. Between midnight and 05:00 PKT every "today" card was still
 * reporting yesterday, and an order booked at 02:00 was filed under the wrong day for good.
 * `localDayRangeUtc` gives the real day (19:00Z the previous evening .. 18:59:59.999Z), which
 * is also what `$dateToString` with the same zone buckets on, so JS-side and DB-side agree.
 */
function timestampDayBounds(dayKey: string): { start: Date; end: Date } {
  return localDayRangeUtc(dayKey);
}

/**
 * Day bounds for a **visit** count, matching `visits.service#findAll` exactly.
 *
 * The visit cards deep-link into `/visits?startDate=&endDate=`, and a card whose number does not
 * match the list it opens is worse than no card. `findAll` bounds a `YYYY-MM-DD` with
 * `setUTCHours`, so this does too. Deliberately *not* `timestampDayBounds`: `visitDate` is a
 * date-only field stored at UTC midnight, not an instant, so shifting its window into
 * Asia/Karachi would drag every visit into the neighbouring day. All three visit counts also
 * key off `visitDate` for the same reason: it is the only field `findAll` filters on.
 */
function visitDayBoundsUtc(dayKey: string): { start: Date; end: Date } {
  const start = new Date(dayKey);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(dayKey);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

export async function getDashboardStats() {
  const todayKey = todayDayKey();
  const { start: today, end: endOfToday } = timestampDayBounds(todayKey);
  const visitDay = visitDayBoundsUtc(todayKey);

  const [
    activeEmployees,
    inactiveEmployees,
    totalClients,
    activeClients,
    totalTasks,
    tasksCompletedToday,
    tasksInProgress,
    totalProducts,
    totalCategories,
    totalOrders,
    totalPendingOrders,
    totalRoutes,
    visitsToday,
    visitsCompletedToday,
    visitsOpenToday,
    ordersToday,
    salesToday,
    recentActivity,
  ] = await Promise.all([
    UserModel.countDocuments({ role: { $ne: 'admin' }, isActive: true, isTrashed: { $ne: true } }),
    UserModel.countDocuments({ role: { $ne: 'admin' }, isActive: false, isTrashed: { $ne: true } }),
    // "Total Clients" opens the unfiltered `/clients` list, so it counts what that list holds:
    // every client that has not been trashed. It previously counted only `status: 'active'`,
    // which is why the card read lower than the page it opened. `activeClients` carries the
    // active half separately for the card's sub-line.
    DealerModel.countDocuments({ isTrashed: { $ne: true } }),
    DealerModel.countDocuments({ status: 'active', isTrashed: { $ne: true } }),
    TaskModel.countDocuments({ isTrashed: { $ne: true } }),
    TaskModel.countDocuments({
      isTrashed: { $ne: true },
      status: 'completed',
      completedAt: { $gte: today, $lte: endOfToday },
    }),
    // Same `isTrashed` guard as the total above, so "in progress" can never exceed it.
    TaskModel.countDocuments({ isTrashed: { $ne: true }, status: 'in_progress' }),
    ProductModel.countDocuments({ isTrashed: { $ne: true } }),
    CategoryModel.countDocuments({ isTrashed: { $ne: true } }),
    OrderModel.countDocuments({ isTrashed: { $ne: true } }),
    OrderModel.countDocuments({ status: 'pending', isTrashed: { $ne: true } }),
    RouteModel.countDocuments({ isTrashed: { $ne: true } }),
    // Visits are the unit of field work now; the task counts above are the legacy module and
    // are kept only so the older cards keep their meaning.
    //
    // All three share one window on `visitDate`, so "X completed of Y scheduled" is a real
    // subset. Counting the completed ones by `completedAt` instead would let a visit scheduled
    // yesterday and finished this morning into the numerator but not the denominator — and
    // "48 of 46" is exactly the kind of figure that costs a dashboard its credibility.
    VisitModel.countDocuments({
      isTrashed: { $ne: true },
      visitDate: { $gte: visitDay.start, $lte: visitDay.end },
    }),
    VisitModel.countDocuments({
      isTrashed: { $ne: true },
      status: 'completed',
      visitDate: { $gte: visitDay.start, $lte: visitDay.end },
    }),
    VisitModel.countDocuments({
      isTrashed: { $ne: true },
      status: { $in: ['todo', 'in_progress', 'checked_in'] },
      visitDate: { $gte: visitDay.start, $lte: visitDay.end },
    }),
    // Same business-day window `orders.service#findAll` applies to `startDate`/`endDate`, so
    // the card's number equals the rows `/orders?startDate=…&endDate=…` returns.
    OrderModel.countDocuments({
      isTrashed: { $ne: true },
      status: { $ne: 'cancelled' },
      createdAt: { $gte: today, $lte: endOfToday },
    }),
    sumOrderAmounts({ $gte: today, $lte: endOfToday }),
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
    // The business day every "today" figure covers, so the cards link to exactly the rows they
    // counted instead of the browser guessing its own "today" from a different clock.
    today: todayKey,
    stats: {
      activeEmployees,
      inactiveEmployees,
      totalClients,
      activeClients,
      totalTasks,
      tasksCompletedToday,
      tasksInProgress,
      totalProducts,
      totalCategories,
      totalOrders,
      totalPendingOrders,
      totalRoutes,
      visitsToday,
      visitsCompletedToday,
      visitsOpenToday,
      ordersToday,
      deliveredSalesToday: salesToday.delivered,
      bookedSalesToday: salesToday.booked,
    },
    recentActivity,
    completedTasksForMap: completedTasksForMap.map((task) => {
      const dealer: any = task.dealerId;
      const clientLocation = dealer
        ? { latitude: dealer.latitude, longitude: dealer.longitude, name: dealer.name }
        : null;
      return {
        taskName: task.taskName,
        employeeName: (task.assignedTo as any)?.username,
        // `clientLocation` is what the admin dashboard map reads. `dealerLocation` is the
        // original name and is kept as an alias so nothing built against it breaks.
        clientLocation,
        dealerLocation: clientLocation,
        completionLocation: { latitude: task.latitude, longitude: task.longitude },
        completedAt: task.completedAt,
      };
    }),
  };
}

/** Delivered vs booked order value in a window, in one pass over the same matched set. */
async function sumOrderAmounts(
  createdAt: Record<string, Date>,
  createdBy?: Types.ObjectId,
): Promise<{ delivered: number; booked: number }> {
  const rows = await OrderModel.aggregate<{ delivered: number; booked: number }>([
    {
      $match: {
        isTrashed: { $ne: true },
        status: { $ne: 'cancelled' },
        createdAt,
        ...(createdBy ? { createdBy } : {}),
      },
    },
    {
      $group: {
        _id: null,
        delivered: {
          $sum: {
            $cond: [
              { $in: ['$status', DELIVERED_ORDER_STATUSES] },
              { $ifNull: ['$grandTotal', 0] },
              0,
            ],
          },
        },
        booked: {
          $sum: {
            $cond: [
              { $in: ['$status', OPEN_ORDER_STATUSES] },
              { $ifNull: ['$grandTotal', 0] },
              0,
            ],
          },
        },
      },
    },
  ]);

  const hit = rows[0];
  return {
    delivered: Math.round((hit?.delivered ?? 0) * 100) / 100,
    booked: Math.round((hit?.booked ?? 0) * 100) / 100,
  };
}

/**
 * The salesman dashboard's cards, counted in the database rather than by fetching a list and
 * filtering it in the browser.
 *
 * The old page pulled every visit and every task and did `.filter()` on the result, which meant
 * the task counts covered the rider's whole history while the visit counts covered today — two
 * cards side by side answering different questions. Everything here is scoped to one day.
 */
export async function getMyDashboardStats(userId: string, date?: string) {
  // Without this an unparseable string becomes an Invalid Date that silently matches nothing,
  // reporting a blank day as though it were real. A shape check is not enough on its own:
  // `2026-02-30` is well-formed and JS quietly rolls it over to March 2, so the report would
  // come back for a day the caller never asked for. `isValidDayKey` round-trips the date to
  // reject the impossible ones — the same guard the region-sales dashboard uses.
  if (date !== undefined && !isValidDayKey(date)) {
    throw badRequest('date must be a valid date in YYYY-MM-DD format');
  }
  const dayKey = date ?? todayDayKey();
  // Business-day bounds for the timestamp fields, not the host clock's — see
  // `timestampDayBounds`. A salesman opening the app at 07:00 PKT was previously shown a window
  // that had only just started, so "My Sale Today" read zero for the first five hours.
  const { start, end } = timestampDayBounds(dayKey);
  // Same window and same field the visits list uses, so each card matches the list it opens.
  const visitDay = visitDayBoundsUtc(dayKey);
  const employeeId = new Types.ObjectId(userId);

  const [visitRows, taskRows, sales] = await Promise.all([
    VisitModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          employeeId,
          isTrashed: { $ne: true },
          visitDate: { $gte: visitDay.start, $lte: visitDay.end },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    TaskModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          assignedTo: employeeId,
          isTrashed: { $ne: true },
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    sumOrderAmounts({ $gte: start, $lte: end }, employeeId),
  ]);

  const countBy = (rows: { _id: string; count: number }[], status: string) =>
    rows.find((r) => r._id === status)?.count ?? 0;
  const total = (rows: { _id: string; count: number }[]) =>
    rows.reduce((sum, r) => sum + r.count, 0);

  return {
    date: dayKey,
    visits: {
      total: total(visitRows),
      todo: countBy(visitRows, 'todo'),
      inProgress: countBy(visitRows, 'in_progress') + countBy(visitRows, 'checked_in'),
      completed: countBy(visitRows, 'completed'),
      skipped: countBy(visitRows, 'skipped'),
      incomplete: countBy(visitRows, 'incomplete'),
      cancelled: countBy(visitRows, 'cancelled'),
    },
    tasks: {
      total: total(taskRows),
      pending: countBy(taskRows, 'pending'),
      inProgress: countBy(taskRows, 'in_progress'),
      completed: countBy(taskRows, 'completed'),
    },
    sales: {
      deliveredAmount: sales.delivered,
      bookedAmount: sales.booked,
      totalAmount: Math.round((sales.delivered + sales.booked) * 100) / 100,
    },
  };
}

type GroupBy = 'day' | 'month' | 'year';
type ViewBy = 'item' | 'category';

/**
 * The reporting window, in business days.
 *
 * The bounds and the `$dateToString` bucketing below have to use the *same* zone or the chart
 * disagrees with itself: a UTC window sliced into Asia/Karachi buckets puts the first and last
 * five hours of the range into periods that are only partly covered, so the end points of every
 * trend line read low for no visible reason. Both now speak `REPORT_TIMEZONE`.
 *
 * Exported because `report-detail.service` has to resolve a range identically — a tile and the
 * drill-down opened from it must cover the same instants. It used to hold a copy of this, which
 * is exactly the kind of duplicate that drifts.
 */
export function getDateRange(startDate?: string, endDate?: string) {
  if (startDate !== undefined && !isValidDayKey(startDate)) {
    throw badRequest('startDate must be a valid date in YYYY-MM-DD format');
  }
  if (endDate !== undefined && !isValidDayKey(endDate)) {
    throw badRequest('endDate must be a valid date in YYYY-MM-DD format');
  }

  const endKey = endDate ?? todayDayKey();
  let startKey = startDate;
  if (!startKey) {
    // Default window: the 30 business days ending today, inclusive.
    const [y, m, d] = endKey.split('-').map(Number);
    const cursor = new Date(Date.UTC(y, m - 1, d));
    cursor.setUTCDate(cursor.getUTCDate() - 29);
    startKey = cursor.toISOString().slice(0, 10);
  }

  return {
    start: localDayRangeUtc(startKey).start,
    end: localDayRangeUtc(endKey).end,
  };
}

function getPeriodExpression(groupBy: GroupBy) {
  const timezone = REPORT_TIMEZONE;
  if (groupBy === 'year') {
    return { $dateToString: { format: '%Y', date: '$createdAt', timezone } };
  }
  if (groupBy === 'month') {
    return { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone } };
  }
  return { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } };
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
