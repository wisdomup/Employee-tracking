/**
 * Drill-down behind each KPI tile on the Analytics page. Same contract as the Reports drill-down:
 * the caller names a metric, we return the records the tile summed plus the column metadata to
 * render them, so one generic detail page serves every tile.
 *
 * Two families of metric:
 *   - RECORD metrics resolve to the raw documents (orders, visits, returns, …) for the month.
 *   - EMPLOYEE metrics are per-person rollups; those reuse `getPerformance` rather than
 *     re-deriving them, so a tile and its drill-down can never drift apart.
 *
 * Visibility is whatever `resolvePerformanceScope` allows — a rider hitting this endpoint
 * directly still sees only themselves.
 */
import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { VisitModel } from '../../models/visit.model';
import { DealerModel } from '../../models/dealer.model';
import { AttendanceModel } from '../../models/attendance.model';
import { ReturnModel } from '../../models/return.model';
import { TaskModel } from '../../models/task.model';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import {
  BOOKED_STATUSES,
  DELIVERED_STATUSES,
  PerformanceRow,
  getPerformance,
  resolvePerformanceScope,
} from './analytics.service';

export type PerformanceDetailMetric =
  | 'sales'
  | 'target'
  | 'achievement'
  | 'booked'
  | 'orders'
  | 'visits-completed'
  | 'overstays'
  | 'new-clients'
  | 'visit-completion'
  | 'visits-skipped'
  | 'extra-visits'
  | 'total-visits-done'
  | 'open-flags'
  | 'days-present'
  | 'collected'
  | 'outstanding'
  | 'collection-rate'
  | 'returns'
  | 'avg-order-value'
  | 'strike-rate'
  | 'tasks-done'
  | 'achieved-target'
  | 'behind-pace'
  | 'below-visits';

export const PERFORMANCE_DETAIL_METRICS: PerformanceDetailMetric[] = [
  'sales',
  'target',
  'achievement',
  'booked',
  'orders',
  'visits-completed',
  'overstays',
  'new-clients',
  'visit-completion',
  'visits-skipped',
  'extra-visits',
  'total-visits-done',
  'open-flags',
  'days-present',
  'collected',
  'outstanding',
  'collection-rate',
  'returns',
  'avg-order-value',
  'strike-rate',
  'tasks-done',
  'achieved-target',
  'behind-pace',
  'below-visits',
];

const MAX_ROWS = 5000;

export type DetailColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date';

export interface DetailColumn {
  key: string;
  title: string;
  type?: DetailColumnType;
}

export interface DetailSummaryItem {
  label: string;
  value: number;
  type?: DetailColumnType;
}

