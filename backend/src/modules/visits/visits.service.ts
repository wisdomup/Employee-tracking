import { Types } from 'mongoose';
import { VisitModel } from '../../models/visit.model';
import { RouteModel } from '../../models/route.model';
import { DealerModel } from '../../models/dealer.model';
import * as routeAssignmentsService from '../route-assignments/route-assignments.service';
import { notFound, badRequest } from '../../utils/app-error';

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

  return VisitModel.create({
    ...rest,
    dealerId: new Types.ObjectId(dealerId),
    employeeId: new Types.ObjectId(employeeId),
    ...(routeId && { routeId: new Types.ObjectId(routeId) }),
    ...(userId && { createdBy: new Types.ObjectId(userId) }),
  });
}

export async function findAll(filters?: {
  dealerId?: string;
  employeeId?: string;
  routeId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}) {
  const query: Record<string, unknown> = {};

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
  const visit = await VisitModel.findById(id)
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

export async function updateVisit(id: string, data: Record<string, unknown>) {
  const visit = await VisitModel.findById(id);

  if (!visit) {
    throw notFound('Visit not found');
  }

  if (data.dealerId) data.dealerId = new Types.ObjectId(data.dealerId as string);
  if (data.employeeId) data.employeeId = new Types.ObjectId(data.employeeId as string);
  if (data.routeId) data.routeId = new Types.ObjectId(data.routeId as string);

  Object.assign(visit, data);
  await visit.save();

  return visit;
}

export async function deleteVisit(id: string) {
  const visit = await VisitModel.findById(id);

  if (!visit) {
    throw notFound('Visit not found');
  }

  await VisitModel.findByIdAndDelete(id);

  return { message: 'Visit deleted successfully' };
}

export async function createVisitsForRoute(
  routeId: string,
  userId?: string,
): Promise<{ created: number; skipped: number }> {
  const route = await RouteModel.findById(routeId);
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

  const dealers = await DealerModel.find({ route: new Types.ObjectId(routeId) }).exec();
  if (!dealers.length) {
    throw badRequest('Route has no dealers');
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const routeObjectId = new Types.ObjectId(routeId);
  let created = 0;
  let skipped = 0;

  for (const dealer of dealers) {
    const existing = await VisitModel.findOne({
      dealerId: dealer._id,
      employeeId: employeeObjectId,
      routeId: routeObjectId,
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
    });
    created += 1;
  }

  return { created, skipped };
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

  return visit;
}
