import { Types } from 'mongoose';
import { DealerModel } from '../../models/dealer.model';
import { RouteModel } from '../../models/route.model';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import { notFound } from '../../utils/app-error';

export async function createRoute(
  data: { name: string; startingPoint: string; endingPoint: string },
  userId?: string,
) {
  return RouteModel.create({
    ...data,
    ...(userId && { createdBy: new Types.ObjectId(userId) }),
  });
}

export async function findAll(search?: string) {
  const query: Record<string, unknown> = {};

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
  const route = await RouteModel.findById(id).populate('createdBy', '-password').exec();

  if (!route) {
    throw notFound('Route not found');
  }

  const dealerCount = await DealerModel.countDocuments({ route: new Types.ObjectId(id) }).exec();
  return { ...route.toObject({ flattenMaps: true }), dealerCount };
}

export async function updateRoute(id: string, data: object) {
  const route = await RouteModel.findById(id).exec();

  if (!route) {
    throw notFound('Route not found');
  }

  Object.assign(route, data);
  await route.save();

  return route;
}

export async function deleteRoute(id: string) {
  const route = await RouteModel.findById(id).exec();

  if (!route) {
    throw notFound('Route not found');
  }

  await RouteModel.findByIdAndDelete(id);

  return { message: 'Route deleted successfully' };
}
