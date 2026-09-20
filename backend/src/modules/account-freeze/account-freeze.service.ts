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
import { RiderFineModel, type FineSource } from '../../models/rider-fine.model';
import { PayrollRunModel } from '../../models/payroll-run.model';
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
  lateStartFineReason,
  lateStartFlagMessage,
  lateStartReason,
  minuteOfDayInZone,
  minutesSinceMidnight,
  configuredFineAmount,
  parseFineAmount,
  resolveFineAmount,
  withFineNotice,
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

/**
 * Whether an admin has already lifted this rider's freeze today.
 *
 * Compares against UTC midnight of `now` — the same day boundary everything else in this
 * module uses — so the pardon covers exactly the day it was granted on and no other.
 */
function isPardonedOn(pardonedFor: Date | null | undefined, now: Date): boolean {
  if (!pardonedFor) return false;
  return new Date(pardonedFor).getTime() === utcDayRange(now).start.getTime();
}

/** Same check for the guard path, where the user document has not been loaded. */
async function isPardonedToday(employeeId: Types.ObjectId, now: Date): Promise<boolean> {
  const user = await UserModel.findById(employeeId).select('freezePardonedFor').lean().exec();
  return isPardonedOn(user?.freezePardonedFor, now);
}

/**
 * Whether this rider has already been judged for the day.
 *
 * The `late_start` flag is written the instant a rider is first evaluated, so its presence
 * means "the verdict for today is already in". Once that exists the rule stops looking at
 * them for the rest of the day, whatever an admin subsequently does with the freeze.
 *
 * This is what makes "only the FIRST visit is checked" literally true. Without it, a rider
 * who was refused at their first shop has no `checkedInAt` recorded, so every later attempt
 * still looks like a first check-in and gets re-judged — which is how an unfreeze ended up
 * being undone seconds later. `freezePardonedFor` covers the same case, but it depends on
 * two dates agreeing; this depends only on a row existing, so it holds even across a
 * timezone/day-boundary edge where the two dates could disagree.
 */
async function hasBeenJudgedToday(employeeId: Types.ObjectId, day: Date): Promise<boolean> {
  const { start: flagDate } = utcDayRange(day);
  const flag = await PerformanceFlagModel.exists({
    employeeId,
    type: 'late_start',
    flagDate,
  });
  return flag !== null;
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
  /** Rupees charged with the freeze, so the admin's flag row carries the money too. */
  fineAmount?: number;
}): Promise<void> {
  const deadline = configuredDeadline();
  const { start: flagDate } = utcDayRange(params.day);

  await PerformanceFlagModel.findOneAndUpdate(
    { employeeId: params.employeeId, type: 'late_start', flagDate },
    {
      $set: {
        message: lateStartFlagMessage(
          params.arrivedAt,
          params.assignedVisits,
          deadline,
          FREEZE_TIMEZONE,
          params.fineAmount ?? 0,
        ),
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
          fineAmount: params.fineAmount ?? 0,
        },
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).exec();
}

/**
 * Rupees already taken off pay for fines, per employee.
 *
 * Read from POSTED payroll runs, never from a flag on the fine. A cancelled run therefore
 * releases its recovery the moment it is cancelled, with nothing to write back and nothing left
 * pointing at a month that no longer exists — the same rule bills and advances follow here.
 *
 * Drafts are excluded on purpose: a draft recovery has taken nothing off anybody yet, and
 * counting it would tell a rider they no longer owe money that is still on their next payslip.
 */
export async function fineRecoveredByEmployee(
  employeeIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();

  const rows = await PayrollRunModel.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { status: 'posted', 'lines.userId': { $in: employeeIds } } },
    { $unwind: '$lines' },
    { $match: { 'lines.userId': { $in: employeeIds } } },
    { $group: { _id: '$lines.userId', total: { $sum: '$lines.fineRecovery' } } },
  ]).exec();

  return new Map(rows.map((row) => [String(row._id), row.total ?? 0]));
}

