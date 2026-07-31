import { Types } from 'mongoose';
import { VisitModel } from '../../models/visit.model';
import { RouteModel } from '../../models/route.model';
import { DealerModel } from '../../models/dealer.model';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import { UserModel } from '../../models/user.model';
import * as routeAssignmentsService from '../route-assignments/route-assignments.service';
import { notFound, badRequest } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
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
    const startOnly = filters.startDate && !filters.endDate;
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      start.setUTCHours(0, 0, 0, 0);
      if (startOnly) start.setUTCDate(start.getUTCDate() - 1);
      q.$gte = start;
    }
    const endDateToUse = filters.endDate ?? (startOnly ? filters.startDate : undefined);
    if (endDateToUse) {
      const end = new Date(endDateToUse);
      end.setUTCHours(23, 59, 59, 999);
      q.$lte = end;
    }
  }

  return VisitModel.find(query)
    .populate('dealerId')
    .populate('employeeId', '-password')
    .populate('routeId')
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
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

  return visit;
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
    .select('_id isActive')
    .lean()
    .exec();

  if (!assignedEmployee || assignedEmployee.isActive !== true) {
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
      status: { $in: ['todo', 'in_progress'] },
      $or: [
        { visitDate: { $lt: startOfDay } },
        { visitDate: null },
        { visitDate: { $exists: false } },
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
  const assignments = await RouteAssignmentModel.find({}).select('routeId employeeId').lean().exec();
  const employeeIdSet = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.employeeId) employeeIdSet.add(String(assignment.employeeId));
  }
  const activeEmployees = await UserModel.find({
    _id: { $in: [...employeeIdSet].map((id) => new Types.ObjectId(id)) },
    isTrashed: { $ne: true },
    isActive: true,
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
      totalMarkedIncomplete: 0,
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
  let totalMarkedIncomplete = 0;
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
): Promise<{ completed: number; assigned: number; stillOpen: number; skipped: number }> {
  const { start, end } = utcDayRange(day);

  const rows = await VisitModel.aggregate<{ _id: string; count: number }>([
    { $match: { employeeId, isTrashed: { $ne: true } } },
    { $addFields: { effectiveDate: { $ifNull: ['$visitDate', '$createdAt'] } } },
    { $match: { effectiveDate: { $gte: start, $lte: end } } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const byStatus = new Map(rows.map((r) => [r._id, r.count]));
  const get = (s: string) => byStatus.get(s) ?? 0;

  const completed = get('completed');
  const skipped = get('skipped');
  const cancelled = get('cancelled');
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return {
    completed,
    skipped,
    assigned: total - cancelled,
    // todo + in_progress + checked_in + incomplete are all still theoretically openable,
    // but `incomplete` is a past-day rollover so it never appears for today.
    stillOpen: total - cancelled - completed - skipped,
  };
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
