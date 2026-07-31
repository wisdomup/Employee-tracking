import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { VisitModel } from '../../models/visit.model';
import { DealerModel } from '../../models/dealer.model';
import { UserModel } from '../../models/user.model';
import { TargetModel } from '../../models/target.model';
import { AttendanceModel } from '../../models/attendance.model';
import { ReturnModel } from '../../models/return.model';
import { TaskModel } from '../../models/task.model';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import { VISIT_COMPLETION_THRESHOLD_PERCENT } from '../visits/visits.rules';
import { ROLES, FIELD_STAFF_ROLES } from '../../constants/global';
import {
  toPeriodMonth,
  isValidPeriodMonth,
  periodMonthToRange,
  achievementPercent,
  remainingToTarget,
  achievementStatus,
  monthElapsedFraction,
  safeRate,
} from './analytics.rules';

/** Order statuses that count as realised revenue. */
const DELIVERED_STATUSES = ['delivered'];
/** Order statuses that are committed but not yet delivered. */
const BOOKED_STATUSES = ['pending', 'approved', 'packed', 'dispatched'];

export interface PerformanceFilters {
  /** `YYYY-MM`; defaults to the current month. */
  periodMonth?: string;
  /** Narrow to a single employee (must be within the caller's scope). */
  employeeId?: string;
}

export interface PerformanceRow {
  employeeId: string;
  username: string;
  fullName?: string;
  userID?: string;
  role: string;
  managerId?: string;
  managerName?: string;
  // Actuals
  salesAmount: number;
  bookedAmount: number;
  orderCount: number;
  visitsCompleted: number;
  visitsAssigned: number;
  visitsSkipped: number;
  visitCompletionRate: number;
  belowVisitThreshold: boolean;
  avgVisitMinutes: number | null;
  overstayCount: number;
  newClients: number;
  // Attendance & reliability
  daysPresent: number;
  hoursWorked: number;
  avgHoursPerDay: number | null;
  // Quality
  returnCount: number;
  returnAmount: number;
  damageCount: number;
  returnRatePercent: number;
  // Tasks
  tasksAssigned: number;
  tasksCompleted: number;
  taskCompletionRate: number;
  // Collection health
  invoicedTotal: number;
  collectedTotal: number;
  outstandingTotal: number;
  collectionRatePercent: number;
  discountTotal: number;
  creditOrders: number;
  shopsOrderedFrom: number;
  // Efficiency ratios
  avgOrderValue: number;
  salesPerDayPresent: number;
  visitsPerDayPresent: number;
  strikeRatePercent: number;
  // Flags
  flagsTotal: number;
  flagsOpen: number;
  lowCompletionFlags: number;
  // Targets and progress
  targetSalesAmount: number | null;
  targetOrderCount: number | null;
  targetVisitCount: number | null;
  salesAchievementPercent: number | null;
  orderAchievementPercent: number | null;
  visitAchievementPercent: number | null;
  salesRemaining: number | null;
  status: string;
}

/**
 * Resolves which employees the caller may see analytics for.
 * Returns `null` for admin (unrestricted).
 */
async function resolveScope(
  viewerId: string,
  viewerRole: string,
): Promise<Types.ObjectId[] | null> {
  if (viewerRole === ROLES.ADMIN) return null;

  const self = new Types.ObjectId(viewerId);
  if (viewerRole !== ROLES.SALES_MANAGER) return [self];

  const team = await UserModel.find({ managerId: self, isTrashed: { $ne: true } })
    .select('_id')
    .lean()
    .exec();
  return [self, ...team.map((m) => m._id as Types.ObjectId)];
}

/**
 * Per-employee performance for one month, with targets and achievement.
 *
 * Everything is bucketed on `createdAt` for orders (consistent with the existing
 * dashboard reports) and on `completedAt` for visits, since a visit only counts once
 * the rider has actually checked out.
 */
