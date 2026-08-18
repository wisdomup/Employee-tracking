import { Types } from 'mongoose';
import { VisitModel } from '../../models/visit.model';
import { RouteModel } from '../../models/route.model';
import { DealerModel } from '../../models/dealer.model';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import { UserModel } from '../../models/user.model';
import * as routeAssignmentsService from '../route-assignments/route-assignments.service';
import * as dealersService from '../dealers/dealers.service';
import { resolveCityScope } from '../users/users.service';
// The business-timezone day key, shared with the region-sales dashboard so "which day did
// this happen on" has one answer across the app.
import { localDayKey } from '../region-sales/region-sales.rules';
import { notFound, badRequest, forbidden } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import { OrderModel } from '../../models/order.model';
import { enforceFirstCheckInDeadline } from '../account-freeze/account-freeze.service';
import {
  CHECK_IN_RADIUS_METRES,
  VISIT_DURATION_LIMIT_MINUTES,
  VISIT_COMPLETION_THRESHOLD_PERCENT,
  evaluateCheckInProximity,
  evaluateVisitDuration,
  checkInGuard,
  completeGuard,
  skipGuard,
  completionRate,
  isBelowCompletionThreshold,
  projectRateAfterSkip,
  type VisitStatus,
} from './visits.rules';

export async function createVisit(
  data: {
    dealerId: string;
    employeeId: string;
    routeId?: string;
    visitDate?: Date;
    status?: string;
  },
  userId?: string,
) {
  const { dealerId, employeeId, routeId, ...rest } = data;

  const visit = await VisitModel.create({
    ...rest,
    dealerId: new Types.ObjectId(dealerId),
    employeeId: new Types.ObjectId(employeeId),
    ...(routeId && { routeId: new Types.ObjectId(routeId) }),
    ...(userId && { createdBy: new Types.ObjectId(userId) }),
  });

  logActivityAsync({
    employeeId: userId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'created',
    meta: { status: visit.status, dealerId, employeeId, routeId },
  });

  return visit;
}

export async function bulkCreateVisits(
  data: { employeeId: string; visitDate: Date; dealerIds: string[]; routeId?: string },
  userId?: string,
) {
  const visits = [];
  for (const dealerId of data.dealerIds) {
    visits.push(
      await createVisit(
        {
          dealerId,
          employeeId: data.employeeId,
          routeId: data.routeId,
          visitDate: data.visitDate,
          status: 'todo',
        },
        userId,
      ),
    );
  }
  return visits;
}

/**
 * Orders punched during a visit, keyed by visit id.
 *
 * One batched query for a whole page of visits rather than a lookup per row — the visit
 * list is the hottest read in the module and a per-row query would make it N+1.
 *
 * Cancelled orders are excluded from the money but still counted, so a visit whose only
 * order was called off reports `Rs. 0` with a count rather than silently reading as
 * "No Order" — the rider did take an order, and the report should not hide that.
 */
async function findOrderSummariesByVisit(
  visitIds: Types.ObjectId[],
): Promise<Map<string, VisitOrderSummary>> {
  const summaries = new Map<string, VisitOrderSummary>();
  if (visitIds.length === 0) return summaries;

  const rows = await OrderModel.aggregate<{
    _id: Types.ObjectId;
    orderCount: number;
    totalAmount: number;
    cancelledCount: number;
    orderIds: Types.ObjectId[];
    invoiceNumbers: (number | null)[];
  }>([
    { $match: { visitId: { $in: visitIds }, isTrashed: { $ne: true } } },
    {
      $group: {
        _id: '$visitId',
        orderCount: { $sum: 1 },
        totalAmount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'cancelled'] }, 0, { $ifNull: ['$grandTotal', 0] }],
          },
        },
        cancelledCount: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
        },
        orderIds: { $push: '$_id' },
        invoiceNumbers: { $push: '$invoiceNumber' },
      },
    },
  ]);

  for (const row of rows) {
    summaries.set(String(row._id), {
      orderCount: row.orderCount,
      totalAmount: Math.round(row.totalAmount * 100) / 100,
      cancelledCount: row.cancelledCount,
      orderIds: row.orderIds.map(String),
      invoiceNumbers: row.invoiceNumbers.filter((n): n is number => n != null),
    });
  }

  return summaries;
}

/** What the visit report shows in its Order column. */
export interface VisitOrderSummary {
  orderCount: number;
  /** Sum of `grandTotal`, excluding cancelled orders. */
  totalAmount: number;
  cancelledCount: number;
  orderIds: string[];
  invoiceNumbers: number[];
}

/**
 * Attaches `orderSummary` to each visit for the report.
 *
 * Visits with no order are left WITHOUT the field rather than given a zeroed one — the UI
 * distinguishes "no order taken" (renders "No Order") from "order worth Rs. 0", and a
 * zero-filled default would erase that difference.
 */
async function withOrderSummaries<T extends { _id: Types.ObjectId; toObject: () => Record<string, unknown> }>(
  visits: T[],
): Promise<Record<string, unknown>[]> {
  const summaries = await findOrderSummariesByVisit(visits.map((v) => v._id));
  return visits.map((visit) => {
    const plain = visit.toObject();
    const summary = summaries.get(String(visit._id));
    if (summary) plain.orderSummary = summary;
    return plain;
  });
}