/** Fines raised and not waived, per employee — what has been charged, before any recovery. */
async function fineChargedByEmployee(
  employeeIds: Types.ObjectId[],
): Promise<Map<string, { total: number; count: number }>> {
  if (employeeIds.length === 0) return new Map();

  const rows = await RiderFineModel.aggregate<{ _id: Types.ObjectId; total: number; count: number }>([
    { $match: { employeeId: { $in: employeeIds }, status: 'outstanding' } },
    { $group: { _id: '$employeeId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]).exec();

  return new Map(rows.map((row) => [String(row._id), { total: row.total, count: row.count }]));
}

/**
 * What each rider still owes in fines: raised, less waived, less recovered from pay.
 *
 * The single figure everything reads — the rider's banner, the admin queue, and the cap payroll
 * applies to a deduction. Nothing stores it, so it cannot disagree with the fines or the runs it
 * is made of.
 */
export async function fineBalanceByEmployee(
  employeeIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  const [charged, recovered] = await Promise.all([
    fineChargedByEmployee(employeeIds),
    fineRecoveredByEmployee(employeeIds),
  ]);

  const balances = new Map<string, number>();
  for (const id of employeeIds) {
    const key = String(id);
    const owed = (charged.get(key)?.total ?? 0) - (recovered.get(key) ?? 0);
    // Never negative. A rider whose recovery exceeds what is now charged (a fine waived after it
    // was deducted) is owed a refund, which is a payroll correction, not a negative fine balance.
    balances.set(key, Math.max(0, owed));
  }
  return balances;
}

/** This rider's own fine amount, or the company default when an admin has not set one. */
async function fineAmountFor(employeeId: Types.ObjectId): Promise<number> {
  const user = await UserModel.findById(employeeId).select('freezeFineAmount').lean().exec();
  return resolveFineAmount(user?.freezeFineAmount);
}

/**
 * Raises the late-start fine for a rider's day, and returns what they were charged.
 *
 * Returns `0` — writing nothing — when the amount resolves to zero, so "this rider is not
 * fined" leaves no misleading Rs. 0 row in their history.
 *
 * Idempotent on `{ employeeId, type, fineDate }`: the guard and the sweep both call it for the
 * same offence, and the manual sweep button can be pressed any number of times. `$setOnInsert`
 * for everything that describes the offence means a repeat call cannot re-price a fine an admin
 * has already adjusted, or resurrect one they have waived.
 */
export async function issueLateStartFine(params: {
  employeeId: Types.ObjectId;
  day: Date;
  arrivedAt: Date | null;
  source: FineSource;
  /** Pre-resolved amount, when the caller already looked it up. */
  amount?: number;
}): Promise<number> {
  const amount = params.amount ?? (await fineAmountFor(params.employeeId));
  if (amount <= 0) return 0;

  const { start: fineDate } = utcDayRange(params.day);
  const reason = lateStartFineReason(params.arrivedAt);

  const result = await RiderFineModel.updateOne(
    { employeeId: params.employeeId, type: 'late_start_freeze', fineDate },
    {
      $setOnInsert: {
        employeeId: params.employeeId,
        type: 'late_start_freeze',
        fineDate,
        amount,
        originalAmount: amount,
        reason,
        status: 'outstanding',
        source: params.source,
        issuedAt: new Date(),
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).exec();

  // `upsertedCount` is 1 only on the call that actually inserted — the one in a repeated sweep
  // that really charged the rider. Logging every call would fill the activity feed with fines
  // that were never raised.
  const inserted = (result.upsertedCount ?? 0) > 0;
  if (inserted) {
    logActivityAsync({
      module: 'employee',
      entityId: String(params.employeeId),
      action: 'flagged',
      meta: { source: 'late_start_fine', amount, reason, automatic: params.source !== 'manual' },
    });
  }

  return amount;
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
      // A fresh freeze spends any earlier pardon: it can only be a later day than the one
      // that pardon covered, so leaving it would be stale data the sweep has to reason about.
      $unset: { unfrozenAt: 1, unfrozenBy: 1, freezePardonedFor: 1, ...(actorId ? {} : { frozenBy: 1 }) },
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
  /** Injected clock, so the pardon date is testable. Production always uses real time. */
  now: Date = new Date(),
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
  user.unfrozenAt = now;
  user.unfrozenBy = new Types.ObjectId(actorId);
  // The pardon. Without it the rider is handed straight back into the same failing state —
  // still past the deadline, still no check-in — and the guard re-freezes them on their very
  // next action, which is exactly what the admin just intervened to prevent.
  user.freezePardonedFor = utcDayRange(now).start;
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

/**
 * Everyone currently frozen, newest freeze first — the admin's queue.
 *
 * Each row carries the fine raised with today's freeze and the rider's total outstanding, so
 * the admin can see the money without opening a second screen: the fine and the freeze are one
 * event to everybody except the database.
 */
export async function findFrozenUsers(now: Date = new Date()) {
  const users = await UserModel.find({ isFrozen: true, isTrashed: { $ne: true } })
    .select('-password')
    .populate('frozenBy', 'username fullName')
    .sort({ frozenAt: -1 })
    .lean()
    .exec();

  if (users.length === 0) return [];

  const ids = users.map((u) => u._id);
  const { start: today } = utcDayRange(now);

  // Aggregates for the whole page rather than queries per row — this list is short today, but
  // it is the screen that grows on exactly the days it is being watched.
  const [todayFines, counts, balances, recovered] = await Promise.all([
    RiderFineModel.find({ employeeId: { $in: ids }, fineDate: today }).lean().exec(),
    RiderFineModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { employeeId: { $in: ids }, status: 'outstanding' } },
      { $group: { _id: '$employeeId', count: { $sum: 1 } } },
    ]),
    fineBalanceByEmployee(ids),
    fineRecoveredByEmployee(ids),
  ]);

  const fineByUser = new Map(todayFines.map((f) => [String(f.employeeId), f]));
  const countByUser = new Map(counts.map((row) => [String(row._id), row.count]));

  return users.map((user) => {
    const fine = fineByUser.get(String(user._id));
    const key = String(user._id);
    return {
      ...user,
      /** What this rider is fined per late start — their own amount, or the company default. */
      fineAmount: resolveFineAmount(user.freezeFineAmount),
      /** True when that amount is this rider's own, not the company default. */
      hasCustomFineAmount: typeof user.freezeFineAmount === 'number',
      /** Today's fine, if one was raised. `null` on a day nothing was charged. */
      todayFine: fine
        ? {
            _id: String(fine._id),
            amount: fine.amount,
            status: fine.status,
            reason: fine.reason,
            issuedAt: fine.issuedAt,
          }
        : null,
      /** Still owed — raised, less waived, less anything payroll has already taken off pay. */
      outstandingFines: balances.get(key) ?? 0,
      outstandingFineCount: countByUser.get(key) ?? 0,
      /** Already deducted from pay. Shown so a cleared rider does not look like an unfined one. */
      finesRecovered: recovered.get(key) ?? 0,
    };
  });
}

/** Every fine raised for a rider, newest first — the answer to "why am I fined for the 9th?". */
export async function listRiderFines(userId: string, limit = 50) {
  if (!Types.ObjectId.isValid(userId)) {
    throw badRequest('Invalid user id');
  }
  return RiderFineModel.find({ employeeId: userId })
    .populate('waivedBy', 'username fullName')
    .populate('amountChangedBy', 'username fullName')
    .sort({ fineDate: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean()
    .exec();
}

/**
 * The numbers behind the admin's banner: who is frozen right now, and what today's freezes
 * cost. Deliberately one call — the banner renders on every admin screen, so it must not be
 * three round trips.
 */
export async function getFineOverview(now: Date = new Date()) {
  const { start: today } = utcDayRange(now);

  const [frozenCount, todayRows, chargedRows, recoveredRows] = await Promise.all([
    UserModel.countDocuments({ isFrozen: true, isTrashed: { $ne: true } }),
    RiderFineModel.aggregate<{ _id: null; total: number; count: number }>([
      { $match: { fineDate: today, type: 'late_start_freeze', status: 'outstanding' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    RiderFineModel.aggregate<{ _id: null; total: number; count: number }>([
      { $match: { status: 'outstanding' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // Company-wide, so it is summed across posted runs rather than per employee.
    PayrollRunModel.aggregate<{ _id: null; total: number }>([
      { $match: { status: 'posted' } },
      { $unwind: '$lines' },
      { $group: { _id: null, total: { $sum: '$lines.fineRecovery' } } },
    ]),
  ]);

  const charged = chargedRows[0]?.total ?? 0;
  const recovered = recoveredRows[0]?.total ?? 0;

  return {
    frozenCount,
    finedToday: todayRows[0]?.count ?? 0,
    finesTodayTotal: todayRows[0]?.total ?? 0,
    outstandingCount: chargedRows[0]?.count ?? 0,
    /** Raised and not waived, less what payroll has already taken off pay. */
    outstandingTotal: Math.max(0, charged - recovered),
    /** Recovered through payroll — the figure that answers "are these fines ever collected?". */
    recoveredTotal: recovered,
    /** The company default, so the admin banner can say what the next late start will cost. */
    defaultFineAmount: configuredFineAmount(),
  };
}

/**
 * Sets (or clears) one rider's own fine amount, and re-prices a fine already raised today.
 *
 * Both halves matter. Without the override the change is a company-wide env edit; without the
 * re-pricing an admin who looks at a frozen rider, decides 200 is wrong for them and types 500
 * has changed nothing about the fine actually in front of them — which is not what anybody
 * means by "change his fine".
 *
 * `amount: null` clears the override and hands the rider back to the company default. `0` is a
 * real amount: frozen, not fined. A fine already waived is left alone — re-pricing something an
 * admin deliberately cancelled would quietly un-forgive it.
 */
export async function setRiderFineAmount(
  userId: string,
  amount: number | null,
  actorId: string,
  now: Date = new Date(),
): Promise<{ fineAmount: number; hasCustomFineAmount: boolean; todayFineUpdated: boolean }> {
  if (!Types.ObjectId.isValid(userId)) {
    throw badRequest('Invalid user id');
  }

  let parsed: number | null = null;
  if (amount !== null) {
    try {
      parsed = parseFineAmount(amount);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  }

  const user = await UserModel.findOne({ _id: userId, isTrashed: { $ne: true } })
    .select('freezeFineAmount role')
    .exec();
  if (!user) {
    throw notFound('User not found');
  }

  const previous = user.freezeFineAmount;
  if (parsed === null) {
    user.set('freezeFineAmount', undefined);
  } else {
    user.freezeFineAmount = parsed;
  }
  await user.save();

  const effective = resolveFineAmount(parsed);

  // Today's fine, if there is an unwaived one, follows the new amount.
  const { start: today } = utcDayRange(now);
  const repriced = await RiderFineModel.updateOne(
    {
      employeeId: user._id,
      type: 'late_start_freeze',
      fineDate: today,
      status: 'outstanding',
      amount: { $ne: effective },
    },
    {
      $set: {
        amount: effective,
        amountChangedAt: new Date(),
        amountChangedBy: new Types.ObjectId(actorId),
      },
    },
  ).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: 'updated',
    changes: { freezeFineAmount: { from: previous ?? null, to: parsed } },
    meta: {
      source: 'late_start_fine_amount',
      effectiveAmount: effective,
      todayFineUpdated: (repriced.modifiedCount ?? 0) > 0,
    },
  });

  return {
    fineAmount: effective,
    hasCustomFineAmount: parsed !== null,
    todayFineUpdated: (repriced.modifiedCount ?? 0) > 0,
  };
}

/**
 * Cancels a fine. The row stays — a fine raised and forgiven is part of the rider's record,
 * and deleting it would make the admin's decision invisible the moment it is questioned.
 *
 * Waiving does NOT unfreeze: the two are separate judgements, and an admin who thinks the
 * lockout was wrong as well has the unfreeze button for that.
 */
export async function waiveFine(fineId: string, actorId: string, note?: string) {
  if (!Types.ObjectId.isValid(fineId)) {
    throw badRequest('Invalid fine id');
  }

  const fine = await RiderFineModel.findById(fineId).exec();
  if (!fine) {
    throw notFound('Fine not found');
  }
  if (fine.status === 'waived') {
    throw badRequest('This fine has already been waived');
  }

  // Money already off the payslip cannot be un-charged here. Waiving it would leave the rider's
  // balance reading zero while payroll had deducted more than was ever charged, and nothing on
  // this screen can hand the money back. That is a payroll correction — a bonus line on the next
  // run — so the admin is told exactly that instead of being given a button that half works.
  const [charged, recovered] = await Promise.all([
    RiderFineModel.aggregate<{ _id: null; total: number }>([
      { $match: { employeeId: fine.employeeId, status: 'outstanding' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).exec(),
    fineRecoveredByEmployee([fine.employeeId]),
  ]);
  const chargedTotal = charged[0]?.total ?? 0;
  const recoveredTotal = recovered.get(String(fine.employeeId)) ?? 0;
  if (chargedTotal - fine.amount < recoveredTotal) {
    throw badRequest(
      'This fine has already been deducted from their pay, so it cannot be cancelled here. '
        + 'Refund it as a bonus on the next payroll run instead.',
    );
  }

  fine.status = 'waived';
  fine.waivedAt = new Date();
  fine.waivedBy = new Types.ObjectId(actorId);
  if (note) fine.waiveNote = note;
  await fine.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(fine.employeeId),
    action: 'updated',
    meta: { source: 'late_start_fine_waived', amount: fine.amount, ...(note ? { note } : {}) },
  });

  return fine;
}

/** The freeze state the rider's own app reads, to render the banner. */
export async function getFreezeStatus(userId: string, now: Date = new Date()) {
  const user = await UserModel.findOne({ _id: userId, isTrashed: { $ne: true } })
    .select('isFrozen frozenAt frozenReason freezePardonedFor role freezeFineAmount')
    .lean()
    .exec();
  if (!user) {
    throw notFound('User not found');
  }

  const { start: today } = utcDayRange(now);
  const [todayFine, outstanding, balances, recovered] = await Promise.all([
    RiderFineModel.findOne({ employeeId: user._id, fineDate: today }).lean().exec(),
    RiderFineModel.aggregate<{ _id: null; count: number }>([
      { $match: { employeeId: user._id, status: 'outstanding' } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
    fineBalanceByEmployee([user._id]),
    fineRecoveredByEmployee([user._id]),
  ]);

  return {
    isFrozen: user.isFrozen === true,
    frozenAt: user.frozenAt ?? null,
    frozenReason: user.frozenReason ?? null,
    /** So the rider's app can show the deadline even on a day they are not frozen. */
    deadline: formatDeadline(),
    subjectToRule: isFreezeEligibleRole(user.role),
    /**
     * True when an admin lifted a freeze for them earlier today. The rider's app uses it to
     * confirm they are cleared for the rest of the day rather than leaving them wondering
     * whether the lock is about to come back.
     */
    pardonedToday: isPardonedOn(user.freezePardonedFor, now),
    /**
     * What a late start costs THIS rider, shown even on a clear day: a penalty nobody knows
     * about deters nothing, and the banner is the only place riders are told.
     */
    fineAmount: resolveFineAmount(user.freezeFineAmount),
    /** Today's fine, if one was raised — the amount the rider is being told about right now. */
    todayFine: todayFine
      ? {
          amount: todayFine.amount,
          status: todayFine.status,
          reason: todayFine.reason,
          issuedAt: todayFine.issuedAt,
        }
      : null,
    /**
     * Still owed: today's fine included, anything an admin waived excluded, and anything a
     * posted payroll run already took off pay excluded. A rider whose fine came off last
     * month's wages must not still be told they owe it.
     */
    outstandingFines: balances.get(String(user._id)) ?? 0,
    outstandingFineCount: outstanding[0]?.count ?? 0,
    /** Already deducted from pay — the other half of the story the rider is owed. */
    finesRecovered: recovered.get(String(user._id)) ?? 0,
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

  // An admin has already let them off for today. Re-freezing now would undo the very
  // intervention that just happened — the rider is still past the deadline with no
  // check-in, so without this the guard fires again on their next action. The pardon
  // covers today only; tomorrow they are judged afresh.
  if (await isPardonedToday(params.employeeId, params.now)) return null;

  // Already judged for today — this is the rule that makes "only the FIRST visit is
  // checked" literal. Whatever the verdict was, and whatever the admin did with it
  // afterwards, the rider is not re-evaluated again until tomorrow.
  if (await hasBeenJudgedToday(params.employeeId, params.now)) return null;

  // Reported on the flag for context only; it no longer gates the freeze.
  const assignedVisits = await countAssignedVisits(params.employeeId, params.now);

  // Charged BEFORE the reason is built, so the rider is told the amount in the same breath as
  // the refusal. Finding out about the money on a later screen is how a fine turns into a
  // dispute — and this refusal message is the only thing some riders will ever read.
  const fineAmount = await issueLateStartFine({
    employeeId: params.employeeId,
    day: params.now,
    arrivedAt: params.now,
    source: 'check_in_guard',
  });

  const reason = withFineNotice(lateStartReason(params.now), fineAmount);
  await freezeUser(params.employeeId, reason);
  await raiseLateStartFlag({
    employeeId: params.employeeId,
    day: params.now,
    arrivedAt: params.now,
    assignedVisits,
    visitId: params.visitId,
    fineAmount,
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
  /** How many of the frozen riders were also fined, and the rupees raised in this run. */
  fined: number;
  finesTotal: number;
  frozenWithNoAssignedVisits: number;
  skippedAlreadyStarted: number;
  skippedAlreadyFrozen: number;
  skippedExempt: number;
  skippedPardoned: number;
  skippedAlreadyJudged: number;
}> {
  const summary = {
    evaluated: 0,
    frozen: 0,
    fined: 0,
    finesTotal: 0,
    frozenWithNoAssignedVisits: 0,
    skippedAlreadyStarted: 0,
    skippedAlreadyFrozen: 0,
    skippedExempt: 0,
    skippedPardoned: 0,
    skippedAlreadyJudged: 0,
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
    .select('_id isFrozen freezePardonedFor freezeFineAmount')
    .lean()
    .exec();

  for (const rider of riders) {
    summary.evaluated += 1;

    if (rider.isFrozen === true) {
      summary.skippedAlreadyFrozen += 1;
      continue;
    }

    // Already pardoned by an admin today — re-freezing would undo that intervention, and
    // the manual "Run late-start check now" button makes it easy to trigger by accident.
    if (isPardonedOn(rider.freezePardonedFor, now)) {
      summary.skippedPardoned += 1;
      continue;
    }

    // Already judged today (frozen, then possibly unfrozen by an admin). The verdict for
    // the day stands; re-running the sweep must not overturn it.
    if (await hasBeenJudgedToday(rider._id, now)) {
      summary.skippedAlreadyJudged += 1;
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

    // `freezeFineAmount` is already on the loaded document, so the no-show path costs no extra
    // query per rider — this loop runs over every rider in the company.
    const fineAmount = await issueLateStartFine({
      employeeId: rider._id,
      day: now,
      arrivedAt: null,
      source: 'sweep',
      amount: resolveFineAmount(rider.freezeFineAmount),
    });

    await freezeUser(rider._id, withFineNotice(lateStartReason(null), fineAmount));
    await raiseLateStartFlag({
      employeeId: rider._id,
      day: now,
      arrivedAt: null,
      assignedVisits,
      fineAmount,
    });
    summary.frozen += 1;
    if (fineAmount > 0) {
      summary.fined += 1;
      summary.finesTotal += fineAmount;
    }
  }

  return summary;
}
