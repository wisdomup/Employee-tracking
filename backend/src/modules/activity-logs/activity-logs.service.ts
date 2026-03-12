import { ActivityLogModel } from '../../models/activity-log.model';

export async function logActivity(data: {
  employeeId: string;
  taskId: string;
  action: 'started_task' | 'completed_task';
  latitude: number;
  longitude: number;
}) {
  return ActivityLogModel.create({ ...data, timestamp: new Date() });
}

export async function findAll(filters?: {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const query: Record<string, unknown> = {};

  if (filters?.employeeId) query.employeeId = filters.employeeId;

  if (filters?.startDate || filters?.endDate) {
    const dateRange: Record<string, Date> = {};
    if (filters.startDate) dateRange.$gte = new Date(filters.startDate);
    if (filters.endDate) dateRange.$lte = new Date(filters.endDate);
    query.timestamp = dateRange;
  }

  return ActivityLogModel.find(query)
    .populate('employeeId', '-password')
    .populate({
      path: 'taskId',
      populate: { path: 'dealerId' },
    })
    .sort({ timestamp: -1 })
    .exec();
}

export async function findByEmployee(
  employeeId: string,
  filters?: { startDate?: string; endDate?: string },
) {
  const query: Record<string, unknown> = { employeeId };

  if (filters?.startDate || filters?.endDate) {
    const dateRange: Record<string, Date> = {};
    if (filters.startDate) dateRange.$gte = new Date(filters.startDate);
    if (filters.endDate) dateRange.$lte = new Date(filters.endDate);
    query.timestamp = dateRange;
  }

  return ActivityLogModel.find(query)
    .populate({ path: 'taskId', populate: { path: 'dealerId' } })
    .sort({ timestamp: -1 })
    .exec();
}

export async function getRecentActivity(limit: number = 10) {
  return ActivityLogModel.find()
    .populate('employeeId', 'username phone')
    .populate({
      path: 'taskId',
      select: 'taskName dealerId',
      populate: { path: 'dealerId', select: 'name' },
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .exec();
}
