/**
 * Account freezing for riders who start their day too late.
 *
 * Two things put a rider in the frozen state, and both land here:
 *
 * 1. `enforceFirstCheckInDeadline` — the rider finally turns up at a shop AFTER the
 *    deadline and tries to check in. Refused, and the account is frozen on the spot.
 * 2. `sweepLateStarters` — the daily cron, just after the deadline, catching riders who
 *    simply never turned up at all. Without this a no-show would stay quietly unfrozen
 *    all day, because they never perform the action that trips rule 1.
 *
 * Both write the same `late_start` performance flag, so the freeze always has an audit
 * trail in the admin's existing "needs review" feed. Only an admin can clear the freeze.
 */

import { Types } from 'mongoose';
import { UserModel, type IUser } from '../../models/user.model';
import { VisitModel } from '../../models/visit.model';
import { ApprovalModel } from '../../models/approval.model';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import { badRequest, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  FREEZE_ELIGIBLE_ROLES,
  FREEZE_TIMEZONE,
  configuredDeadline,
  formatDeadline,
  isFreezeRuleEnabled,
  isNonWorkingDay,
  isPastDeadline,
  lateStartFlagMessage,
  lateStartReason,
  minuteOfDayInZone,
  minutesSinceMidnight,
} from './account-freeze.rules';

/**
 * UTC midnight..23:59:59.999 for the day an instant falls on.
 *
 * Deliberately UTC, matching `getDayVisitTally` and the visit-generation cron, which
 * stamp `visitDate` at UTC midnight. Bucketing by local day here instead would put the
 * freeze check on a different day boundary from the visits it is checking, and a rider
 * near the boundary would be frozen for missing visits the query could not see.
 */
