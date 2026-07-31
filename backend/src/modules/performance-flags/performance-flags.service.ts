import { Types } from 'mongoose';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import { notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

/**
 * Flags visible to the caller.
 * `visibleEmployeeIds === null` means unrestricted (admin); otherwise the list is the
 * caller's scope, so a manager sees only their own team's flags and a rider their own.
 */
export async function findFlags(filters: {
  employeeId?: string;
  type?: string;
  resolved?: boolean;
  startDate?: string;
  endDate?: string;
  visibleEmployeeIds?: Types.ObjectId[] | null;
}) {
  const query: Record<string, unknown> = {};

  const allowed = filters.visibleEmployeeIds;
  if (filters.employeeId) {
    const requested = new Types.ObjectId(filters.employeeId);
    if (allowed && !allowed.some((id) => id.equals(requested))) return [];
    query.employeeId = requested;
  } else if (allowed) {
    query.employeeId = { $in: allowed };
  }

  if (filters.type) query.type = filters.type;
  if (filters.resolved !== undefined) query.resolved = filters.resolved;

  if (filters.startDate || filters.endDate) {
    const range: Record<string, Date> = {};
    if (filters.startDate) {
      const s = new Date(filters.startDate);
      s.setUTCHours(0, 0, 0, 0);
      range.$gte = s;
    }
    if (filters.endDate) {
      const e = new Date(filters.endDate);
      e.setUTCHours(23, 59, 59, 999);
      range.$lte = e;
    }
    query.flagDate = range;
  }

  return PerformanceFlagModel.find(query)
    .populate('employeeId', '-password')
    .populate('routeId')
    .populate('resolvedBy', '-password')
    .sort({ resolved: 1, flagDate: -1 })
    .exec();
}

/** Counts of open flags, for a dashboard badge. */
export async function countOpenFlags(visibleEmployeeIds?: Types.ObjectId[] | null) {
  const query: Record<string, unknown> = { resolved: false };
  if (visibleEmployeeIds) query.employeeId = { $in: visibleEmployeeIds };

  const rows = await PerformanceFlagModel.aggregate<{ _id: string; count: number }>([
    { $match: query },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);

  const byType = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return {
    total: rows.reduce((sum, r) => sum + r.count, 0),
    lowVisitCompletion: byType.low_visit_completion ?? 0,
    overstay: byType.overstay ?? 0,
  };
}

/** Marks a flag as reviewed. Admins and sales managers only (enforced by the route). */
export async function resolveFlag(id: string, actorId: string) {
  const flag = await PerformanceFlagModel.findById(id).exec();
  if (!flag) throw notFound('Flag not found');

  flag.resolved = true;
  flag.resolvedAt = new Date();
  flag.resolvedBy = new Types.ObjectId(actorId);
  await flag.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(flag.employeeId),
    action: 'updated',
    meta: { source: 'performance_flag_resolved', type: flag.type, flagDate: flag.flagDate },
  });

  return flag;
}