export async function findAll(filters?: {
  dealerId?: string;
  employeeId?: string;
  routeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  overstayFlagged?: boolean;
  /**
   * Employee ids the caller is allowed to see, or `null` for unrestricted (admin).
   * Intersected with `employeeId` so a narrower explicit filter still applies but can
   * never widen the caller's visibility.
   */
  visibleEmployeeIds?: Types.ObjectId[] | null;
}) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.dealerId) query.dealerId = new Types.ObjectId(filters.dealerId);

  const allowed = filters?.visibleEmployeeIds;
  if (filters?.employeeId) {
    const requested = new Types.ObjectId(filters.employeeId);
    // Asking for someone outside your scope returns nothing rather than leaking.
    if (allowed && !allowed.some((id) => id.equals(requested))) return [];
    query.employeeId = requested;
  } else if (allowed) {
    query.employeeId = { $in: allowed };
  }
  if (filters?.routeId) query.routeId = new Types.ObjectId(filters.routeId);
  if (filters?.status) query.status = filters.status;
  if (filters?.overstayFlagged) query.overstayFlagged = true;

  if (filters?.startDate || filters?.endDate) {
    query.visitDate = {} as Record<string, Date>;
    const q = query.visitDate as Record<string, Date>;
    // Each bound means exactly what it says. This previously widened a start-only filter
    // back by one day, so asking for a single date returned the day before as well —
    // which is what made yesterday's visits look like they had carried over.
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      start.setUTCHours(0, 0, 0, 0);
      q.$gte = start;
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setUTCHours(23, 59, 59, 999);
      q.$lte = end;
    }
  }

  const visits = await VisitModel.find(query)
    .populate('dealerId')
    .populate('employeeId', '-password')
    .populate('routeId')
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .exec();

  return withOrderSummaries(visits);
}

export async function findById(id: string, visibleEmployeeIds?: Types.ObjectId[] | null) {
  const query: Record<string, unknown> = { _id: id, isTrashed: { $ne: true } };
  // `null` = unrestricted (admin). Otherwise the visit must belong to someone the
  // caller may see, so a rider cannot read a colleague's visit by guessing its id.
  if (visibleEmployeeIds) query.employeeId = { $in: visibleEmployeeIds };

  const visit = await VisitModel.findOne(query)
    .populate('dealerId')
    .populate('employeeId', '-password')
    .populate('routeId')
    .populate('createdBy', '-password')
    .exec();

  if (!visit) {
    throw notFound('Visit not found');
  }

  const [withSummary] = await withOrderSummaries([visit]);
  return withSummary;
}

export async function updateVisit(id: string, data: Record<string, unknown>, actorId?: string) {
  const visit = await VisitModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!visit) {
    throw notFound('Visit not found');
  }

  const previousStatus = visit.status;
  const nextStatus = typeof data.status === 'string' ? data.status : undefined;
  if (data.dealerId) data.dealerId = new Types.ObjectId(data.dealerId as string);
  if (data.employeeId) data.employeeId = new Types.ObjectId(data.employeeId as string);
  if (data.routeId) data.routeId = new Types.ObjectId(data.routeId as string);

  Object.assign(visit, data);
  await visit.save();

  const statusChanged = nextStatus !== undefined && previousStatus !== nextStatus;
  logActivityAsync({
    employeeId: actorId,
    module: 'visit',
    entityId: String(visit._id),
    action: statusChanged ? 'status_changed' : 'updated',
    changes: statusChanged ? { status: { from: previousStatus, to: nextStatus } } : undefined,
    meta: { status: visit.status },
  });

  return visit;
}

export async function deleteVisit(id: string, actorId?: string) {
  const visit = await VisitModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!visit) {
    throw notFound('Visit not found');
  }

  visit.isTrashed = true;
  visit.trashedAt = new Date();
  visit.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await visit.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { status: visit.status },
  });

  return { message: 'Visit moved to trash successfully' };
}

/** Open statuses — a visit in any of these was neither finished nor deliberately closed. */
const OPEN_VISIT_STATUSES = ['todo', 'in_progress', 'checked_in'];

/**
 * Closes out every visit left open on a previous day, across the whole system.
 *
 * A visit belongs to the day it was scheduled for and must never appear on a later one.
 * This used to be done per-route inside `createVisitsForRoute`, which left three holes:
 *   - `checked_in` visits were not included, so a rider who checked in but never checked
 *     out kept an open visit forever;
 *   - visits with no `routeId` (admin-created or rider-started walk-ins) were never
 *     matched at all;
 *   - routes skipped by the cron (inactive employee, no dealers, trashed route) never
 *     had their stale visits closed.
 *
 * Running it globally and route-agnostically fixes all three. Visits keep their original
 * `visitDate`, so history stays accurate — they simply stop counting as open work.
 */