export async function getPerformance(
  filters: PerformanceFilters,
  viewerId: string,
  viewerRole: string,
) {
  const now = new Date();
  const periodMonth =
    filters.periodMonth && isValidPeriodMonth(filters.periodMonth)
      ? filters.periodMonth
      : toPeriodMonth(now);
  const { start, end } = periodMonthToRange(periodMonth);

  const scopeIds = await resolveScope(viewerId, viewerRole);

  // Build the employee set this report covers.
  const employeeQuery: Record<string, unknown> = {
    isTrashed: { $ne: true },
    role: { $in: FIELD_STAFF_ROLES },
  };
  if (scopeIds) employeeQuery._id = { $in: scopeIds };
  if (filters.employeeId) {
    const requested = new Types.ObjectId(filters.employeeId);
    // Asking for someone outside your scope yields an empty report, not a leak.
    if (scopeIds && !scopeIds.some((id) => id.equals(requested))) {
      return emptyReport(periodMonth, start, end);
    }
    employeeQuery._id = requested;
  }

  const employees = await UserModel.find(employeeQuery)
    .select('_id username fullName userID role managerId')
    .lean()
    .exec();

  if (employees.length === 0) {
    return emptyReport(periodMonth, start, end);
  }

  const employeeIds = employees.map((e) => e._id as Types.ObjectId);
  const dateRange = { $gte: start, $lte: end };

  const [
    salesByEmployee,
    bookedByEmployee,
    visitsByEmployee,
    newClientsByEmployee,
    attendanceByEmployee,
    returnsByEmployee,
    tasksByEmployee,
    collectionByEmployee,
    flagsByEmployee,
    targets,
    managers,
  ] = await Promise.all([
    // Delivered revenue + order count per employee
    OrderModel.aggregate([
      {
        $match: {
          createdBy: { $in: employeeIds },
          isTrashed: { $ne: true },
          status: { $in: DELIVERED_STATUSES },
          createdAt: dateRange,
        },
      },
      {
        $group: {
          _id: '$createdBy',
          salesAmount: { $sum: { $ifNull: ['$grandTotal', 0] } },
          orderCount: { $sum: 1 },
        },
      },
    ]),

    // Booked-but-not-delivered value per employee
    OrderModel.aggregate([
      {
        $match: {
          createdBy: { $in: employeeIds },
          isTrashed: { $ne: true },
          status: { $in: BOOKED_STATUSES },
          createdAt: dateRange,
        },
      },
      {
        $group: {
          _id: '$createdBy',
          bookedAmount: { $sum: { $ifNull: ['$grandTotal', 0] } },
          bookedCount: { $sum: 1 },
        },
      },
    ]),

    // Visit productivity: completed count, assigned count, avg time at store, overstays.
    // Bucketed on the scheduled day (visitDate), falling back to createdAt for visits
    // made outside the cron. Using `$or` on visitDate/completedAt would double-count a
    // visit scheduled in one month and completed in the next.
    VisitModel.aggregate([
      {
        $match: {
          employeeId: { $in: employeeIds },
          isTrashed: { $ne: true },
        },
      },
      { $addFields: { effectiveDate: { $ifNull: ['$visitDate', '$createdAt'] } } },
      { $match: { effectiveDate: dateRange } },
      {
        $group: {
          _id: '$employeeId',
          // Cancelled visits are not work the rider failed to do, so they are excluded
          // from the denominator of the completion rate.
          visitsAssigned: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 0, 1] },
          },
          visitsCompleted: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          visitsSkipped: {
            $sum: { $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0] },
          },
          overstayCount: {
            $sum: { $cond: [{ $eq: ['$overstayFlagged', true] }, 1, 0] },
          },
          // Averaged only over visits that actually recorded a duration. The -1
          // sentinel excludes both missing and null while still counting a genuine
          // 0-minute visit ($ne against null does NOT reliably exclude missing here).
          totalMinutes: { $sum: { $ifNull: ['$durationMinutes', 0] } },
          timedVisits: {
            $sum: { $cond: [{ $gte: [{ $ifNull: ['$durationMinutes', -1] }, 0] }, 1, 0] },
          },
        },
      },
    ]),

    // New shops registered in the period, credited to whoever created them
    DealerModel.aggregate([
      {
        $match: {
          createdBy: { $in: employeeIds },
          isTrashed: { $ne: true },
          createdAt: dateRange,
        },
      },
      { $group: { _id: '$createdBy', newClients: { $sum: 1 } } },
    ]),

    // Attendance: days present and hours worked. `date` is the attendance day.
    AttendanceModel.aggregate([
      {
        $match: {
          employeeId: { $in: employeeIds },
          isTrashed: { $ne: true },
          date: dateRange,
        },
      },
      {
        $group: {
          _id: '$employeeId',
          daysPresent: { $sum: 1 },
          // Only completed shifts contribute hours; an open shift has no checkOutTime.
          shiftsClosed: { $sum: { $cond: [{ $ifNull: ['$checkOutTime', false] }, 1, 0] } },
          totalMinutesWorked: {
            $sum: {
              $cond: [
                { $ifNull: ['$checkOutTime', false] },
                { $divide: [{ $subtract: ['$checkOutTime', '$checkInTime'] }, 60000] },
                0,
              ],
            },
          },
        },
      },
    ]),

    // Returns and damages raised by the employee — the quality signal.
    ReturnModel.aggregate([
      {
        $match: {
          createdBy: { $in: employeeIds },
          isTrashed: { $ne: true },
          createdAt: dateRange,
        },
      },
      {
        $group: {
          _id: '$createdBy',
          returnCount: { $sum: 1 },
          returnAmount: { $sum: { $ifNull: ['$amount', 0] } },
          damageCount: { $sum: { $cond: [{ $eq: ['$returnType', 'damage'] }, 1, 0] } },
        },
      },
    ]),

    // Assigned task throughput.
    TaskModel.aggregate([
      { $match: { assignedTo: { $in: employeeIds }, createdAt: dateRange } },
      {
        $group: {
          _id: '$assignedTo',
          tasksAssigned: { $sum: 1 },
          tasksCompleted: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        },
      },
    ]),

    // Collection health: what was invoiced vs actually paid, and the payment mix.
    OrderModel.aggregate([
      {
        $match: {
          createdBy: { $in: employeeIds },
          isTrashed: { $ne: true },
          status: { $nin: ['cancelled'] },
          createdAt: dateRange,
        },
      },
      {
        $group: {
          _id: '$createdBy',
          invoicedTotal: { $sum: { $ifNull: ['$grandTotal', 0] } },
          collectedTotal: { $sum: { $ifNull: ['$paidAmount', 0] } },
          discountTotal: { $sum: { $ifNull: ['$discount', 0] } },
          creditOrders: { $sum: { $cond: [{ $eq: ['$paymentType', 'credit'] }, 1, 0] } },
          cancelledOrders: { $sum: 0 },
          distinctDealers: { $addToSet: '$dealerId' },
        },
      },
      {
        $project: {
          invoicedTotal: 1,
          collectedTotal: 1,
          discountTotal: 1,
          creditOrders: 1,
          shopsOrderedFrom: { $size: '$distinctDealers' },
        },
      },
    ]),

    // Open admin flags in the period (overstay + low completion).
    PerformanceFlagModel.aggregate([
      { $match: { employeeId: { $in: employeeIds }, flagDate: dateRange } },
      {
        $group: {
          _id: '$employeeId',
          flagsTotal: { $sum: 1 },
          flagsOpen: { $sum: { $cond: [{ $eq: ['$resolved', false] }, 1, 0] } },
          lowCompletionFlags: {
            $sum: { $cond: [{ $eq: ['$type', 'low_visit_completion'] }, 1, 0] },
          },
        },
      },
    ]),

    TargetModel.find({ employeeId: { $in: employeeIds }, periodMonth }).lean().exec(),

    UserModel.find({
      _id: { $in: employees.map((e) => e.managerId).filter(Boolean) as Types.ObjectId[] },
    })
      .select('_id username fullName userID')
      .lean()
      .exec(),
  ]);

  const byId = <T extends { _id: unknown }>(rows: T[]) =>
    new Map(rows.map((r) => [String(r._id), r]));

  const salesMap = byId(salesByEmployee);
  const bookedMap = byId(bookedByEmployee);
  const visitsMap = byId(visitsByEmployee);
  const clientsMap = byId(newClientsByEmployee);
  const attendanceMap = byId(attendanceByEmployee);
  const returnsMap = byId(returnsByEmployee);
  const tasksMap = byId(tasksByEmployee);
  const collectionMap = byId(collectionByEmployee);
  const flagsMap = byId(flagsByEmployee);
  const targetMap = new Map(targets.map((t) => [String(t.employeeId), t]));
  const managerMap = new Map(managers.map((m) => [String(m._id), m]));

  const elapsed = monthElapsedFraction(periodMonth, now);

  const rows: PerformanceRow[] = employees.map((employee) => {
    const id = String(employee._id);
    const sales = salesMap.get(id) as { salesAmount?: number; orderCount?: number } | undefined;
    const booked = bookedMap.get(id) as { bookedAmount?: number } | undefined;
    const visits = visitsMap.get(id) as
      | {
          visitsAssigned?: number;
          visitsCompleted?: number;
          visitsSkipped?: number;
          overstayCount?: number;
          totalMinutes?: number;
          timedVisits?: number;
        }
      | undefined;
    const clients = clientsMap.get(id) as { newClients?: number } | undefined;
    const attendance = attendanceMap.get(id) as
      | { daysPresent?: number; shiftsClosed?: number; totalMinutesWorked?: number }
      | undefined;
    const returns = returnsMap.get(id) as
      | { returnCount?: number; returnAmount?: number; damageCount?: number }
      | undefined;
    const tasks = tasksMap.get(id) as
      | { tasksAssigned?: number; tasksCompleted?: number }
      | undefined;
    const collection = collectionMap.get(id) as
      | {
          invoicedTotal?: number;
          collectedTotal?: number;
          discountTotal?: number;
          creditOrders?: number;
          shopsOrderedFrom?: number;
        }
      | undefined;
    const flags = flagsMap.get(id) as
      | { flagsTotal?: number; flagsOpen?: number; lowCompletionFlags?: number }
      | undefined;
    const target = targetMap.get(id);
    const manager = employee.managerId ? managerMap.get(String(employee.managerId)) : undefined;

    const salesAmount = sales?.salesAmount ?? 0;
    const orderCount = sales?.orderCount ?? 0;
    const visitsCompleted = visits?.visitsCompleted ?? 0;
    const visitsAssigned = visits?.visitsAssigned ?? 0;
    const timedVisits = visits?.timedVisits ?? 0;
    const daysPresent = attendance?.daysPresent ?? 0;
    const hoursWorked = Math.round(((attendance?.totalMinutesWorked ?? 0) / 60) * 10) / 10;
    const invoicedTotal = collection?.invoicedTotal ?? 0;
    const collectedTotal = collection?.collectedTotal ?? 0;
    const visitRate = safeRate(visitsCompleted, visitsAssigned);

    return {
      employeeId: id,
      username: employee.username,
      fullName: employee.fullName,
      userID: employee.userID,
      role: employee.role,
      managerId: employee.managerId ? String(employee.managerId) : undefined,
      managerName: manager?.fullName || manager?.username,

      salesAmount,
      bookedAmount: booked?.bookedAmount ?? 0,
      orderCount,
      visitsCompleted,
      visitsAssigned,
      visitsSkipped: visits?.visitsSkipped ?? 0,
      visitCompletionRate: visitRate,
      /** Below the 75% pass mark for the period. */
      belowVisitThreshold: visitsAssigned > 0 && visitRate < VISIT_COMPLETION_THRESHOLD_PERCENT,
      avgVisitMinutes: timedVisits
        ? Math.round(((visits?.totalMinutes ?? 0) / timedVisits) * 10) / 10
        : null,
      overstayCount: visits?.overstayCount ?? 0,
      newClients: clients?.newClients ?? 0,

      // Attendance & reliability
      daysPresent,
      hoursWorked,
      avgHoursPerDay: daysPresent ? Math.round((hoursWorked / daysPresent) * 10) / 10 : null,

      // Quality
      returnCount: returns?.returnCount ?? 0,
      returnAmount: returns?.returnAmount ?? 0,
      damageCount: returns?.damageCount ?? 0,
      /** Returns as a share of delivered sales — high means quality or ordering issues. */
      returnRatePercent: safeRate(returns?.returnAmount ?? 0, salesAmount),

      // Tasks
      tasksAssigned: tasks?.tasksAssigned ?? 0,
      tasksCompleted: tasks?.tasksCompleted ?? 0,
      taskCompletionRate: safeRate(tasks?.tasksCompleted ?? 0, tasks?.tasksAssigned ?? 0),

      // Collection health
      invoicedTotal,
      collectedTotal,
      outstandingTotal: Math.max(0, invoicedTotal - collectedTotal),
      collectionRatePercent: safeRate(collectedTotal, invoicedTotal),
      discountTotal: collection?.discountTotal ?? 0,
      creditOrders: collection?.creditOrders ?? 0,
      shopsOrderedFrom: collection?.shopsOrderedFrom ?? 0,

      // Efficiency ratios
      avgOrderValue: orderCount ? Math.round((salesAmount / orderCount) * 100) / 100 : 0,
      salesPerDayPresent: daysPresent ? Math.round((salesAmount / daysPresent) * 100) / 100 : 0,
      visitsPerDayPresent: daysPresent
        ? Math.round((visitsCompleted / daysPresent) * 10) / 10
        : 0,
      /** Share of completed visits that produced an order. */
      strikeRatePercent: safeRate(orderCount, visitsCompleted),

      // Flags
      flagsTotal: flags?.flagsTotal ?? 0,
      flagsOpen: flags?.flagsOpen ?? 0,
      lowCompletionFlags: flags?.lowCompletionFlags ?? 0,

      targetSalesAmount: target?.salesAmount ?? null,
      targetOrderCount: target?.orderCount ?? null,
      targetVisitCount: target?.visitCount ?? null,
      salesAchievementPercent: achievementPercent(salesAmount, target?.salesAmount),
      orderAchievementPercent: achievementPercent(orderCount, target?.orderCount),
      visitAchievementPercent: achievementPercent(visitsCompleted, target?.visitCount),
      salesRemaining: remainingToTarget(salesAmount, target?.salesAmount),
      status: achievementStatus(salesAmount, target?.salesAmount, elapsed),
    };
  });

  rows.sort((a, b) => b.salesAmount - a.salesAmount);

  // Team-wide totals
  const totals = rows.reduce(
    (acc, r) => {
      acc.salesAmount += r.salesAmount;
      acc.bookedAmount += r.bookedAmount;
      acc.orderCount += r.orderCount;
      acc.visitsCompleted += r.visitsCompleted;
      acc.visitsAssigned += r.visitsAssigned;
      acc.visitsSkipped += r.visitsSkipped;
      acc.overstayCount += r.overstayCount;
      acc.newClients += r.newClients;
      acc.daysPresent += r.daysPresent;
      acc.hoursWorked += r.hoursWorked;
      acc.returnCount += r.returnCount;
      acc.returnAmount += r.returnAmount;
      acc.damageCount += r.damageCount;
      acc.tasksAssigned += r.tasksAssigned;
      acc.tasksCompleted += r.tasksCompleted;
      acc.invoicedTotal += r.invoicedTotal;
      acc.collectedTotal += r.collectedTotal;
      acc.outstandingTotal += r.outstandingTotal;
      acc.discountTotal += r.discountTotal;
      acc.flagsOpen += r.flagsOpen;
      acc.targetSalesAmount += r.targetSalesAmount ?? 0;
      acc.targetOrderCount += r.targetOrderCount ?? 0;
      acc.targetVisitCount += r.targetVisitCount ?? 0;
      return acc;
    },
    {
      salesAmount: 0,
      bookedAmount: 0,
      orderCount: 0,
      visitsCompleted: 0,
      visitsAssigned: 0,
      visitsSkipped: 0,
      overstayCount: 0,
      newClients: 0,
      daysPresent: 0,
      hoursWorked: 0,
      returnCount: 0,
      returnAmount: 0,
      damageCount: 0,
      tasksAssigned: 0,
      tasksCompleted: 0,
      invoicedTotal: 0,
      collectedTotal: 0,
      outstandingTotal: 0,
      discountTotal: 0,
      flagsOpen: 0,
      targetSalesAmount: 0,
      targetOrderCount: 0,
      targetVisitCount: 0,
    },
  );

  return {
    filters: { periodMonth, start, end, employeeId: filters.employeeId ?? null },
    kpis: {
      ...totals,
      headcount: rows.length,
      ridersWithTarget: rows.filter((r) => r.targetSalesAmount != null).length,
      ridersAchieved: rows.filter((r) => (r.salesAchievementPercent ?? 0) >= 100).length,
      ridersBehind: rows.filter((r) => r.status === 'behind').length,
      ridersBelowVisitThreshold: rows.filter((r) => r.belowVisitThreshold).length,
      visitCompletionRate: safeRate(totals.visitsCompleted, totals.visitsAssigned),
      visitThresholdPercent: VISIT_COMPLETION_THRESHOLD_PERCENT,
      taskCompletionRate: safeRate(totals.tasksCompleted, totals.tasksAssigned),
      collectionRatePercent: safeRate(totals.collectedTotal, totals.invoicedTotal),
      returnRatePercent: safeRate(totals.returnAmount, totals.salesAmount),
      avgOrderValue: totals.orderCount
        ? Math.round((totals.salesAmount / totals.orderCount) * 100) / 100
        : 0,
      strikeRatePercent: safeRate(totals.orderCount, totals.visitsCompleted),
      salesAchievementPercent: achievementPercent(
        totals.salesAmount,
        totals.targetSalesAmount || null,
      ),
      monthElapsedPercent: Math.round(elapsed * 1000) / 10,
    },
    rows,
  };
}