export interface PerformanceDetailResult {
  metric: PerformanceDetailMetric;
  title: string;
  description: string;
  filters: { periodMonth: string; employeeId: string | null };
  columns: DetailColumn[];
  summary: DetailSummaryItem[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

const employeeLookup = (localField: string) => [
  { $lookup: { from: 'users', localField, foreignField: '_id', as: 'employee' } },
  { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
];

const employeeNameExpr = {
  $ifNull: ['$employee.fullName', { $ifNull: ['$employee.username', '-'] }],
};

const dealerLookup = [
  { $lookup: { from: 'dealers', localField: 'dealerId', foreignField: '_id', as: 'dealer' } },
  { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
];

const dealerNameExpr = { $ifNull: ['$dealer.shopName', { $ifNull: ['$dealer.name', '-'] }] };

function sum(rows: Record<string, unknown>[], key: string) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

async function run(
  pipeline: Record<string, unknown>[],
  model: { aggregate: (pipeline: any[]) => Promise<any[]> },
) {
  const rows = (await model.aggregate([...pipeline, { $limit: MAX_ROWS + 1 }])) as Record<
    string,
    unknown
  >[];
  const truncated = rows.length > MAX_ROWS;
  return { rows: truncated ? rows.slice(0, MAX_ROWS) : rows, truncated };
}

/** Order-level rows, shared by every order-backed metric. */
function orderPipeline(
  employeeIds: Types.ObjectId[],
  range: { start: Date; end: Date },
  statusMatch: Record<string, unknown>,
  extraStages: Record<string, unknown>[] = [],
) {
  return [
    {
      $match: {
        createdBy: { $in: employeeIds },
        isTrashed: { $ne: true },
        createdAt: { $gte: range.start, $lte: range.end },
        ...statusMatch,
      },
    },
    ...employeeLookup('createdBy'),
    ...dealerLookup,
    {
      $addFields: {
        outstanding: {
          $max: [
            0,
            {
              $subtract: [{ $ifNull: ['$grandTotal', 0] }, { $ifNull: ['$paidAmount', 0] }],
            },
          ],
        },
      },
    },
    ...extraStages,
    {
      $project: {
        _id: 0,
        invoiceNumber: { $ifNull: ['$invoiceNumber', null] },
        date: '$createdAt',
        employeeName: employeeNameExpr,
        dealerName: dealerNameExpr,
        itemCount: { $size: { $ifNull: ['$products', []] } },
        grandTotal: { $round: [{ $ifNull: ['$grandTotal', 0] }, 2] },
        paidAmount: { $round: [{ $ifNull: ['$paidAmount', 0] }, 2] },
        outstanding: { $round: ['$outstanding', 2] },
        paymentType: { $ifNull: ['$paymentType', '-'] },
        status: 1,
      },
    },
    { $sort: { date: -1 } },
  ];
}

const ORDER_COLUMNS: DetailColumn[] = [
  { key: 'invoiceNumber', title: 'Invoice #', type: 'number' },
  { key: 'date', title: 'Date', type: 'date' },
  { key: 'employeeName', title: 'Employee' },
  { key: 'dealerName', title: 'Client' },
  { key: 'itemCount', title: 'Items', type: 'number' },
  { key: 'grandTotal', title: 'Grand Total', type: 'currency' },
  { key: 'paidAmount', title: 'Paid', type: 'currency' },
  { key: 'outstanding', title: 'Outstanding', type: 'currency' },
  { key: 'paymentType', title: 'Payment' },
  { key: 'status', title: 'Status' },
];

/** Visit-level rows. Bucketed on `visitDate` with a `createdAt` fallback, as `getPerformance` does. */
function visitPipeline(
  employeeIds: Types.ObjectId[],
  range: { start: Date; end: Date },
  visitMatch: Record<string, unknown>,
) {
  return [
    { $match: { employeeId: { $in: employeeIds }, isTrashed: { $ne: true } } },
    { $addFields: { effectiveDate: { $ifNull: ['$visitDate', '$createdAt'] } } },
    { $match: { effectiveDate: { $gte: range.start, $lte: range.end }, ...visitMatch } },
    ...employeeLookup('employeeId'),
    ...dealerLookup,
    {
      $project: {
        _id: 0,
        date: '$effectiveDate',
        employeeName: employeeNameExpr,
        dealerName: dealerNameExpr,
        status: 1,
        isSelfInitiated: { $ifNull: ['$isSelfInitiated', false] },
        checkedInAt: 1,
        completedAt: 1,
        durationMinutes: { $ifNull: ['$durationMinutes', null] },
        overstayFlagged: { $ifNull: ['$overstayFlagged', false] },
        skipReason: { $ifNull: ['$skipReason', '-'] },
      },
    },
    { $sort: { date: -1 } },
  ];
}

const VISIT_COLUMNS: DetailColumn[] = [
  { key: 'date', title: 'Date', type: 'date' },
  { key: 'employeeName', title: 'Employee' },
  { key: 'dealerName', title: 'Client' },
  { key: 'status', title: 'Status' },
  { key: 'durationMinutes', title: 'Minutes', type: 'number' },
  { key: 'completedAt', title: 'Completed At', type: 'date' },
];

const EMPLOYEE_COLUMN: DetailColumn = { key: 'employeeName', title: 'Employee' };

/** Per-employee rollups all start from the same `getPerformance` rows. */
function employeeBase(row: PerformanceRow) {
  return {
    employeeName: row.fullName || row.username,
    role: row.role.replace(/_/g, ' '),
    managerName: row.managerName ?? '-',
  };
}

export async function getPerformanceDetail(
  params: { metric: PerformanceDetailMetric; periodMonth?: string; employeeId?: string },
  viewerId: string,
  viewerRole: string,
): Promise<PerformanceDetailResult> {
  const scopeFilters = { periodMonth: params.periodMonth, employeeId: params.employeeId };
  const scope = await resolvePerformanceScope(scopeFilters, viewerId, viewerRole);
  const range = { start: scope.start, end: scope.end };
  const base = {
    metric: params.metric,
    filters: { periodMonth: scope.periodMonth, employeeId: params.employeeId ?? null },
  };

  // Nobody in scope — return the metric's shape with no rows rather than a 403.
  const employeeIds = scope.employeeIds;

  const performanceRows = async (): Promise<PerformanceRow[]> => {
    if (employeeIds.length === 0) return [];
    const report = await getPerformance(scopeFilters, viewerId, viewerRole);
    return report.rows;
  };

  switch (params.metric) {
    case 'sales':
    case 'orders': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            orderPipeline(employeeIds, range, { status: { $in: DELIVERED_STATUSES } }),
            OrderModel,
          )
        : { rows: [], truncated: false };
      const isSales = params.metric === 'sales';
      return {
        ...base,
        truncated,
        title: isSales ? 'Sales (Delivered)' : 'Orders',
        description: 'Every delivered order created in this period, by the employees in view.',
        columns: ORDER_COLUMNS,
        summary: [
          { label: 'Orders', value: rows.length, type: 'number' },
          { label: 'Sales', value: round2(sum(rows, 'grandTotal')), type: 'currency' },
          { label: 'Collected', value: round2(sum(rows, 'paidAmount')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'booked': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            orderPipeline(employeeIds, range, { status: { $in: BOOKED_STATUSES } }),
            OrderModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'Booked (Open Orders)',
        description: 'Orders committed but not yet delivered: pending, approved, packed, dispatched.',
        columns: ORDER_COLUMNS,
        summary: [
          { label: 'Orders', value: rows.length, type: 'number' },
          { label: 'Booked Value', value: round2(sum(rows, 'grandTotal')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'collected': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            orderPipeline(employeeIds, range, { status: { $nin: ['cancelled'] } }),
            OrderModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'Collected',
        description: 'All non-cancelled orders in the period, with what has actually been paid.',
        columns: ORDER_COLUMNS,
        summary: [
          { label: 'Orders', value: rows.length, type: 'number' },
          { label: 'Invoiced', value: round2(sum(rows, 'grandTotal')), type: 'currency' },
          { label: 'Collected', value: round2(sum(rows, 'paidAmount')), type: 'currency' },
          { label: 'Outstanding', value: round2(sum(rows, 'outstanding')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'outstanding': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            orderPipeline(employeeIds, range, { status: { $nin: ['cancelled'] } }, [
              { $match: { outstanding: { $gt: 0 } } },
            ]),
            OrderModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'Outstanding',
        description: 'Orders still carrying an unpaid balance, largest first by date.',
        columns: ORDER_COLUMNS,
        summary: [
          { label: 'Orders', value: rows.length, type: 'number' },
          { label: 'Invoiced', value: round2(sum(rows, 'grandTotal')), type: 'currency' },
          { label: 'Outstanding', value: round2(sum(rows, 'outstanding')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'visits-completed':
    case 'visits-skipped':
    case 'extra-visits':
    case 'total-visits-done':
    case 'overstays': {
      const visitMatch: Record<string, unknown> =
        params.metric === 'visits-completed'
          ? { status: 'completed', isSelfInitiated: { $ne: true } }
          : params.metric === 'visits-skipped'
            ? { status: 'skipped' }
            : params.metric === 'extra-visits'
              ? { status: 'completed', isSelfInitiated: true }
              : params.metric === 'total-visits-done'
                ? { status: 'completed' }
                : { overstayFlagged: true };

      const { rows, truncated } = employeeIds.length
        ? await run(visitPipeline(employeeIds, range, visitMatch), VisitModel)
        : { rows: [], truncated: false };

      const titles: Record<string, { title: string; description: string }> = {
        'visits-completed': {
          title: 'Visits Completed',
          description: 'Route-assigned visits checked out in this period. Self-started extras excluded.',
        },
        'visits-skipped': {
          title: 'Visits Skipped',
          description: 'Assigned visits the rider marked skipped, with the reason given.',
        },
        'extra-visits': {
          title: 'Extra Visits',
          description:
            'Visits riders started themselves, outside the assigned route. Counted as work, not in the completion rate.',
        },
        'total-visits-done': {
          title: 'Total Visits Done',
          description: 'Every completed visit — assigned plus self-started extras.',
        },
        overstays: {
          title: 'Overstays (>30 min)',
          description: 'Visits flagged for exceeding the time-at-store limit.',
        },
      };

      const timed = rows.filter((row) => row.durationMinutes != null);
      return {
        ...base,
        truncated,
        ...titles[params.metric],
        columns:
          params.metric === 'visits-skipped'
            ? [...VISIT_COLUMNS.slice(0, 4), { key: 'skipReason', title: 'Reason' }]
            : VISIT_COLUMNS,
        summary: [
          { label: 'Visits', value: rows.length, type: 'number' },
          {
            label: 'Avg Minutes',
            value: timed.length ? round2(sum(timed, 'durationMinutes') / timed.length) : 0,
            type: 'number',
          },
        ],
        rows,
      };
    }

    case 'new-clients': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            [
              {
                $match: {
                  createdBy: { $in: employeeIds },
                  isTrashed: { $ne: true },
                  createdAt: { $gte: range.start, $lte: range.end },
                },
              },
              ...employeeLookup('createdBy'),
              {
                $project: {
                  _id: 0,
                  date: '$createdAt',
                  employeeName: employeeNameExpr,
                  dealerName: { $ifNull: ['$shopName', '$name'] },
                  ownerName: { $ifNull: ['$name', '-'] },
                  phone: { $ifNull: ['$phone', '-'] },
                  city: { $ifNull: ['$address.city', '-'] },
                  status: { $ifNull: ['$status', '-'] },
                },
              },
              { $sort: { date: -1 } },
            ],
            DealerModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'New Clients',
        description: 'Shops registered in this period, credited to whoever created them.',
        columns: [
          { key: 'date', title: 'Registered', type: 'date' },
          { key: 'dealerName', title: 'Shop' },
          { key: 'ownerName', title: 'Owner' },
          { key: 'phone', title: 'Phone' },
          { key: 'city', title: 'City' },
          { key: 'employeeName', title: 'Registered By' },
          { key: 'status', title: 'Status' },
        ],
        summary: [{ label: 'New Clients', value: rows.length, type: 'number' }],
        rows,
      };
    }

    case 'days-present': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            [
              {
                $match: {
                  employeeId: { $in: employeeIds },
                  isTrashed: { $ne: true },
                  date: { $gte: range.start, $lte: range.end },
                },
              },
              ...employeeLookup('employeeId'),
              {
                $project: {
                  _id: 0,
                  date: 1,
                  employeeName: employeeNameExpr,
                  checkInTime: 1,
                  checkOutTime: { $ifNull: ['$checkOutTime', null] },
                  hoursWorked: {
                    $cond: [
                      { $ifNull: ['$checkOutTime', false] },
                      {
                        $round: [
                          {
                            $divide: [
                              { $subtract: ['$checkOutTime', '$checkInTime'] },
                              3600000,
                            ],
                          },
                          2,
                        ],
                      },
                      0,
                    ],
                  },
                  note: { $ifNull: ['$note', '-'] },
                },
              },
              { $sort: { date: -1 } },
            ],
            AttendanceModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'Days Present',
        description: 'Attendance records for the period. Hours count closed shifts only.',
        columns: [
          { key: 'date', title: 'Date', type: 'date' },
          { key: 'employeeName', title: 'Employee' },
          { key: 'checkInTime', title: 'Check In', type: 'date' },
          { key: 'checkOutTime', title: 'Check Out', type: 'date' },
          { key: 'hoursWorked', title: 'Hours', type: 'number' },
          { key: 'note', title: 'Note' },
        ],
        summary: [
          { label: 'Days Present', value: rows.length, type: 'number' },
          { label: 'Hours Worked', value: round2(sum(rows, 'hoursWorked')), type: 'number' },
        ],
        rows,
      };
    }

    case 'returns': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            [
              {
                $match: {
                  createdBy: { $in: employeeIds },
                  isTrashed: { $ne: true },
                  createdAt: { $gte: range.start, $lte: range.end },
                },
              },
              ...employeeLookup('createdBy'),
              ...dealerLookup,
              {
                $project: {
                  _id: 0,
                  date: '$createdAt',
                  employeeName: employeeNameExpr,
                  dealerName: dealerNameExpr,
                  returnType: 1,
                  itemCount: { $size: { $ifNull: ['$products', []] } },
                  totalQty: { $sum: { $ifNull: ['$products.quantity', []] } },
                  amount: { $round: [{ $ifNull: ['$amount', 0] }, 2] },
                  status: 1,
                  returnReason: { $ifNull: ['$returnReason', '-'] },
                },
              },
              { $sort: { date: -1 } },
            ],
            ReturnModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'Returns',
        description: 'Returns and damages raised by these employees in the period.',
        columns: [
          { key: 'date', title: 'Date', type: 'date' },
          { key: 'employeeName', title: 'Employee' },
          { key: 'dealerName', title: 'Client' },
          { key: 'returnType', title: 'Type' },
          { key: 'itemCount', title: 'Items', type: 'number' },
          { key: 'totalQty', title: 'Qty', type: 'number' },
          { key: 'amount', title: 'Amount', type: 'currency' },
          { key: 'status', title: 'Status' },
          { key: 'returnReason', title: 'Reason' },
        ],
        summary: [
          { label: 'Returns', value: rows.length, type: 'number' },
          {
            label: 'Damages',
            value: rows.filter((row) => row.returnType === 'damage').length,
            type: 'number',
          },
          { label: 'Amount', value: round2(sum(rows, 'amount')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'tasks-done': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            [
              {
                $match: {
                  assignedTo: { $in: employeeIds },
                  createdAt: { $gte: range.start, $lte: range.end },
                },
              },
              ...employeeLookup('assignedTo'),
              ...dealerLookup,
              {
                $project: {
                  _id: 0,
                  date: '$createdAt',
                  taskName: 1,
                  employeeName: employeeNameExpr,
                  dealerName: dealerNameExpr,
                  status: 1,
                  startedAt: { $ifNull: ['$startedAt', null] },
                  completedAt: { $ifNull: ['$completedAt', null] },
                },
              },
              { $sort: { date: -1 } },
            ],
            TaskModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'Tasks Done',
        description: 'Tasks assigned to these employees in the period, completed or not.',
        columns: [
          { key: 'date', title: 'Assigned', type: 'date' },
          { key: 'taskName', title: 'Task' },
          { key: 'employeeName', title: 'Employee' },
          { key: 'dealerName', title: 'Client' },
          { key: 'status', title: 'Status' },
          { key: 'completedAt', title: 'Completed At', type: 'date' },
        ],
        summary: [
          { label: 'Assigned', value: rows.length, type: 'number' },
          {
            label: 'Completed',
            value: rows.filter((row) => row.status === 'completed').length,
            type: 'number',
          },
        ],
        rows,
      };
    }

    case 'open-flags': {
      const { rows, truncated } = employeeIds.length
        ? await run(
            [
              {
                $match: {
                  employeeId: { $in: employeeIds },
                  flagDate: { $gte: range.start, $lte: range.end },
                  resolved: false,
                },
              },
              ...employeeLookup('employeeId'),
              {
                $project: {
                  _id: 0,
                  date: '$flagDate',
                  employeeName: employeeNameExpr,
                  type: 1,
                  message: 1,
                  value: { $ifNull: ['$value', null] },
                  threshold: { $ifNull: ['$threshold', null] },
                },
              },
              { $sort: { date: -1 } },
            ],
            PerformanceFlagModel,
          )
        : { rows: [], truncated: false };
      return {
        ...base,
        truncated,
        title: 'Open Flags',
        description: 'Unresolved performance flags raised in this period.',
        columns: [
          { key: 'date', title: 'Flagged', type: 'date' },
          { key: 'employeeName', title: 'Employee' },
          { key: 'type', title: 'Type' },
          { key: 'message', title: 'Message' },
          { key: 'value', title: 'Value', type: 'number' },
          { key: 'threshold', title: 'Threshold', type: 'number' },
        ],
        summary: [{ label: 'Open Flags', value: rows.length, type: 'number' }],
        rows,
      };
    }

    case 'target': {
      const perf = await performanceRows();
      const rows = perf.map((row) => ({
        ...employeeBase(row),
        targetSalesAmount: row.targetSalesAmount ?? 0,
        targetOrderCount: row.targetOrderCount ?? 0,
        targetVisitCount: row.targetVisitCount ?? 0,
        salesAmount: row.salesAmount,
        salesRemaining: row.salesRemaining ?? 0,
      }));
      return {
        ...base,
        truncated: false,
        title: 'Target',
        description: 'Monthly targets set per employee, and what is left to hit them.',
        columns: [
          EMPLOYEE_COLUMN,
          { key: 'role', title: 'Role' },
          { key: 'targetSalesAmount', title: 'Sales Target', type: 'currency' },
          { key: 'targetOrderCount', title: 'Order Target', type: 'number' },
          { key: 'targetVisitCount', title: 'Visit Target', type: 'number' },
          { key: 'salesAmount', title: 'Sales So Far', type: 'currency' },
          { key: 'salesRemaining', title: 'Remaining', type: 'currency' },
        ],
        summary: [
          { label: 'Employees', value: rows.length, type: 'number' },
          {
            label: 'Total Target',
            value: round2(sum(rows, 'targetSalesAmount')),
            type: 'currency',
          },
          { label: 'Remaining', value: round2(sum(rows, 'salesRemaining')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'achievement':
    case 'achieved-target':
    case 'behind-pace': {
      const perf = await performanceRows();
      const filtered =
        params.metric === 'achieved-target'
          ? perf.filter((row) => (row.salesAchievementPercent ?? 0) >= 100)
          : params.metric === 'behind-pace'
            ? perf.filter((row) => row.status === 'behind')
            : perf;
      const rows = filtered.map((row) => ({
        ...employeeBase(row),
        salesAmount: row.salesAmount,
        targetSalesAmount: row.targetSalesAmount ?? 0,
        salesAchievementPercent: row.salesAchievementPercent ?? 0,
        salesRemaining: row.salesRemaining ?? 0,
        orderCount: row.orderCount,
        status: row.status,
      }));
      const titles: Record<string, { title: string; description: string }> = {
        achievement: {
          title: 'Achievement',
          description: 'Sales against target per employee for the period.',
        },
        'achieved-target': {
          title: 'Achieved Target',
          description: 'Employees already at or past 100% of their sales target.',
        },
        'behind-pace': {
          title: 'Behind Pace',
          description:
            'Employees whose sales are behind where the elapsed month says they should be.',
        },
      };
      return {
        ...base,
        truncated: false,
        ...titles[params.metric],
        columns: [
          EMPLOYEE_COLUMN,
          { key: 'role', title: 'Role' },
          { key: 'salesAmount', title: 'Sales', type: 'currency' },
          { key: 'targetSalesAmount', title: 'Target', type: 'currency' },
          { key: 'salesAchievementPercent', title: 'Achievement', type: 'percent' },
          { key: 'salesRemaining', title: 'Remaining', type: 'currency' },
          { key: 'orderCount', title: 'Orders', type: 'number' },
          { key: 'status', title: 'Status' },
        ],
        summary: [
          { label: 'Employees', value: rows.length, type: 'number' },
          { label: 'Sales', value: round2(sum(rows, 'salesAmount')), type: 'currency' },
          { label: 'Target', value: round2(sum(rows, 'targetSalesAmount')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'visit-completion':
    case 'below-visits': {
      const perf = await performanceRows();
      const filtered =
        params.metric === 'below-visits' ? perf.filter((row) => row.belowVisitThreshold) : perf;
      const rows = filtered.map((row) => ({
        ...employeeBase(row),
        visitsAssigned: row.visitsAssigned,
        visitsCompleted: row.visitsCompleted,
        visitsSkipped: row.visitsSkipped,
        extraVisitsCompleted: row.extraVisitsCompleted,
        visitCompletionRate: row.visitCompletionRate,
        avgVisitMinutes: row.avgVisitMinutes ?? 0,
        overstayCount: row.overstayCount,
      }));
      return {
        ...base,
        truncated: false,
        title: params.metric === 'below-visits' ? 'Below Visit Threshold' : 'Visit Completion',
        description:
          params.metric === 'below-visits'
            ? 'Employees under the visit-adherence pass mark for the period.'
            : 'Assigned-visit adherence per employee. Extras are shown but excluded from the rate.',
        columns: [
          EMPLOYEE_COLUMN,
          { key: 'role', title: 'Role' },
          { key: 'visitsAssigned', title: 'Assigned', type: 'number' },
          { key: 'visitsCompleted', title: 'Completed', type: 'number' },
          { key: 'visitsSkipped', title: 'Skipped', type: 'number' },
          { key: 'extraVisitsCompleted', title: 'Extra', type: 'number' },
          { key: 'visitCompletionRate', title: 'Completion', type: 'percent' },
          { key: 'avgVisitMinutes', title: 'Avg Minutes', type: 'number' },
          { key: 'overstayCount', title: 'Overstays', type: 'number' },
        ],
        summary: [
          { label: 'Employees', value: rows.length, type: 'number' },
          { label: 'Assigned', value: sum(rows, 'visitsAssigned'), type: 'number' },
          { label: 'Completed', value: sum(rows, 'visitsCompleted'), type: 'number' },
        ],
        rows,
      };
    }

    case 'collection-rate': {
      const perf = await performanceRows();
      const rows = perf.map((row) => ({
        ...employeeBase(row),
        invoicedTotal: row.invoicedTotal,
        collectedTotal: row.collectedTotal,
        outstandingTotal: row.outstandingTotal,
        collectionRatePercent: row.collectionRatePercent,
        creditOrders: row.creditOrders,
        discountTotal: row.discountTotal,
      }));
      return {
        ...base,
        truncated: false,
        title: 'Collection Rate',
        description: 'Invoiced against collected per employee, with the credit-order count.',
        columns: [
          EMPLOYEE_COLUMN,
          { key: 'role', title: 'Role' },
          { key: 'invoicedTotal', title: 'Invoiced', type: 'currency' },
          { key: 'collectedTotal', title: 'Collected', type: 'currency' },
          { key: 'outstandingTotal', title: 'Outstanding', type: 'currency' },
          { key: 'collectionRatePercent', title: 'Collection Rate', type: 'percent' },
          { key: 'creditOrders', title: 'Credit Orders', type: 'number' },
          { key: 'discountTotal', title: 'Discount', type: 'currency' },
        ],
        summary: [
          { label: 'Invoiced', value: round2(sum(rows, 'invoicedTotal')), type: 'currency' },
          { label: 'Collected', value: round2(sum(rows, 'collectedTotal')), type: 'currency' },
          { label: 'Outstanding', value: round2(sum(rows, 'outstandingTotal')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'avg-order-value':
    case 'strike-rate': {
      const perf = await performanceRows();
      const rows = perf.map((row) => ({
        ...employeeBase(row),
        salesAmount: row.salesAmount,
        orderCount: row.orderCount,
        avgOrderValue: row.avgOrderValue,
        visitsCompleted: row.visitsCompleted,
        strikeRatePercent: row.strikeRatePercent,
        shopsOrderedFrom: row.shopsOrderedFrom,
      }));
      const isAov = params.metric === 'avg-order-value';
      return {
        ...base,
        truncated: false,
        title: isAov ? 'Avg Order Value' : 'Strike Rate',
        description: isAov
          ? 'Delivered sales divided by delivered orders, per employee.'
          : 'Share of completed visits that produced an order, per employee.',
        columns: [
          EMPLOYEE_COLUMN,
          { key: 'role', title: 'Role' },
          { key: 'salesAmount', title: 'Sales', type: 'currency' },
          { key: 'orderCount', title: 'Orders', type: 'number' },
          { key: 'avgOrderValue', title: 'Avg Order Value', type: 'currency' },
          { key: 'visitsCompleted', title: 'Visits', type: 'number' },
          { key: 'strikeRatePercent', title: 'Strike Rate', type: 'percent' },
          { key: 'shopsOrderedFrom', title: 'Shops Ordered', type: 'number' },
        ],
        summary: [
          { label: 'Employees', value: rows.length, type: 'number' },
          { label: 'Orders', value: sum(rows, 'orderCount'), type: 'number' },
          { label: 'Sales', value: round2(sum(rows, 'salesAmount')), type: 'currency' },
        ],
        rows,
      };
    }

    default: {
      const unknown: never = params.metric;
      throw new Error(`Unknown performance metric: ${unknown}`);
    }
  }
}