export async function rolloverStaleVisits(
  now: Date = new Date(),
): Promise<{ markedIncomplete: number }> {
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  const result = await VisitModel.updateMany(
    {
      isTrashed: { $ne: true },
      status: { $in: OPEN_VISIT_STATUSES },
      $or: [
        { visitDate: { $lt: startOfToday } },
        // Fall back to createdAt when a visit has no scheduled date, so a brand-new
        // dateless visit created today is never swept away by mistake.
        { visitDate: null, createdAt: { $lt: startOfToday } },
        { visitDate: { $exists: false }, createdAt: { $lt: startOfToday } },
      ],
    },
    { $set: { status: 'incomplete' } },
  ).exec();

  const markedIncomplete = result.modifiedCount ?? 0;
  if (markedIncomplete > 0) {
    logActivityAsync({
      module: 'visit',
      entityId: 'system',
      action: 'updated',
      meta: { markedIncomplete, source: 'visit_rollover_global', toStatus: 'incomplete' },
    });
  }
  return { markedIncomplete };
}

export async function createVisitsForRoute(
  routeId: string,
  userId?: string,
): Promise<{ created: number; skipped: number; markedIncomplete: number }> {
  const route = await RouteModel.findOne({ _id: routeId, isTrashed: { $ne: true } });
  if (!route) {
    throw notFound('Route not found');
  }

  const assignment = await routeAssignmentsService.findByRoute(routeId);
  if (!assignment || !assignment.employeeId) {
    throw badRequest('Route is not assigned to any employee');
  }

  const employeeIdRaw = assignment.employeeId;
  const employeeObjectId =
    employeeIdRaw instanceof Types.ObjectId
      ? employeeIdRaw
      : new Types.ObjectId((employeeIdRaw as { _id?: Types.ObjectId })._id?.toString() ?? (employeeIdRaw as unknown as string));

  const assignedEmployee = await UserModel.findOne({
    _id: employeeObjectId,
    isTrashed: { $ne: true },
  })
    .select('_id isActive autoAssignVisits')
    .lean()
    .exec();

  // `autoAssignVisits === false` means an admin turned auto-assignment off for this
  // rider; missing/true keeps the original behaviour.
  if (
    !assignedEmployee ||
    assignedEmployee.isActive !== true ||
    assignedEmployee.autoAssignVisits === false
  ) {
    return { created: 0, skipped: 0, markedIncomplete: 0 };
  }

  const dealers = await DealerModel.find({ route: new Types.ObjectId(routeId), isTrashed: { $ne: true } }).exec();
  if (!dealers.length) {
    throw badRequest('Route has no dealers');
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const routeObjectId = new Types.ObjectId(routeId);

  const rolloverResult = await VisitModel.updateMany(
    {
      routeId: routeObjectId,
      isTrashed: { $ne: true },
      // Includes `checked_in`: a rider who checked in but never checked out has still
      // not completed the visit, and it must not stay open into the following day.
      status: { $in: OPEN_VISIT_STATUSES },
      $or: [
        { visitDate: { $lt: startOfDay } },
        { visitDate: null, createdAt: { $lt: startOfDay } },
        { visitDate: { $exists: false }, createdAt: { $lt: startOfDay } },
      ],
    },
    { $set: { status: 'incomplete' } },
  ).exec();

  const markedIncomplete = rolloverResult.modifiedCount ?? 0;
  if (markedIncomplete > 0) {
    logActivityAsync({
      module: 'visit',
      entityId: routeId,
      action: 'updated',
      meta: {
        routeId,
        markedIncomplete,
        source: 'visit_rollover',
        toStatus: 'incomplete',
      },
    });
  }

  let created = 0;
  let skipped = 0;

  for (const dealer of dealers) {
    const existing = await VisitModel.findOne({
      dealerId: dealer._id,
      employeeId: employeeObjectId,
      routeId: routeObjectId,
      isTrashed: { $ne: true },
      visitDate: { $gte: startOfDay, $lte: endOfDay },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await VisitModel.create({
      dealerId: dealer._id,
      employeeId: employeeObjectId,
      routeId: routeObjectId,
      visitDate: startOfDay,
      status: 'todo',
      ...(userId && { createdBy: new Types.ObjectId(userId) }),
    }).then((visit) => {
      logActivityAsync({
        employeeId: userId,
        module: 'visit',
        entityId: String(visit._id),
        action: 'created',
        meta: {
          status: visit.status,
          dealerId: String(dealer._id),
          employeeId: String(employeeObjectId),
          routeId,
          source: 'create_for_route',
        },
      });
    });
    created += 1;
  }

  return { created, skipped, markedIncomplete };
}

/**
 * Creates today's visits for every route that has an assigned employee and at least one dealer.
 * Skips routes without assignment, without dealers, or that are trashed (no visits created).
 */
export async function createVisitsForAllEligibleRoutes(): Promise<{
  routesProcessed: number;
  routesSkippedNoDealers: number;
  routesSkippedNoActiveRoute: number;
  routesSkippedInactiveEmployee: number;
  totalCreated: number;
  totalSkippedDuplicates: number;
  totalMarkedIncomplete: number;
}> {
  // Runs first and unconditionally: closing out yesterday's open visits must not depend
  // on any route being eligible today, or on the loop below being reached at all.
  const globalRollover = (await rolloverStaleVisits()).markedIncomplete;

  const assignments = await RouteAssignmentModel.find({}).select('routeId employeeId').lean().exec();
  const employeeIdSet = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.employeeId) employeeIdSet.add(String(assignment.employeeId));
  }
  const activeEmployees = await UserModel.find({
    _id: { $in: [...employeeIdSet].map((id) => new Types.ObjectId(id)) },
    isTrashed: { $ne: true },
    isActive: true,
    // Riders with auto-assign switched off are skipped by the cron. `$ne: false` rather
    // than `true` so users predating the field (where it is missing) stay enabled.
    autoAssignVisits: { $ne: false },
  })
    .select('_id')
    .lean()
    .exec();
  const activeEmployeeIdSet = new Set(activeEmployees.map((employee) => String(employee._id)));

  const routeIdSet = new Set<string>();
  let routesSkippedInactiveEmployee = 0;
  for (const a of assignments) {
    if (!a.routeId) continue;
    if (!a.employeeId || !activeEmployeeIdSet.has(String(a.employeeId))) {
      routesSkippedInactiveEmployee += 1;
      continue;
    }
    routeIdSet.add(String(a.routeId));
  }
  if (routeIdSet.size === 0) {
    return {
      routesProcessed: 0,
      routesSkippedNoDealers: 0,
      routesSkippedNoActiveRoute: 0,
      routesSkippedInactiveEmployee,
      totalCreated: 0,
      totalSkippedDuplicates: 0,
      totalMarkedIncomplete: globalRollover,
    };
  }

  const routeObjectIds = [...routeIdSet].map((id) => new Types.ObjectId(id));
  const activeRoutes = await RouteModel.find({
    _id: { $in: routeObjectIds },
    isTrashed: { $ne: true },
  })
    .select('_id')
    .lean()
    .exec();

  const activeRouteIdSet = new Set(activeRoutes.map((r) => String(r._id)));
  const routesSkippedNoActiveRoute = routeIdSet.size - activeRouteIdSet.size;

  const dealerAgg = await DealerModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        route: { $in: activeRoutes.map((r) => r._id) },
        isTrashed: { $ne: true },
      },
    },
    { $group: { _id: '$route', count: { $sum: 1 } } },
  ]);

  const routeIdsWithDealers = new Set(dealerAgg.map((d) => String(d._id)));

  let totalCreated = 0;
  let totalSkippedDuplicates = 0;
  // Already done globally above; the per-route pass below should find nothing left.
  let totalMarkedIncomplete = globalRollover;
  let routesProcessed = 0;
  let routesSkippedNoDealers = 0;

  for (const routeId of activeRouteIdSet) {
    if (!routeIdsWithDealers.has(routeId)) {
      routesSkippedNoDealers += 1;
      continue;
    }
    const { created, skipped, markedIncomplete } = await createVisitsForRoute(routeId);
    routesProcessed += 1;
    totalCreated += created;
    totalSkippedDuplicates += skipped;
    totalMarkedIncomplete += markedIncomplete;
  }

  return {
    routesProcessed,
    routesSkippedNoDealers,
    routesSkippedNoActiveRoute,
    routesSkippedInactiveEmployee,
    totalCreated,
    totalSkippedDuplicates,
    totalMarkedIncomplete,
  };
}