/**
 * Zeroed report with EXACTLY the same key set as a populated one, so the frontend never
 * has to guard against undefined KPIs when a scope resolves to nobody.
 */
function emptyReport(periodMonth: string, start: Date, end: Date) {
  return {
    filters: { periodMonth, start, end, employeeId: null },
    kpis: {
      salesAmount: 0,
      bookedAmount: 0,
      orderCount: 0,
      visitsCompleted: 0,
      visitsAssigned: 0,
      visitsSkipped: 0,
      overstayCount: 0,
      newClients: 0,
      daysPresent: 0,
      hoursWorked: 0,
      returnCount: 0,
      returnAmount: 0,
      damageCount: 0,
      tasksAssigned: 0,
      tasksCompleted: 0,
      invoicedTotal: 0,
      collectedTotal: 0,
      outstandingTotal: 0,
      discountTotal: 0,
      flagsOpen: 0,
      targetSalesAmount: 0,
      targetOrderCount: 0,
      targetVisitCount: 0,
      headcount: 0,
      ridersWithTarget: 0,
      ridersAchieved: 0,
      ridersBehind: 0,
      ridersBelowVisitThreshold: 0,
      visitCompletionRate: 0,
      visitThresholdPercent: VISIT_COMPLETION_THRESHOLD_PERCENT,
      taskCompletionRate: 0,
      collectionRatePercent: 0,
      returnRatePercent: 0,
      avgOrderValue: 0,
      strikeRatePercent: 0,
      salesAchievementPercent: null,
      monthElapsedPercent: 0,
    },
    rows: [] as PerformanceRow[],
  };
}