function utcDayRange(instant: Date): { start: Date; end: Date } {
  const start = new Date(instant);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(instant);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/** Roles the rule applies to, as a plain string list for Mongo queries. */
const FREEZE_ROLE_VALUES: string[] = [...FREEZE_ELIGIBLE_ROLES];

export function isFreezeEligibleRole(role: string | undefined): boolean {
  return !!role && FREEZE_ROLE_VALUES.includes(role);
}

/** How many route-assigned (non-extra) visits the rider has for the day. */
async function countAssignedVisits(employeeId: Types.ObjectId, day: Date): Promise<number> {
  const { start, end } = utcDayRange(day);
  const rows = await VisitModel.aggregate<{ count: number }>([
    {
      $match: {
        employeeId,
        isTrashed: { $ne: true },
        // Self-started extras are not assigned work, so they cannot create an obligation
        // to be somewhere by 12:30. Same exclusion the 75% adherence rule makes.
        isSelfInitiated: { $ne: true },
        // A cancelled visit was called off — not work the rider failed to turn up for.
        status: { $ne: 'cancelled' },
      },
    },
    { $addFields: { effectiveDate: { $ifNull: ['$visitDate', '$createdAt'] } } },
    { $match: { effectiveDate: { $gte: start, $lte: end } } },
    { $count: 'count' },
  ]);
  return rows[0]?.count ?? 0;
}

/**
 * Whether the rider has an admin-approved absence for this day.
 *
 * Any approved `leave` counts, including `half_day` and `short_leave` — an admin signed off
 * on the absence, and a half day is a perfectly good reason to reach the first shop after
 * noon. A `pending` request does NOT exempt anyone; letting it would make the freeze
 * trivially avoidable by filing a request nobody ever approves.
 */
async function isOnApprovedLeave(employeeId: Types.ObjectId, day: Date): Promise<boolean> {
  const { start, end } = utcDayRange(day);
  const leave = await ApprovalModel.exists({
    employeeId,
    approvalType: 'leave',
    status: 'approved',
    leaveDate: { $gte: start, $lte: end },
  });
  return leave !== null;
}

/**
 * Days nobody can be frozen on: the company holiday, and a rider's own approved leave.
 * Shared by the check-in guard and the sweep so the two cannot drift apart.
 */
async function isExemptDay(employeeId: Types.ObjectId, now: Date): Promise<boolean> {
  if (isNonWorkingDay(now)) return true;
  return isOnApprovedLeave(employeeId, now);
}

/** The rider's earliest check-in of the day, or null if they have not arrived anywhere. */
async function findFirstCheckInAt(
  employeeId: Types.ObjectId,
  day: Date,
): Promise<Date | null> {
  const { start, end } = utcDayRange(day);
  const earliest = await VisitModel.findOne({
    employeeId,
    isTrashed: { $ne: true },
    checkedInAt: { $gte: start, $lte: end },
  })
    .select('checkedInAt')
    .sort({ checkedInAt: 1 })
    .lean()
    .exec();

  return earliest?.checkedInAt ?? null;
}

/** Writes (or updates) the `late_start` flag for the rider's day. */
async function raiseLateStartFlag(params: {
  employeeId: Types.ObjectId;
  day: Date;
  arrivedAt: Date | null;
  assignedVisits: number;
  visitId?: Types.ObjectId;
}): Promise<void> {
  const deadline = configuredDeadline();
  const { start: flagDate } = utcDayRange(params.day);

  await PerformanceFlagModel.findOneAndUpdate(
    { employeeId: params.employeeId, type: 'late_start', flagDate },
    {
      $set: {
        message: lateStartFlagMessage(params.arrivedAt, params.assignedVisits, deadline),
        // Both sides are minutes since local midnight, so `value` vs `threshold` reads as
        // "arrived at minute 812, allowed until minute 750" in the admin table.
        ...(params.arrivedAt
          ? { value: minuteOfDayInZone(params.arrivedAt, FREEZE_TIMEZONE) }
          : {}),
        threshold: minutesSinceMidnight(deadline),
        ...(params.visitId ? { visitId: params.visitId } : {}),
        resolved: false,
        meta: {
          deadline: formatDeadline(deadline),
          timeZone: FREEZE_TIMEZONE,
          assignedVisits: params.assignedVisits,
          arrivedAt: params.arrivedAt,
          neverArrived: params.arrivedAt === null,
        },
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).exec();
}

/**
 * Freezes an account. Idempotent: re-freezing an already-frozen user is a no-op, so the
 * original `frozenAt` (the moment they actually offended) survives a repeated sweep.
 */
export async function freezeUser(
  userId: Types.ObjectId | string,
  reason: string,
  actorId?: string,
): Promise<boolean> {
  const result = await UserModel.updateOne(
    { _id: userId, isTrashed: { $ne: true }, isFrozen: { $ne: true } },
    {
      $set: {
        isFrozen: true,
        frozenAt: new Date(),
        frozenReason: reason,
        ...(actorId ? { frozenBy: new Types.ObjectId(actorId) } : {}),
      },
      $unset: { unfrozenAt: 1, unfrozenBy: 1, ...(actorId ? {} : { frozenBy: 1 }) },
    },
  ).exec();

  const froze = (result.modifiedCount ?? 0) > 0;
  if (froze) {
    logActivityAsync({
      employeeId: actorId,
      module: 'employee',
      entityId: String(userId),
      action: 'flagged',
      meta: { source: 'account_frozen', reason, automatic: !actorId },
    });
  }
  return froze;
}

/** Clears a freeze. Admin-only — enforced by the route. */
export async function unfreezeUser(
  userId: string,
  actorId: string,
  note?: string,
): Promise<IUser> {
  if (!Types.ObjectId.isValid(userId)) {
    throw badRequest('Invalid user id');
  }

  const user = await UserModel.findOne({ _id: userId, isTrashed: { $ne: true } })
    .select('-password')
    .exec();
  if (!user) {
    throw notFound('User not found');
  }
  if (user.isFrozen !== true) {
    throw badRequest('This account is not frozen');
  }

  user.isFrozen = false;
  user.unfrozenAt = new Date();
  user.unfrozenBy = new Types.ObjectId(actorId);
  // `frozenAt` / `frozenReason` are kept: they are the record of the last freeze, and the
  // admin list shows "last frozen on…" for someone who is repeatedly late.
  await user.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: 'updated',
    meta: {
      source: 'account_unfrozen',
      previousReason: user.frozenReason,
      ...(note ? { note } : {}),
    },
  });

  return user;
}

/** Everyone currently frozen, newest freeze first — the admin's queue. */
export async function findFrozenUsers() {
  return UserModel.find({ isFrozen: true, isTrashed: { $ne: true } })
    .select('-password')
    .populate('frozenBy', 'username fullName')
    .sort({ frozenAt: -1 })
    .exec();
}

/** The freeze state the rider's own app reads, to render the banner. */
export async function getFreezeStatus(userId: string) {
  const user = await UserModel.findOne({ _id: userId, isTrashed: { $ne: true } })
    .select('isFrozen frozenAt frozenReason role')
    .lean()
    .exec();
  if (!user) {
    throw notFound('User not found');
  }

  return {
    isFrozen: user.isFrozen === true,
    frozenAt: user.frozenAt ?? null,
    frozenReason: user.frozenReason ?? null,
    /** So the rider's app can show the deadline even on a day they are not frozen. */
    deadline: formatDeadline(),
    subjectToRule: isFreezeEligibleRole(user.role),
  };
}

/**
 * Called from the check-in path. If this would be the rider's FIRST check-in of the day
 * and the deadline has already passed, freezes them and returns the reason for the caller
 * to refuse with. Returns `null` when the check-in may proceed.
 *
 * Only the first check-in is judged: once a rider is on the road on time, the rest of the
 * day is governed by the existing completion/overstay rules, not this one.
 */
export async function enforceFirstCheckInDeadline(params: {
  employeeId: Types.ObjectId;
  role: string | undefined;
  now: Date;
  visitId?: Types.ObjectId;
}): Promise<string | null> {
  if (!isFreezeRuleEnabled()) return null;
  if (!isFreezeEligibleRole(params.role)) return null;
  if (!isPastDeadline(params.now)) return null;

  // Already out working — this is a later check-in, which the rule does not touch.
  const firstCheckIn = await findFirstCheckInAt(params.employeeId, params.now);
  if (firstCheckIn) return null;

  // The company holiday and approved leave are the ONLY excuses. Note what is deliberately
  // absent: having no assigned visits. That used to exempt a rider, which silently disabled
  // the whole rule whenever the visit-generation cron stopped producing visits — every
  // rider then had an empty day and none could ever be frozen.
  if (await isExemptDay(params.employeeId, params.now)) return null;

  // Reported on the flag for context only; it no longer gates the freeze.
  const assignedVisits = await countAssignedVisits(params.employeeId, params.now);

  const reason = lateStartReason(params.now);
  await freezeUser(params.employeeId, reason);
  await raiseLateStartFlag({
    employeeId: params.employeeId,
    day: params.now,
    arrivedAt: params.now,
    assignedVisits,
    visitId: params.visitId,
  });

  return reason;
}

/**
 * The daily sweep, run by the cron just after the deadline.
 *
 * Freezes every eligible rider who has not checked in anywhere today — whether or not the
 * cron assigned them any visits. Only the company holiday and approved leave excuse it.
 *
 * `frozenWithNoAssignedVisits` counts riders frozen on an empty day. It is NOT a skip
 * count: a high number there means the visit-generation cron has stopped producing visits,
 * which is worth the admin knowing, but it no longer stops anyone being frozen.
 *
 * Riders already frozen are skipped, so a re-run (or a manual invocation) is safe and does
 * not overwrite the original freeze time.
 */
export async function sweepLateStarters(now: Date = new Date()): Promise<{
  evaluated: number;
  frozen: number;
  frozenWithNoAssignedVisits: number;
  skippedAlreadyStarted: number;
  skippedAlreadyFrozen: number;
  skippedExempt: number;
}> {
  const summary = {
    evaluated: 0,
    frozen: 0,
    frozenWithNoAssignedVisits: 0,
    skippedAlreadyStarted: 0,
    skippedAlreadyFrozen: 0,
    skippedExempt: 0,
  };

  if (!isFreezeRuleEnabled()) {
    return summary;
  }

  // Running before the deadline would freeze riders who still have time to make it.
  if (!isPastDeadline(now)) {
    return summary;
  }

  // Nobody is expected at a shop on the company holiday.
  if (isNonWorkingDay(now)) {
    return summary;
  }

  const riders = await UserModel.find({
    role: { $in: FREEZE_ROLE_VALUES },
    isActive: true,
    isTrashed: { $ne: true },
  })
    .select('_id isFrozen')
    .lean()
    .exec();

  for (const rider of riders) {
    summary.evaluated += 1;

    if (rider.isFrozen === true) {
      summary.skippedAlreadyFrozen += 1;
      continue;
    }

    const firstCheckIn = await findFirstCheckInAt(rider._id, now);
    if (firstCheckIn) {
      summary.skippedAlreadyStarted += 1;
      continue;
    }

    // Approved leave is the only per-rider excuse. An empty day is NOT one: riders are
    // expected at a shop by the deadline whether or not the cron assigned them a route.
    if (await isOnApprovedLeave(rider._id, now)) {
      summary.skippedExempt += 1;
      continue;
    }

    const assignedVisits = await countAssignedVisits(rider._id, now);
    if (assignedVisits === 0) {
      // Still frozen — counted separately so the admin can see the visit cron is idle.
      summary.frozenWithNoAssignedVisits += 1;
    }

    await freezeUser(rider._id, lateStartReason(null));
    await raiseLateStartFlag({
      employeeId: rider._id,
      day: now,
      arrivedAt: null,
      assignedVisits,
    });
    summary.frozen += 1;
  }

  return summary;
}
