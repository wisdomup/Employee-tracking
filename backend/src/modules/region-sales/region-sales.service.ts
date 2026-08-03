import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { UserModel } from '../../models/user.model';
import { FIELD_STAFF_ROLES } from '../../constants/global';
import { badRequest } from '../../utils/app-error';
import { resolveVisibleEmployeeIds } from '../users/users.service';
import { DELIVERED_STATUSES, BOOKED_STATUSES } from '../analytics/analytics.service';
import {
  REPORT_TIMEZONE,
  UNASSIGNED_REGION,
  UNASSIGNED_REGION_KEY,
  isValidDayKey,
  localDayRangeUtc,
  eachDayKey,
  dayRangeLength,
  normalizeCityKey,
  regionLabel,
  todayDayKey,
} from './region-sales.rules';

/** Longest date range the day-wise report will serve, to bound the response size. */
const MAX_RANGE_DAYS = 366;

export interface RegionRow {
  /** Normalised grouping key ('' for Unassigned) — used in the drill-down URL. */
  regionKey: string;
  /** Display name, original casing, or "Unassigned". */
  region: string;
  deliveredAmount: number;
  bookedAmount: number;
  totalAmount: number;
  orderCount: number;
  salesmenCount: number;
}

export interface SalesmanRow {
  employeeId: string;
  username: string;
  fullName?: string;
  userID?: string;
  role: string;
  deliveredAmount: number;
  bookedAmount: number;
  totalAmount: number;
  orderCount: number;
}

/**
 * Per-order sale contribution, split into delivered vs booked in a single pass.
 *
 * One pipeline rather than two (as the analytics module does) so both columns are
 * guaranteed to come from the identical matched set — a divergent filter between two
 * pipelines would be invisible in the UI.
 */
const SALE_ACCUMULATORS = {
  deliveredAmount: {
    $sum: {
      $cond: [{ $in: ['$status', DELIVERED_STATUSES] }, { $ifNull: ['$grandTotal', 0] }, 0],
    },
  },
  bookedAmount: {
    $sum: {
      $cond: [{ $in: ['$status', BOOKED_STATUSES] }, { $ifNull: ['$grandTotal', 0] }, 0],
    },
  },
  orderCount: { $sum: 1 },
} as const;

/** Orders that count toward a sale: not trashed, not cancelled, inside the window. */
function saleMatch(start: Date, end: Date, employeeIds: Types.ObjectId[]) {
  return {
    createdBy: { $in: employeeIds },
    isTrashed: { $ne: true },
    // Cancelled is excluded everywhere in the app; everything else is either delivered
    // (realised) or booked (committed), and both are reported.
    status: { $nin: ['cancelled'] },
    createdAt: { $gte: start, $lte: end },
  };
}

/** Validates a `YYYY-MM-DD` input, defaulting to today in the report timezone. */
function requireDay(value: string | undefined, field: string): string {
  if (value == null || value === '') return todayDayKey();
  if (!isValidDayKey(value)) {
    throw badRequest(`${field} must be a valid date in YYYY-MM-DD format`);
  }
  return value;
}

/**
 * The field staff a viewer may see, as concrete ids.
 *
 * `resolveVisibleEmployeeIds` returns `null` for admin (unrestricted); this dashboard
 * always needs an explicit roster (so zero-sale people still appear), so admin is
 * expanded to "every field-staff user".
 */
async function resolveRoster(viewerId: string, viewerRole: string) {
  const visibleIds = await resolveVisibleEmployeeIds(viewerId, viewerRole);

  const query: Record<string, unknown> = {
    isTrashed: { $ne: true },
    role: { $in: FIELD_STAFF_ROLES },
  };
  if (visibleIds) query._id = { $in: visibleIds };

  return UserModel.find(query)
    .select('_id username fullName userID role address.city')
    // Explicit sort: without it Mongo's natural order depends on which index the planner
    // picks, which made the region display label non-deterministic (see pickRegionLabel).
    .sort({ username: 1 })
    .lean()
    .exec();
}

/**
 * Chooses which spelling of a city to display when its rows disagree on casing.
 *
 * City is free text, so one region can arrive as "Lahore", "lahore" and "LAHORE". They
 * group into a single row, but the row still needs one label. A mixed-case spelling is
 * preferred over an all-lower or all-upper one, so the region reads as "Lahore" rather
 * than "LAHORE" regardless of which record the database returned first.
 */
function pickRegionLabel(current: string, candidate: string): string {
  if (current === UNASSIGNED_REGION || candidate === UNASSIGNED_REGION) return current;

  const looksProper = (s: string) => s !== s.toLowerCase() && s !== s.toUpperCase();
  if (looksProper(current)) return current;
  if (looksProper(candidate)) return candidate;
  // Neither is mixed case — keep it stable rather than flip-flopping.
  return current <= candidate ? current : candidate;
}