/**
 * Month-by-month trend for one employee (or the caller's whole scope), for charts.
 * `months` counts back from and includes the current month.
 */
export async function getTrend(
  filters: { employeeId?: string; months?: number },
  viewerId: string,
  viewerRole: string,
) {
  const monthCount = Math.min(Math.max(filters.months ?? 6, 1), 24);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthCount - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const scopeIds = await resolveScope(viewerId, viewerRole);

  const employeeQuery: Record<string, unknown> = {
    isTrashed: { $ne: true },
    role: { $in: FIELD_STAFF_ROLES },
  };
  if (scopeIds) employeeQuery._id = { $in: scopeIds };
  if (filters.employeeId) {
    const requested = new Types.ObjectId(filters.employeeId);
    if (scopeIds && !scopeIds.some((id) => id.equals(requested))) {
      return { months: [], sales: [], orders: [], visits: [], targets: [] };
    }
    employeeQuery._id = requested;
  }

  const employees = await UserModel.find(employeeQuery).select('_id').lean().exec();
  const employeeIds = employees.map((e) => e._id as Types.ObjectId);
  if (employeeIds.length === 0) {
    return { months: [], sales: [], orders: [], visits: [], targets: [] };
  }

  const period = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };

  const [salesTrend, visitTrend, targetRows] = await Promise.all([
    OrderModel.aggregate([
      {
        $match: {
          createdBy: { $in: employeeIds },
          isTrashed: { $ne: true },
          status: { $in: DELIVERED_STATUSES },
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: period,
          salesAmount: { $sum: { $ifNull: ['$grandTotal', 0] } },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // Same effectiveDate bucketing as getPerformance, so the trend reconciles with the
    // monthly report instead of disagreeing at month boundaries.
    VisitModel.aggregate([
      {
        $match: {
          employeeId: { $in: employeeIds },
          isTrashed: { $ne: true },
          status: 'completed',
        },
      },
      { $addFields: { effectiveDate: { $ifNull: ['$visitDate', '$createdAt'] } } },
      { $match: { effectiveDate: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$effectiveDate' } },
          visitsCompleted: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    TargetModel.aggregate([
      { $match: { employeeId: { $in: employeeIds } } },
      { $group: { _id: '$periodMonth', targetSalesAmount: { $sum: { $ifNull: ['$salesAmount', 0] } } } },
    ]),
  ]);

  // Emit a dense series so chart labels line up even for months with no activity.
  const months: string[] = [];
  const cursor = new Date(start);
  for (let i = 0; i < monthCount; i += 1) {
    months.push(toPeriodMonth(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const salesMap = new Map(salesTrend.map((r) => [r._id as string, r]));
  const visitMap = new Map(visitTrend.map((r) => [r._id as string, r]));
  const targetMap = new Map(targetRows.map((r) => [r._id as string, r]));

  return {
    months,
    sales: months.map((m) => salesMap.get(m)?.salesAmount ?? 0),
    orders: months.map((m) => salesMap.get(m)?.orderCount ?? 0),
    visits: months.map((m) => visitMap.get(m)?.visitsCompleted ?? 0),
    targets: months.map((m) => targetMap.get(m)?.targetSalesAmount ?? 0),
  };
}