export async function checkInVisit(
  visitId: string,
  data: { latitude: number; longitude: number },
  userId: string,
  userRole?: string,
) {
  const visit = await VisitModel.findById(visitId).populate('dealerId').exec();
  if (!visit || visit.isTrashed) {
    throw notFound('Visit not found');
  }

  const isAdmin = userRole === 'admin';
  if (!isAdmin) {
    const visitEmployeeId =
      visit.employeeId instanceof Types.ObjectId
        ? visit.employeeId.toString()
        : (visit.employeeId as { _id?: Types.ObjectId })?._id?.toString();
    if (visitEmployeeId !== userId) {
      throw badRequest('This visit is not assigned to you');
    }
  }

  const checkInError = checkInGuard(visit.status as VisitStatus);
  if (checkInError) {
    throw badRequest(checkInError);
  }

  // Verify rider is within CHECK_IN_RADIUS_METRES of the store
  const dealer = visit.dealerId as unknown as { latitude?: number; longitude?: number; name?: string };
  if (dealer?.latitude != null && dealer?.longitude != null) {
    const { withinRange, distanceMetres } = evaluateCheckInProximity(
      data.latitude,
      data.longitude,
      dealer.latitude,
      dealer.longitude,
    );
    if (!withinRange) {
      throw badRequest(
        `You must be within ${CHECK_IN_RADIUS_METRES} metres of the store to check in. ` +
          `You are currently ${Math.round(distanceMetres)} metres away.`,
      );
    }
  }

  // The late-start rule. A rider who has not reached ANY shop by the daily deadline is
  // frozen the moment they try to start, and the check-in is refused — so the freeze
  // lands even on days the sweep cron did not run. Riders already out on time, riders
  // with no assigned visits, and non-rider roles all pass straight through.
  // `userRole` is the ACTING user's role, so an admin checking in for someone is never
  // caught by this; the rider's own late arrival still is, on their own next attempt.
  const lateStartReason = await enforceFirstCheckInDeadline({
    employeeId: new Types.ObjectId(userId),
    role: userRole,
    now: new Date(),
    visitId: visit._id,
  });
  if (lateStartReason) {
    throw forbidden(lateStartReason);
  }

  const previousStatus = visit.status;
  visit.status = 'checked_in';
  visit.checkedInAt = new Date();
  visit.checkedInLatitude = data.latitude;
  visit.checkedInLongitude = data.longitude;
  await visit.save();

  logActivityAsync({
    employeeId: userId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'status_changed',
    changes: { status: { from: previousStatus, to: 'checked_in' } },
    meta: { status: 'checked_in', checkedInAt: visit.checkedInAt },
  });

  return visit;
}