/**
 * Region (city) totals for a single day.
 *
 * Built from the salesman roster rather than from orders, so a region with no sales that
 * day still shows as Rs. 0 instead of silently disappearing from the list.
 */
export async function getRegionTotals(
  date: string | undefined,
  viewerId: string,
  viewerRole: string,
) {
  const day = requireDay(date, 'date');
  const { start, end } = localDayRangeUtc(day);

  const roster = await resolveRoster(viewerId, viewerRole);
  if (roster.length === 0) {
    return { date: day, timezone: REPORT_TIMEZONE, totals: emptyTotals(), regions: [] as RegionRow[] };
  }

  const employeeIds = roster.map((u) => u._id as Types.ObjectId);

  const salesRows = await OrderModel.aggregate<{
    _id: Types.ObjectId;
    deliveredAmount: number;
    bookedAmount: number;
    orderCount: number;
  }>([
    { $match: saleMatch(start, end, employeeIds) },
    { $group: { _id: '$createdBy', ...SALE_ACCUMULATORS } },
  ]);

  const salesByEmployee = new Map(salesRows.map((r) => [String(r._id), r]));

  // Roll the per-employee figures up into their region.
  const byRegion = new Map<string, RegionRow>();
  for (const member of roster) {
    const rawCity = member.address?.city;
    const regionKey = normalizeCityKey(rawCity);

    let row = byRegion.get(regionKey);
    if (!row) {
      row = {
        regionKey,
        region: regionLabel(rawCity),
        deliveredAmount: 0,
        bookedAmount: 0,
        totalAmount: 0,
        orderCount: 0,
        salesmenCount: 0,
      };
      byRegion.set(regionKey, row);
    } else {
      // Same region, possibly spelled differently — settle on the nicest spelling.
      row.region = pickRegionLabel(row.region, regionLabel(rawCity));
    }

    row.salesmenCount += 1;
    const sale = salesByEmployee.get(String(member._id));
    if (sale) {
      row.deliveredAmount += sale.deliveredAmount;
      row.bookedAmount += sale.bookedAmount;
      row.orderCount += sale.orderCount;
    }
  }

  const regions = [...byRegion.values()].map((r) => ({
    ...r,
    totalAmount: round2(r.deliveredAmount + r.bookedAmount),
    deliveredAmount: round2(r.deliveredAmount),
    bookedAmount: round2(r.bookedAmount),
  }));

  // Biggest region first — that is the order an admin reads them out in. Unassigned is
  // pinned last regardless of value; it is a data-quality bucket, not a real region.
  regions.sort((a, b) => {
    if (a.regionKey === UNASSIGNED_REGION_KEY) return 1;
    if (b.regionKey === UNASSIGNED_REGION_KEY) return -1;
    return b.totalAmount - a.totalAmount;
  });

  return {
    date: day,
    timezone: REPORT_TIMEZONE,
    totals: sumTotals(regions),
    regions,
  };
}

/**
 * Every salesman in one region, with their individual sale for the day.
 * Salesmen with no sale that day are included at Rs. 0 — the region list must be the
 * full team, not only those who sold something.
 */
export async function getRegionSalesmen(
  date: string | undefined,
  regionKey: string,
  viewerId: string,
  viewerRole: string,
) {
  const day = requireDay(date, 'date');
  const { start, end } = localDayRangeUtc(day);
  const wantedKey = normalizeCityKey(regionKey);

  const roster = (await resolveRoster(viewerId, viewerRole)).filter(
    (u) => normalizeCityKey(u.address?.city) === wantedKey,
  );

  if (roster.length === 0) {
    return {
      date: day,
      timezone: REPORT_TIMEZONE,
      regionKey: wantedKey,
      region: wantedKey === UNASSIGNED_REGION_KEY ? UNASSIGNED_REGION : regionKey,
      totals: emptyTotals(),
      salesmen: [] as SalesmanRow[],
    };
  }

  const employeeIds = roster.map((u) => u._id as Types.ObjectId);
  const salesRows = await OrderModel.aggregate<{
    _id: Types.ObjectId;
    deliveredAmount: number;
    bookedAmount: number;
    orderCount: number;
  }>([
    { $match: saleMatch(start, end, employeeIds) },
    { $group: { _id: '$createdBy', ...SALE_ACCUMULATORS } },
  ]);
  const salesByEmployee = new Map(salesRows.map((r) => [String(r._id), r]));

  const salesmen: SalesmanRow[] = roster.map((member) => {
    const sale = salesByEmployee.get(String(member._id));
    const delivered = sale?.deliveredAmount ?? 0;
    const booked = sale?.bookedAmount ?? 0;
    return {
      employeeId: String(member._id),
      username: member.username,
      fullName: member.fullName,
      userID: member.userID,
      role: member.role,
      deliveredAmount: round2(delivered),
      bookedAmount: round2(booked),
      totalAmount: round2(delivered + booked),
      orderCount: sale?.orderCount ?? 0,
    };
  });

  salesmen.sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    date: day,
    timezone: REPORT_TIMEZONE,
    regionKey: wantedKey,
    // Same label rule as the region list, so the two levels agree on the spelling.
    region: roster.reduce(
      (label, member) => pickRegionLabel(label, regionLabel(member.address?.city)),
      regionLabel(roster[0].address?.city),
    ),
    totals: sumTotals(salesmen),
    salesmen,
  };
}

