import { Types } from 'mongoose';
import { DealerModel } from '../../models/dealer.model';
import { RouteModel } from '../../models/route.model';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import { notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

export async function createRoute(
  data: { name: string; startingPoint: string; endingPoint: string },
  userId?: string,
) {
  const route = await RouteModel.create({
    ...data,
    ...(userId && { createdBy: new Types.ObjectId(userId) }),
  });
  logActivityAsync({
    employeeId: userId,
    module: 'route',
    entityId: String(route._id),
    action: 'created',
    meta: { name: route.name },
  });
  return route;
}

export async function findAll(search?: string) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { startingPoint: { $regex: search, $options: 'i' } },
      { endingPoint: { $regex: search, $options: 'i' } },
    ];
  }

  const routes = await RouteModel.find(query)
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  if (routes.length === 0) return routes;

  const routeIds = routes.map((r) => r._id);
  const assignments = await RouteAssignmentModel.find({
    routeId: { $in: routeIds },
  })
    .populate('employeeId', '-password')
    .lean()
    .exec();

  const assignedByRouteId = new Map<string, { username?: string; userID?: string }>();
  for (const a of assignments) {
    const routeId = a.routeId != null ? String(a.routeId) : '';
    const emp = a.employeeId as { username?: string; userID?: string } | null;
    if (routeId && emp) {
      assignedByRouteId.set(routeId, {
        username: emp.username,
        userID: emp.userID,
      });
    }
  }

  return routes.map((r) => {
    const routeId = r._id != null ? String(r._id) : '';
    const assignedEmployee = routeId ? (assignedByRouteId.get(routeId) ?? null) : null;
    return { ...r, assignedEmployee };
  });
}

export async function findById(id: string) {
  const route = await RouteModel.findOne({ _id: id, isTrashed: { $ne: true } }).populate('createdBy', '-password').exec();

  if (!route) {
    throw notFound('Route not found');
  }

  const dealerCount = await DealerModel.countDocuments({ route: new Types.ObjectId(id), isTrashed: { $ne: true } }).exec();
  return { ...route.toObject({ flattenMaps: true }), dealerCount };
}

export async function updateRoute(id: string, data: object, actorId?: string) {
  const route = await RouteModel.findOne({ _id: id, isTrashed: { $ne: true } }).exec();

  if (!route) {
    throw notFound('Route not found');
  }

  Object.assign(route, data);
  await route.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'route',
    entityId: String(route._id),
    action: 'updated',
    meta: { name: route.name },
  });

  return route;
}

export async function deleteRoute(id: string, actorId?: string) {
  const route = await RouteModel.findOne({ _id: id, isTrashed: { $ne: true } }).exec();

  if (!route) {
    throw notFound('Route not found');
  }

  route.isTrashed = true;
  route.trashedAt = new Date();
  route.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await route.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'route',
    entityId: String(route._id),
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { name: route.name },
  });

  return { message: 'Route moved to trash successfully' };
}

export async function restoreRoute(id: string, actorId?: string) {
  const route = await RouteModel.findOne({ _id: id, isTrashed: true }).exec();
  if (!route) throw notFound('Route not found in trash');
  route.isTrashed = false;
  route.trashedAt = undefined;
  route.trashedBy = undefined;
  await route.save();
  logActivityAsync({
    employeeId: actorId,
    module: 'route',
    entityId: String(route._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { name: route.name },
  });
  return route;
}

export async function permanentlyDeleteRoute(id: string, actorId?: string) {
  const route = await RouteModel.findOne({ _id: id, isTrashed: true }).exec();
  if (!route) throw notFound('Route not found in trash');
  await RouteModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'route',
    entityId: String(route._id),
    action: 'deleted',
    meta: { name: route.name, permanent: true },
  });
  return { message: 'Route permanently deleted successfully' };
}
