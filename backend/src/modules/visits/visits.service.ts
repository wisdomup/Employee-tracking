import { Types } from 'mongoose';
import { VisitModel } from '../../models/visit.model';
import { RouteModel } from '../../models/route.model';
import { DealerModel } from '../../models/dealer.model';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import { UserModel } from '../../models/user.model';
import * as routeAssignmentsService from '../route-assignments/route-assignments.service';
import { notFound, badRequest } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

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

export async function findAll(filters?: {
  dealerId?: string;
  employeeId?: string;
  routeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.dealerId) query.dealerId = new Types.ObjectId(filters.dealerId);
  if (filters?.employeeId) query.employeeId = new Types.ObjectId(filters.employeeId);
  if (filters?.routeId) query.routeId = new Types.ObjectId(filters.routeId);
  if (filters?.status) query.status = filters.status;

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

export async function findById(id: string) {
  const visit = await VisitModel.findOne({ _id: id, isTrashed: { $ne: true } })
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

  if (visit.status === 'completed') {
    throw badRequest('Visit is already completed');
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

  visit.status = 'completed';
  visit.completedAt = new Date();
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
    meta: { status: visit.status },
  });

  return visit;
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