/**
 * One salesman's day-by-day sale over a date range.
 * The series is dense: days with no orders come back as Rs. 0 rather than being absent,
 * so the table and chart have no gaps.
 */
export async function getSalesmanDaily(
  employeeId: string,
  from: string | undefined,
  to: string | undefined,
  viewerId: string,
  viewerRole: string,
) {
  const toDay = requireDay(to, 'to');
  // Default window is the last 7 days ending on `to`, inclusive.
  const fromDay = from
    ? requireDay(from, 'from')
    : shiftDay(toDay, -6);

  if (fromDay > toDay) {
    throw badRequest('"from" date must not be after "to" date');
  }
  const span = dayRangeLength(fromDay, toDay);
  if (span > MAX_RANGE_DAYS) {
    throw badRequest(`Date range is too large — pick ${MAX_RANGE_DAYS} days or fewer`);
  }

  // Scope check: the caller may only look at employees they are allowed to see.
  const visibleIds = await resolveVisibleEmployeeIds(viewerId, viewerRole);
  const requested = new Types.ObjectId(employeeId);
  const outOfScope = visibleIds != null && !visibleIds.some((id) => id.equals(requested));

  const employee = outOfScope
    ? null
    : await UserModel.findOne({ _id: requested, isTrashed: { $ne: true } })
        .select('_id username fullName userID role address.city')
        .lean()
        .exec();

  const days = eachDayKey(fromDay, toDay);

  if (!employee) {
    // Out of scope or missing: an empty report, not an error and not another team's data.
    return {
      from: fromDay,
      to: toDay,
      timezone: REPORT_TIMEZONE,
      employee: null,
      totals: emptyTotals(),
      days: days.map((d) => zeroDay(d)),
    };
  }

  const { start } = localDayRangeUtc(fromDay);
  const { end } = localDayRangeUtc(toDay);

  const rows = await OrderModel.aggregate<{
    _id: string;
    deliveredAmount: number;
    bookedAmount: number;
    orderCount: number;
  }>([
    { $match: saleMatch(start, end, [requested]) },
    {
      $group: {
        // Bucket in the report timezone so the day labels match the picker the admin used.
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: REPORT_TIMEZONE } },
        ...SALE_ACCUMULATORS,
      },
    },
  ]);

  const byDay = new Map(rows.map((r) => [r._id, r]));
  const series = days.map((d) => {
    const hit = byDay.get(d);
    if (!hit) return zeroDay(d);
    return {
      date: d,
      deliveredAmount: round2(hit.deliveredAmount),
      bookedAmount: round2(hit.bookedAmount),
      totalAmount: round2(hit.deliveredAmount + hit.bookedAmount),
      orderCount: hit.orderCount,
    };
  });

  return {
    from: fromDay,
    to: toDay,
    timezone: REPORT_TIMEZONE,
    employee: {
      employeeId: String(employee._id),
      username: employee.username,
      fullName: employee.fullName,
      userID: employee.userID,
      role: employee.role,
      region: regionLabel(employee.address?.city),
      regionKey: normalizeCityKey(employee.address?.city),
    },
    totals: sumTotals(series),
    days: series,
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Money is summed as floats; round once at the edge to avoid 0.1+0.2 artefacts. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function zeroDay(date: string) {
  return { date, deliveredAmount: 0, bookedAmount: 0, totalAmount: 0, orderCount: 0 };
}

function emptyTotals() {
  return { deliveredAmount: 0, bookedAmount: 0, totalAmount: 0, orderCount: 0 };
}

function sumTotals(
  rows: { deliveredAmount: number; bookedAmount: number; orderCount: number }[],
) {
  const acc = rows.reduce(
    (sum, r) => {
      sum.deliveredAmount += r.deliveredAmount;
      sum.bookedAmount += r.bookedAmount;
      sum.orderCount += r.orderCount;
      return sum;
    },
    { deliveredAmount: 0, bookedAmount: 0, orderCount: 0 },
  );
  return {
    deliveredAmount: round2(acc.deliveredAmount),
    bookedAmount: round2(acc.bookedAmount),
    totalAmount: round2(acc.deliveredAmount + acc.bookedAmount),
    orderCount: acc.orderCount,
  };
}

/** Shifts a `YYYY-MM-DD` key by whole days, staying on the calendar (no zone involved). */
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  return cursor.toISOString().slice(0, 10);
}
