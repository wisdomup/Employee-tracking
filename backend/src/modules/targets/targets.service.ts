import { Types } from 'mongoose';
import { TargetModel } from '../../models/target.model';
import { UserModel } from '../../models/user.model';
import { ROLES } from '../../constants/global';
import { notFound, badRequest, forbidden } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { isValidPeriodMonth } from '../analytics/analytics.rules';

/**
 * Whether `actor` is allowed to set targets for `employeeId`.
 * Admins may target anyone; a sales manager only their own direct reports.
 */
async function assertCanManageTargetFor(
  employeeId: string,
  actorId: string,
  actorRole: string,
): Promise<void> {
  if (actorRole === ROLES.ADMIN) return;
  if (actorRole !== ROLES.SALES_MANAGER) {
    throw forbidden('You are not allowed to set targets');
  }
  const employee = await UserModel.findOne({ _id: employeeId, isTrashed: { $ne: true } })
    .select('managerId')
    .lean()
    .exec();
  if (!employee) throw notFound('Employee not found');
  if (String(employee.managerId ?? '') !== actorId) {
    throw forbidden('You can only set targets for your own team');
  }
}

/**
 * Creates or updates the target for one employee/month.
 * Upsert keyed on `{ employeeId, periodMonth }` so setting a target twice edits it
 * rather than creating a duplicate.
 */
export async function upsertTarget(
  data: {
    employeeId: string;
    periodMonth: string;
    salesAmount?: number;
    orderCount?: number;
    visitCount?: number;
    notes?: string;
  },
  actorId: string,
  actorRole: string,
) {
  if (!isValidPeriodMonth(data.periodMonth)) {
    throw badRequest('periodMonth must be in YYYY-MM format');
  }
  await assertCanManageTargetFor(data.employeeId, actorId, actorRole);

  const { employeeId, periodMonth, ...metrics } = data;

  const target = await TargetModel.findOneAndUpdate(
    { employeeId: new Types.ObjectId(employeeId), periodMonth },
    {
      $set: metrics,
      $setOnInsert: {
        employeeId: new Types.ObjectId(employeeId),
        periodMonth,
        createdBy: new Types.ObjectId(actorId),
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(employeeId),
    action: 'updated',
    meta: { source: 'target_set', periodMonth, ...metrics },
  });

  return target;
}

/** Targets matching the filters, newest month first, with the employee populated. */
export async function findTargets(filters: {
  employeeId?: string;
  periodMonth?: string;
  employeeIds?: Types.ObjectId[] | null;
}) {
  const query: Record<string, unknown> = {};
  if (filters.periodMonth) query.periodMonth = filters.periodMonth;

  // `employeeIds === null` means unrestricted (admin); an array is the viewer's scope.
  // When an explicit employeeId is also requested, intersect the two rather than letting
  // either silently win — asking for someone outside your scope returns nothing.
  const allowed = filters.employeeIds;
  if (filters.employeeId) {
    const requested = new Types.ObjectId(filters.employeeId);
    if (allowed && !allowed.some((id) => id.equals(requested))) {
      return [];
    }
    query.employeeId = requested;
  } else if (allowed) {
    query.employeeId = { $in: allowed };
  }

  return TargetModel.find(query)
    .populate('employeeId', '-password')
    .populate('createdBy', '-password')
    .sort({ periodMonth: -1 })
    .exec();
}

export async function deleteTarget(id: string, actorId: string, actorRole: string) {
  const target = await TargetModel.findById(id).exec();
  if (!target) throw notFound('Target not found');

  await assertCanManageTargetFor(String(target.employeeId), actorId, actorRole);
  await TargetModel.findByIdAndDelete(id).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(target.employeeId),
    action: 'deleted',
    meta: { source: 'target_deleted', periodMonth: target.periodMonth },
  });

  return { message: 'Target deleted successfully' };
}
