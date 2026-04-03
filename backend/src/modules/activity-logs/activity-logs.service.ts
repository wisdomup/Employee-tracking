import { ActivityLogModel } from '../../models/activity-log.model';

type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'started_task'
  | 'completed_task';

type ActivityModule =
  | 'task'
  | 'order'
  | 'product'
  | 'category'
  | 'dealer'
  | 'route'
  | 'return'
  | 'visit'
  | 'employee';

export async function logActivity(data: {
  employeeId?: string;
  module: ActivityModule;
  entityId: string;
  action: ActivityAction;
  taskId?: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  meta?: Record<string, unknown>;
}) {
  return ActivityLogModel.create({ ...data, timestamp: new Date() });
}

export function logActivityAsync(data: {
  employeeId?: string;
  module: ActivityModule;
  entityId: string;
  action: ActivityAction;
  taskId?: string;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  meta?: Record<string, unknown>;
}) {
  setImmediate(() => {
    logActivity(data).catch((err) => {
      console.error('Failed to write activity log:', err);
    });
  });
}

export async function findAll(filters?: {
  employeeId?: string;
  module?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}) {
  const query: Record<string, unknown> = {};

  if (filters?.employeeId) query.employeeId = filters.employeeId;
  if (filters?.module) query.module = filters.module;
  if (filters?.action) query.action = filters.action;

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
    .limit(filters?.limit ?? 100)
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
    .populate('employeeId', '-password')
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