export async function completeVisit(
  visitId: string,
  data: {
    latitude: number;
    longitude: number;
    completionImages: { type: 'shop' | 'selfie'; url: string }[];
  },
  userId: string,
  userRole?: string,
) {
  const visit = await VisitModel.findById(visitId).exec();
  if (visit?.isTrashed) {
    throw notFound('Visit not found');
  }

  if (!visit) {
    throw notFound('Visit not found');
  }

  const isAdmin = userRole === 'admin';
  if (!isAdmin) {
    const visitEmployeeId = visit.employeeId instanceof Types.ObjectId
      ? visit.employeeId.toString()
      : (visit.employeeId as { _id?: Types.ObjectId })?._id?.toString();
    if (visitEmployeeId !== userId) {
      throw badRequest('This visit is not assigned to you');
    }
  }

  const completeError = completeGuard(visit.status as VisitStatus, isAdmin);
  if (completeError) {
    throw badRequest(completeError);
  }

  const previousStatus = visit.status;

  if (!data.completionImages || data.completionImages.length < 2) {
    throw badRequest('Both shop image and selfie are required');
  }

  const hasShop = data.completionImages.some((img) => img.type === 'shop');
  const hasSelfie = data.completionImages.some((img) => img.type === 'selfie');
  if (!hasShop || !hasSelfie) {
    throw badRequest('Completion must include both a shop image and a selfie');
  }

  const completedAt = new Date();
  const { durationMinutes, overstay } = evaluateVisitDuration(visit.checkedInAt, completedAt);

  visit.status = 'completed';
  visit.completedAt = completedAt;
  visit.durationMinutes = durationMinutes ?? undefined;
  visit.overstayFlagged = overstay;
  visit.latitude = data.latitude;
  visit.longitude = data.longitude;
  visit.completionImages = data.completionImages;
  await visit.save();

  logActivityAsync({
    employeeId: userId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'status_changed',
    changes: { status: { from: previousStatus, to: 'completed' } },
    meta: { status: visit.status, durationMinutes, overstayFlagged: overstay },
  });

  // Raise a searchable activity entry AND an admin-facing flag record so overstays show
  // up in the same "needs review" feed as low completion rates.
  if (overstay) {
    logActivityAsync({
      employeeId: userId,
      module: 'visit',
      entityId: String(visit._id),
      action: 'flagged',
      meta: {
        reason: 'overstay',
        durationMinutes,
        limitMinutes: VISIT_DURATION_LIMIT_MINUTES,
        checkedInAt: visit.checkedInAt,
        completedAt,
      },
    });

    const { start: flagDate } = utcDayRange(visit.visitDate ?? completedAt);
    await PerformanceFlagModel.findOneAndUpdate(
      { employeeId: visit.employeeId, type: 'overstay', flagDate },
      {
        $set: {
          message: `Spent ${durationMinutes} minutes at a store, over the ${VISIT_DURATION_LIMIT_MINUTES} minute limit.`,
          value: durationMinutes ?? undefined,
          threshold: VISIT_DURATION_LIMIT_MINUTES,
          visitId: visit._id,
          resolved: false,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ).exec();
  }

  return visit;
}

/** UTC midnight..23:59:59.999 for the day a date falls on. */
function utcDayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Counts one rider's visits for a single day.
 *
 * `assigned` excludes cancelled visits (not the rider's failure). `stillOpen` counts
 * visits that could yet be completed — i.e. not completed, skipped or cancelled.
 */
export async function getDayVisitTally(
  employeeId: Types.ObjectId,
  day: Date,
): Promise<{
  completed: number;
  assigned: number;
  stillOpen: number;
  skipped: number;
  /** Completed extras — reported for context, deliberately NOT part of the rate. */
  extrasCompleted: number;
}> {
  const { start, end } = utcDayRange(day);

  const rows = await VisitModel.aggregate<{
    _id: { status: string; self: boolean };
    count: number;
  }>([
    { $match: { employeeId, isTrashed: { $ne: true } } },
    { $addFields: { effectiveDate: { $ifNull: ['$visitDate', '$createdAt'] } } },
    { $match: { effectiveDate: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          status: '$status',
          // Missing means assigned — correct for every visit created before this feature.
          self: { $ifNull: ['$isSelfInitiated', false] },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // The 75% rule measures adherence to the assigned route, so self-started extras are
  // excluded entirely from both sides of the ratio: they cannot pad away a skipped route
  // visit, and abandoning one cannot drag the rider below the threshold.
  const assignedRows = rows.filter((r) => !r._id.self);
  const countOf = (status: string) =>
    assignedRows.find((r) => r._id.status === status)?.count ?? 0;

  const completed = countOf('completed');
  const skipped = countOf('skipped');
  const cancelled = countOf('cancelled');
  const total = assignedRows.reduce((sum, r) => sum + r.count, 0);

  const extrasCompleted = rows
    .filter((r) => r._id.self && r._id.status === 'completed')
    .reduce((sum, r) => sum + r.count, 0);

  return {
    completed,
    skipped,
    extrasCompleted,
    assigned: total - cancelled,
    // todo + in_progress + checked_in + incomplete are all still theoretically openable,
    // but `incomplete` is a past-day rollover so it never appears for today.
    stillOpen: total - cancelled - completed - skipped,
  };
}

/**
 * Starts a visit the rider chose themselves, for any client they are allowed to see.
 *
 * The resulting visit is identical to an assigned one — same check-in geofence, same
 * checkout requirements, same duration/overstay tracking, same post-checkout gallery —
 * it is only marked `isSelfInitiated` so the 75% route-adherence rule can ignore it.
 *
 * Idempotent for the day: if a visit for this rider+client already exists today (whether
 * route-assigned or started earlier), that one is returned instead of a duplicate, so
 * visit counts and the adherence denominator stay honest.
 */
export async function startSelfVisit(
  dealerId: string,
  userId: string,
  userRole: string,
) {
  if (!Types.ObjectId.isValid(dealerId)) {
    throw badRequest('A valid client must be selected');
  }

  const employeeId = new Types.ObjectId(userId);
  const dealerObjectId = new Types.ObjectId(dealerId);

  // Riders are limited to clients in their own city. Going through the dealers service
  // reuses that scoping (and its tests) rather than re-implementing the city match here,
  // so this endpoint cannot become a way around the restriction. It throws notFound for
  // an out-of-city client, which is exactly the behaviour we want.
  const cityScope = await resolveCityScope(userId, userRole);
  const dealer = await dealersService.findById(dealerId, cityScope);

  const now = new Date();
  const { start, end } = utcDayRange(now);

  // Reuse today's visit for this shop rather than stacking duplicates.
  const existing = await VisitModel.findOne({
    employeeId,
    dealerId: dealerObjectId,
    isTrashed: { $ne: true },
    status: { $nin: ['cancelled'] },
    $or: [
      { visitDate: { $gte: start, $lte: end } },
      { visitDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
    ],
  }).exec();

  if (existing) {
    return { visit: existing, created: false };
  }

  // `route` arrives populated from the dealers service, so take its id when present.
  const routeRef = dealer.route as { _id?: Types.ObjectId } | Types.ObjectId | undefined;
  const routeId =
    routeRef && typeof routeRef === 'object' && '_id' in routeRef ? routeRef._id : routeRef;

  const visit = await VisitModel.create({
    dealerId: dealerObjectId,
    employeeId,
    ...(routeId && { routeId }),
    visitDate: now,
    status: 'todo',
    isSelfInitiated: true,
    createdBy: employeeId,
  });

  logActivityAsync({
    employeeId: userId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'created',
    meta: {
      source: 'self_initiated',
      dealerId,
      dealerName: dealer.name,
      status: visit.status,
    },
  });

  return { visit, created: true };
}

/**
 * What skipping this visit would do to the rider's day, without changing anything.
 * Used to warn the rider before they commit.
 */
export async function previewSkipVisit(visitId: string, userId: string, userRole?: string) {
  const visit = await VisitModel.findById(visitId).exec();
  if (!visit || visit.isTrashed) throw notFound('Visit not found');
  assertVisitOwnership(visit, userId, userRole);

  const day = visit.visitDate ?? visit.createdAt;
  const tally = await getDayVisitTally(visit.employeeId as Types.ObjectId, day);
  const currentRate = completionRate(tally);
  const projectedRate = projectRateAfterSkip(tally, tally.stillOpen);

  return {
    threshold: VISIT_COMPLETION_THRESHOLD_PERCENT,
    currentRate,
    projectedRate,
    wouldDropBelowThreshold: isBelowCompletionThreshold(projectedRate),
    assigned: tally.assigned,
    completed: tally.completed,
    skipped: tally.skipped,
    stillOpen: tally.stillOpen,
    blockedReason: skipGuard(visit.status as VisitStatus),
  };
}

/**
 * Skips a visit on the rider's route.
 *
 * Two-step by design: if skipping would leave the day below the completion threshold and
 * the caller has not set `confirm`, nothing is written and the response asks for
 * confirmation. Once confirmed, the skip goes through and — if the day really is below
 * threshold — a PerformanceFlag is raised for the admin.
 */
export async function skipVisit(
  visitId: string,
  data: { reason?: string; confirm?: boolean },
  userId: string,
  userRole?: string,
) {
  const visit = await VisitModel.findById(visitId).populate('routeId').exec();
  if (!visit || visit.isTrashed) throw notFound('Visit not found');
  assertVisitOwnership(visit, userId, userRole);

  const guardError = skipGuard(visit.status as VisitStatus);
  if (guardError) throw badRequest(guardError);

  const employeeId = visit.employeeId as Types.ObjectId;
  const day = visit.visitDate ?? visit.createdAt;
  const before = await getDayVisitTally(employeeId, day);
  const projectedRate = projectRateAfterSkip(before, before.stillOpen);
  const willBreach = isBelowCompletionThreshold(projectedRate);

  // Warn first, act second. Nothing is persisted on this branch.
  if (willBreach && !data.confirm) {
    return {
      skipped: false,
      requiresConfirmation: true,
      threshold: VISIT_COMPLETION_THRESHOLD_PERCENT,
      currentRate: completionRate(before),
      projectedRate,
      message:
        `Skipping this visit leaves you at ${projectedRate}% for today, below the required ` +
        `${VISIT_COMPLETION_THRESHOLD_PERCENT}%. If you continue, your supervisor will be notified.`,
    };
  }

  const previousStatus = visit.status;
  visit.status = 'skipped';
  visit.skippedAt = new Date();
  visit.skipReason = data.reason?.trim() || undefined;
  visit.skippedBy = new Types.ObjectId(userId);
  await visit.save();

  const after = await getDayVisitTally(employeeId, day);
  const rateNow = completionRate(after);
  const bestPossibleRate = projectRateAfterSkip(after, after.stillOpen + 1);
  const belowThreshold = isBelowCompletionThreshold(bestPossibleRate);

  logActivityAsync({
    employeeId: userId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'status_changed',
    changes: { status: { from: previousStatus, to: 'skipped' } },
    meta: { status: 'skipped', reason: visit.skipReason, dayCompletionRate: rateNow },
  });

  let flagged = false;
  if (belowThreshold) {
    await raiseLowCompletionFlag(visit, employeeId, day, bestPossibleRate, after);
    flagged = true;
  }

  return {
    skipped: true,
    requiresConfirmation: false,
    flagged,
    threshold: VISIT_COMPLETION_THRESHOLD_PERCENT,
    currentRate: rateNow,
    projectedRate: bestPossibleRate,
    visit,
  };
}

/**
 * Records (or refreshes) the admin-facing flag for a rider who has dropped below the
 * required completion rate. Upserted per employee/day so repeated skips on the same bad
 * day update one row rather than spamming the admin.
 */
async function raiseLowCompletionFlag(
  visit: IVisitLike,
  employeeId: Types.ObjectId,
  day: Date,
  rate: number,
  tally: { completed: number; assigned: number; skipped: number },
) {
  const { start: flagDate } = utcDayRange(day);
  const routeId =
    visit.routeId && typeof visit.routeId === 'object' && '_id' in visit.routeId
      ? (visit.routeId as { _id: Types.ObjectId })._id
      : (visit.routeId as Types.ObjectId | undefined);

  await PerformanceFlagModel.findOneAndUpdate(
    { employeeId, type: 'low_visit_completion', flagDate },
    {
      $set: {
        // `rate` is the BEST the rider can still finish on, not what they have done so
        // far — say so explicitly, otherwise the numbers look contradictory.
        message:
          `Skipped ${tally.skipped} of ${tally.assigned} assigned visits, so the day can ` +
          `finish at best ${rate}% — below the required ${VISIT_COMPLETION_THRESHOLD_PERCENT}%. ` +
          `${tally.completed} completed so far.`,
        value: rate,
        threshold: VISIT_COMPLETION_THRESHOLD_PERCENT,
        visitId: visit._id,
        ...(routeId && { routeId }),
        meta: {
          completed: tally.completed,
          assigned: tally.assigned,
          skipped: tally.skipped,
        },
        resolved: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();

  logActivityAsync({
    employeeId: String(employeeId),
    module: 'visit',
    entityId: String(visit._id),
    action: 'flagged',
    meta: {
      reason: 'low_visit_completion',
      rate,
      threshold: VISIT_COMPLETION_THRESHOLD_PERCENT,
      completed: tally.completed,
      assigned: tally.assigned,
      skipped: tally.skipped,
    },
  });
}

/** Minimal shape of the fields raiseLowCompletionFlag reads off a visit document. */
interface IVisitLike {
  _id: Types.ObjectId;
  routeId?: unknown;
}

/** Throws unless the caller is an admin or the visit is assigned to them. */
function assertVisitOwnership(
  visit: { employeeId: unknown },
  userId: string,
  userRole?: string,
): void {
  if (userRole === 'admin') return;
  const visitEmployeeId =
    visit.employeeId instanceof Types.ObjectId
      ? visit.employeeId.toString()
      : (visit.employeeId as { _id?: Types.ObjectId })?._id?.toString();
  if (visitEmployeeId !== userId) {
    throw badRequest('This visit is not assigned to you');
  }
}

/**
 * Attaches optional extra shop photos and notes to a completed visit.
 * The visit already links the shop (dealerId) and the rider (employeeId), so these
 * entries are automatically attributed to both when read back as a shop gallery.
 */
export async function updateVisitGallery(
  visitId: string,
  data: { galleryImages?: { url: string; caption?: string }[]; visitNotes?: string },
  userId: string,
  userRole?: string,
) {
  const visit = await VisitModel.findById(visitId).exec();
  if (!visit || visit.isTrashed) {
    throw notFound('Visit not found');
  }

  const isAdmin = userRole === 'admin';
  if (!isAdmin) {
    const visitEmployeeId =
      visit.employeeId instanceof Types.ObjectId
        ? visit.employeeId.toString()
        : (visit.employeeId as { _id?: Types.ObjectId })?._id?.toString();
    if (visitEmployeeId !== userId) {
      throw badRequest('This visit is not assigned to you');
    }
    // Riders may only document a shop once they have actually finished the visit.
    if (visit.status !== 'completed') {
      throw badRequest('You can only add shop photos and notes after checking out');
    }
  }

  if (data.galleryImages !== undefined) visit.galleryImages = data.galleryImages;
  if (data.visitNotes !== undefined) visit.visitNotes = data.visitNotes;
  visit.galleryUpdatedAt = new Date();
  await visit.save();

  logActivityAsync({
    employeeId: userId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'updated',
    meta: {
      source: 'shop_gallery',
      imageCount: visit.galleryImages?.length ?? 0,
      hasNotes: Boolean(visit.visitNotes),
      dealerId: String(visit.dealerId),
    },
  });

  return visit;
}

/**
 * All shop-gallery entries recorded for one dealer, newest first, with the rider
 * who captured them populated so the admin can see who documented what.
 */
export async function findDealerGallery(dealerId: string) {
  return VisitModel.find({
    dealerId: new Types.ObjectId(dealerId),
    isTrashed: { $ne: true },
    $or: [{ 'galleryImages.0': { $exists: true } }, { visitNotes: { $nin: [null, ''] } }],
  })
    .select('dealerId employeeId visitDate completedAt galleryImages visitNotes galleryUpdatedAt')
    .populate('employeeId', '-password')
    .populate('dealerId', 'name shopName')
    .sort({ galleryUpdatedAt: -1 })
    .exec();
}

/**
 * Whole days between two `YYYY-MM-DD` keys. Plain calendar arithmetic — the keys already
 * carry the zone, so no offset is involved here.
 */
function daysBetweenDayKeys(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

/**
 * The last time anybody actually stood in this shop, plus how long ago that was.
 *
 * "Completed" is the only status that means a rider was physically there and checked out;
 * a `todo` visit that was generated and never worked is not a visit to the shopkeeper.
 * `completedAt` is the checkout stamp and is the figure the client profile shows.
 *
 * The gap is counted in **calendar days in the report timezone**, not elapsed hours and not
 * UTC days. Elapsed hours would call a 23:00 checkout "0 days ago" the next morning; UTC days
 * are worse still, because Pakistan is UTC+5 — between midnight and 05:00 PKT the UTC date is
 * still yesterday's, so a visit that really happened yesterday afternoon read as "today".
 * `localDayKey` is the same helper the region-sales dashboard buckets its days with.
 *
 * Returns `null` when the shop has never been visited, so the caller can say "Never visited"
 * rather than render a missing date.
 */
export async function findLastVisitForDealer(dealerId: string) {
  const visit = await VisitModel.findOne({
    dealerId: new Types.ObjectId(dealerId),
    isTrashed: { $ne: true },
    status: 'completed',
    completedAt: { $ne: null },
  })
    .select('dealerId employeeId routeId visitDate completedAt durationMinutes status')
    .populate('employeeId', 'username fullName userID role')
    .populate('routeId', 'name')
    .sort({ completedAt: -1 })
    .lean()
    .exec();

  if (!visit || !visit.completedAt) return null;

  const daysAgo = Math.max(
    0,
    daysBetweenDayKeys(localDayKey(new Date(visit.completedAt)), localDayKey(new Date())),
  );

  return { visit, daysAgo };
}

export async function restoreVisit(id: string, actorId?: string) {
  const visit = await VisitModel.findOne({ _id: id, isTrashed: true });
  if (!visit) throw notFound('Visit not found in trash');
  visit.isTrashed = false;
  visit.trashedAt = undefined;
  visit.trashedBy = undefined;
  await visit.save();
  logActivityAsync({
    employeeId: actorId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { status: visit.status },
  });
  return visit;
}

export async function permanentlyDeleteVisit(id: string, actorId?: string) {
  const visit = await VisitModel.findOne({ _id: id, isTrashed: true });
  if (!visit) throw notFound('Visit not found in trash');
  await VisitModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'visit',
    entityId: String(visit._id),
    action: 'deleted',
    meta: { status: visit.status, permanent: true },
  });
  return { message: 'Visit permanently deleted successfully' };
}
