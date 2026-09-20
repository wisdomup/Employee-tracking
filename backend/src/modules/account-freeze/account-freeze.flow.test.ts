/**
 * End-to-end integration test for the rider late-start freeze.
 *
 * Runs against a throwaway in-memory MongoDB (mongodb-memory-server), so it never touches
 * the real database. Exercises the actual service functions and asserts on what is really
 * persisted. Run with:
 *   npm run test:freeze:flow
 *
 * "Now" is injected everywhere the rule looks at the clock, so the whole suite is
 * deterministic regardless of what time of day it is actually run.
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { VisitModel } from '../../models/visit.model';
import { DealerModel } from '../../models/dealer.model';
import { ApprovalModel } from '../../models/approval.model';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import { RiderFineModel } from '../../models/rider-fine.model';
import { blockFrozenWrites } from '../../middleware/frozen.middleware';
import * as freezeService from './account-freeze.service';
import { FREEZE_TIMEZONE, configuredDeadline } from './account-freeze.rules';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

/** Asserts the promise rejects with a message matching `pattern`. */
async function rejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    assert.match((err as Error).message ?? String(err), pattern);
    return;
  }
  assert.fail(`Expected rejection matching ${pattern}, but it resolved`);
}

// --- Clock control ---------------------------------------------------------
// Instants are built for a fixed calendar day, in whatever zone the rule is configured
// for, so the suite behaves the same in CI at 3am as on a laptop at noon.
const TEST_DAY = { year: 2026, month: 8, day: 18 }; // a Tuesday

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/** The UTC instant at which the local wall clock in FREEZE_TIMEZONE reads `hh:mm` on `day`. */
function localTimeOn(day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(TEST_DAY.year, TEST_DAY.month - 1, day, hour, minute);
  const offset = zoneOffsetMinutes(new Date(naive), FREEZE_TIMEZONE);
  return new Date(naive - offset * 60_000);
}

/** Same, on the default (working-day) test date. */
function localTime(hour: number, minute: number): Date {
  return localTimeOn(TEST_DAY.day, hour, minute);
}

/** UTC midnight of the day an instant falls on — how the visit cron stamps `visitDate`. */
function utcMidnight(instant: Date): Date {
  const d = new Date(instant);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const deadline = configuredDeadline();
const BEFORE_DEADLINE = localTime(deadline.hour, Math.max(0, deadline.minute - 1));
const AFTER_DEADLINE = localTime(deadline.hour + 1, deadline.minute);
/** 2026-08-21 is a Friday — the company holiday, when nobody can be frozen. */
const FRIDAY_AFTER_DEADLINE = localTimeOn(21, deadline.hour + 1, deadline.minute);
const VISIT_DATE = utcMidnight(AFTER_DEADLINE);

let mongod: MongoMemoryServer;
let dealerId: Types.ObjectId;
let riderSeq = 0;

/** A fresh rider, so each test starts from a clean freeze state. */
async function makeRider(role = 'order_taker', overrides: Record<string, unknown> = {}) {
  riderSeq += 1;
  const id = new Types.ObjectId();
  await UserModel.create({
    _id: id,
    userID: `R-${String(riderSeq).padStart(3, '0')}`,
    username: `rider.${riderSeq}`,
    phone: `0300000${String(riderSeq).padStart(4, '0')}`,
    password: 'hashed',
    role,
    isActive: true,
    ...overrides,
  });
  return id;
}

/** An assigned (route) visit for the test day. */
async function assignVisit(employeeId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return VisitModel.create({
    dealerId,
    employeeId,
    visitDate: VISIT_DATE,
    status: 'todo',
    ...overrides,
  });
}

async function reload(id: Types.ObjectId) {
  return UserModel.findById(id).lean().exec();
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'account-freeze-flow-test' });
  // eslint-disable-next-line no-console
  console.log(`Connected to throwaway in-memory MongoDB (zone ${FREEZE_TIMEZONE})\n`);

  const dealer = await DealerModel.create({
    name: 'Test Shop',
    phone: '03001234567',
    latitude: 24.8607,
    longitude: 67.0011,
  });
  dealerId = dealer._id as Types.ObjectId;

  // -------------------------------------------------------------------------
  console.log('Check-in deadline guard');
  // -------------------------------------------------------------------------
  await test('a rider checking in before the deadline is not frozen', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: BEFORE_DEADLINE,
    });

    assert.equal(reason, null);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('a rider whose FIRST check-in is after the deadline is frozen and refused', async () => {
    const rider = await makeRider();
    const visit = await assignVisit(rider);

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
      visitId: visit._id as Types.ObjectId,
    });

    assert.ok(reason, 'expected a refusal reason');
    assert.match(reason!, /frozen/i);
    assert.match(reason!, /contact the admin/i);

    const after = await reload(rider);
    assert.equal(after?.isFrozen, true);
    assert.ok(after?.frozenAt instanceof Date);
    assert.equal(after?.frozenReason, reason);
    // Nobody pressed a button — an automatic freeze records no actor.
    assert.equal(after?.frozenBy, undefined);
  });

  await test('the refusal writes a late_start flag pointing at the visit', async () => {
    const rider = await makeRider();
    const visit = await assignVisit(rider);

    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
      visitId: visit._id as Types.ObjectId,
    });

    const flags = await PerformanceFlagModel.find({ employeeId: rider }).lean();
    assert.equal(flags.length, 1);
    assert.equal(flags[0].type, 'late_start');
    assert.equal(flags[0].resolved, false);
    assert.equal(String(flags[0].visitId), String(visit._id));
    // value = the minute they arrived, threshold = the minute they were due. Both local.
    assert.equal(flags[0].threshold, deadline.hour * 60 + deadline.minute);
    assert.ok((flags[0].value ?? 0) > (flags[0].threshold ?? 0));
    assert.match(flags[0].message, /past the .* deadline/i);
  });

  await test('a rider already checked in earlier today is untouched by a later check-in', async () => {
    const rider = await makeRider();
    await assignVisit(rider, {
      status: 'completed',
      checkedInAt: localTime(9, 0),
      completedAt: localTime(9, 20),
    });
    await assignVisit(rider);

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    // The rule judges the FIRST arrival only. Shop four at 4pm is a normal day's work.
    assert.equal(reason, null);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('a rider with NO assigned visits is still frozen — the empty-day escape hatch is gone', async () => {
    const rider = await makeRider();

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    // This is the regression that mattered: while the visit cron was idle every rider had
    // an empty day, so exempting empty days silently disabled the entire rule.
    assert.ok(reason, 'expected a refusal even with nothing assigned');
    assert.equal((await reload(rider))?.isFrozen, true);
  });

  await test('the flag for an empty day does not claim visits were assigned', async () => {
    const rider = await makeRider();
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    const flag = await PerformanceFlagModel.findOne({ employeeId: rider, type: 'late_start' }).lean();
    assert.doesNotMatch(flag!.message, /0 visit\(s\) assigned/);
  });

  await test('a rider with only self-started extras is still frozen', async () => {
    const rider = await makeRider();
    await assignVisit(rider, { isSelfInitiated: true });

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.ok(reason);
  });

  await test('a day of only cancelled visits is still frozen', async () => {
    const rider = await makeRider();
    await assignVisit(rider, { status: 'cancelled' });

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.ok(reason);
  });

  await test('the company holiday excuses everyone', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: FRIDAY_AFTER_DEADLINE,
    });

    assert.equal(reason, null);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('an approved leave excuses that rider for that day', async () => {
    const rider = await makeRider();
    await assignVisit(rider);
    await ApprovalModel.create({
      employeeId: rider,
      approvalType: 'leave',
      leaveType: 'full_day',
      status: 'approved',
      leaveDate: utcMidnight(AFTER_DEADLINE),
    });

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.equal(reason, null);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('a PENDING leave request does NOT excuse anyone', async () => {
    const rider = await makeRider();
    await ApprovalModel.create({
      employeeId: rider,
      approvalType: 'leave',
      status: 'pending',
      leaveDate: utcMidnight(AFTER_DEADLINE),
    });

    // Otherwise the freeze is avoidable by filing a request nobody ever approves.
    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.ok(reason);
  });

  await test("another rider's approved leave does not excuse this one", async () => {
    const rider = await makeRider();
    const colleague = await makeRider();
    await ApprovalModel.create({
      employeeId: colleague,
      approvalType: 'leave',
      status: 'approved',
      leaveDate: utcMidnight(AFTER_DEADLINE),
    });

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.ok(reason);
  });

  await test('roles outside the rule are never frozen, however late they are', async () => {
    for (const role of ['delivery_man', 'employee', 'warehouse_staff', 'admin']) {
      const rider = await makeRider(role);
      await assignVisit(rider);

      const reason = await freezeService.enforceFirstCheckInDeadline({
        employeeId: rider,
        role,
        now: AFTER_DEADLINE,
      });

      assert.equal(reason, null, `${role} should not be frozen`);
      assert.notEqual((await reload(rider))?.isFrozen, true);
    }
  });

  // -------------------------------------------------------------------------
  console.log('\nDaily sweep — the no-show case');
  // -------------------------------------------------------------------------
  await test('the sweep is a no-op before the deadline', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    const summary = await freezeService.sweepLateStarters(BEFORE_DEADLINE);

    assert.equal(summary.frozen, 0);
    assert.equal(summary.evaluated, 0);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the sweep freezes a rider who had visits and never checked in', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    const summary = await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.ok(summary.frozen >= 1);
    const after = await reload(rider);
    assert.equal(after?.isFrozen, true);
    assert.match(String(after?.frozenReason), /did not check in at any shop/i);

    const flag = await PerformanceFlagModel.findOne({ employeeId: rider, type: 'late_start' }).lean();
    assert.ok(flag);
    assert.match(flag!.message, /No shop check-in/i);
    // Never arrived, so there is no arrival minute to record.
    assert.equal(flag!.value, undefined);
    assert.equal((flag!.meta as { neverArrived?: boolean })?.neverArrived, true);
  });

  await test('the sweep skips a rider who started on time', async () => {
    const rider = await makeRider();
    await assignVisit(rider, { status: 'checked_in', checkedInAt: localTime(9, 15) });

    await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the sweep FREEZES a rider with an empty day, and counts it', async () => {
    const rider = await makeRider();

    const summary = await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.equal((await reload(rider))?.isFrozen, true);
    // Counted, not skipped — a rising number here means the visit cron has gone idle.
    assert.ok(summary.frozenWithNoAssignedVisits >= 1);
  });

  await test('the sweep is a no-op on the company holiday', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    const summary = await freezeService.sweepLateStarters(FRIDAY_AFTER_DEADLINE);

    assert.equal(summary.frozen, 0);
    assert.equal(summary.evaluated, 0);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the sweep skips a rider on approved leave', async () => {
    const rider = await makeRider();
    await ApprovalModel.create({
      employeeId: rider,
      approvalType: 'leave',
      status: 'approved',
      leaveDate: utcMidnight(AFTER_DEADLINE),
    });

    const summary = await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.ok(summary.skippedExempt >= 1);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the sweep skips a trashed rider', async () => {
    const rider = await makeRider('order_taker', { isTrashed: true });
    await assignVisit(rider);

    await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the sweep skips a deactivated rider', async () => {
    const rider = await makeRider('order_taker', { isActive: false });
    await assignVisit(rider);

    await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('re-running the sweep does not move the original freeze time', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    await freezeService.sweepLateStarters(AFTER_DEADLINE);
    const firstFreeze = (await reload(rider))?.frozenAt;

    const second = await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.ok(second.skippedAlreadyFrozen >= 1);
    assert.equal(String((await reload(rider))?.frozenAt), String(firstFreeze));
    // And still exactly one flag for the day, not one per sweep.
    assert.equal(await PerformanceFlagModel.countDocuments({ employeeId: rider }), 1);
  });

  // -------------------------------------------------------------------------
  console.log('\nUnfreezing');
  // -------------------------------------------------------------------------
  await test('an admin unfreeze clears the lock and records who did it', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await assignVisit(rider);
    await freezeService.sweepLateStarters(AFTER_DEADLINE);

    const updated = await freezeService.unfreezeUser(String(rider), String(admin), 'Bike broke down');

    assert.equal(updated.isFrozen, false);
    const after = await reload(rider);
    assert.equal(after?.isFrozen, false);
    assert.equal(String(after?.unfrozenBy), String(admin));
    assert.ok(after?.unfrozenAt instanceof Date);
    // The reason survives, so a repeat offender's history is still readable.
    assert.match(String(after?.frozenReason), /frozen/i);
  });

  await test('unfreezing an account that is not frozen is refused', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');

    await rejectsWith(
      freezeService.unfreezeUser(String(rider), String(admin)),
      /not frozen/i,
    );
  });

  await test('unfreezing an unknown user is a 404, not a silent success', async () => {
    const admin = await makeRider('admin');
    await rejectsWith(
      freezeService.unfreezeUser(String(new Types.ObjectId()), String(admin)),
      /not found/i,
    );
  });

  await test('an unfrozen rider can be frozen again the next time they are late', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await assignVisit(rider);

    await freezeService.sweepLateStarters(AFTER_DEADLINE);
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);
    assert.notEqual((await reload(rider))?.isFrozen, true);

    await freezeService.freezeUser(rider, 'Late again');

    const after = await reload(rider);
    assert.equal(after?.isFrozen, true);
    // The stale unfreeze stamps are cleared, so the record reads as currently frozen.
    assert.equal(after?.unfrozenAt, undefined);
    assert.equal(after?.unfrozenBy, undefined);
  });


  // -------------------------------------------------------------------------
  console.log('\nThe pardon — an unfreeze must survive the rest of the day');
  // -------------------------------------------------------------------------
  await test('unfreezing records a pardon for that day', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await assignVisit(rider);
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);

    const after = await reload(rider);
    assert.equal(after?.isFrozen, false);
    assert.ok(after?.freezePardonedFor, 'expected a pardon date');
  });

  await test('after an unfreeze the guard does NOT re-freeze on the next check-in', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await assignVisit(rider);

    // Late, frozen, refused.
    const refusal = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });
    assert.ok(refusal);

    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);

    // The rider is STILL past the deadline with STILL no check-in — the exact state that
    // froze them. Without the pardon this call re-freezes them and the unfreeze is useless.
    const second = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.equal(second, null, 'a pardoned rider must be allowed to check in');
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('a pardoned rider survives repeated check-ins all day', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await assignVisit(rider);
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);

    for (const hour of [14, 16, 18]) {
      const result = await freezeService.enforceFirstCheckInDeadline({
        employeeId: rider,
        role: 'order_taker',
        now: localTime(hour, 0),
      });
      assert.equal(result, null, `check-in at ${hour}:00 should be allowed`);
    }
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the sweep does NOT re-freeze a rider pardoned today', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await assignVisit(rider);
    await freezeService.sweepLateStarters(AFTER_DEADLINE);
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);

    // The admin hitting "Run late-start check now" must not undo their own unfreeze.
    const summary = await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.ok(summary.skippedPardoned >= 1);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the pardon expires — the SAME rider is frozen again the next day', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await assignVisit(rider);
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);

    // Same offence, one day later. The pardon forgave a day, not the rider.
    const nextDay = localTimeOn(TEST_DAY.day + 1, deadline.hour + 1, deadline.minute);
    const refusal = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: nextDay,
    });

    assert.ok(refusal, 'expected the rider to be frozen again the next day');
    assert.equal((await reload(rider))?.isFrozen, true);
  });

  await test('a re-freeze clears the spent pardon', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);
    assert.ok((await reload(rider))?.freezePardonedFor);

    await freezeService.freezeUser(rider, 'Late again');

    assert.equal((await reload(rider))?.freezePardonedFor, undefined);
  });

  await test('the admin can unfreeze again the next day, and the cycle repeats', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    const day2 = localTimeOn(TEST_DAY.day + 1, deadline.hour + 1, deadline.minute);

    // Day 1: late, frozen, unfrozen, works.
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);
    assert.equal(
      await freezeService.enforceFirstCheckInDeadline({
        employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
      }),
      null,
    );

    // Day 2: late again, frozen again.
    assert.ok(
      await freezeService.enforceFirstCheckInDeadline({
        employeeId: rider, role: 'order_taker', now: day2,
      }),
    );

    // Day 2: unfrozen again, works again. The pardon must be stamped with DAY 2 — a day-1
    // pardon would not cover today, and the rider would be re-frozen on their next action.
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, day2);
    assert.equal(
      await freezeService.enforceFirstCheckInDeadline({
        employeeId: rider, role: 'order_taker', now: day2,
      }),
      null,
    );
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test("one rider's pardon does not cover a colleague", async () => {
    const rider = await makeRider();
    const colleague = await makeRider();
    const admin = await makeRider('admin');
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);

    const refusal = await freezeService.enforceFirstCheckInDeadline({
      employeeId: colleague,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.ok(refusal);
  });

  await test('getFreezeStatus reports the pardon so the rider knows they are clear', async () => {
    const rider = await makeRider();
    const admin = await makeRider('admin');
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await freezeService.unfreezeUser(String(rider), String(admin), undefined, AFTER_DEADLINE);

    const status = await freezeService.getFreezeStatus(String(rider), AFTER_DEADLINE);

    assert.equal(status.isFrozen, false);
    assert.equal(status.pardonedToday, true);
  });

  await test('a rider is judged ONCE a day — later visits are never re-checked', async () => {
    const rider = await makeRider();
    await assignVisit(rider);
    await assignVisit(rider);
    await assignVisit(rider);

    // Shop 1: late, frozen, refused.
    assert.ok(
      await freezeService.enforceFirstCheckInDeadline({
        employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
      }),
    );

    // Admin lifts it, but the pardon field is wiped by hand — simulating any reason the
    // pardon date could fail to line up (a day-boundary edge, an older record, a manual
    // database fix). The "already judged" rule must hold the line on its own.
    await UserModel.updateOne(
      { _id: rider },
      { $set: { isFrozen: false }, $unset: { freezePardonedFor: 1 } },
    );

    // Shops 2 and 3 must go through regardless.
    for (const label of ['shop 2', 'shop 3']) {
      const result = await freezeService.enforceFirstCheckInDeadline({
        employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
      });
      assert.equal(result, null, `${label} must not re-freeze`);
    }
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('the sweep also respects a verdict already reached today', async () => {
    const rider = await makeRider();
    await assignVisit(rider);
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await UserModel.updateOne(
      { _id: rider },
      { $set: { isFrozen: false }, $unset: { freezePardonedFor: 1 } },
    );

    const summary = await freezeService.sweepLateStarters(AFTER_DEADLINE);

    assert.ok(summary.skippedAlreadyJudged >= 1);
    assert.notEqual((await reload(rider))?.isFrozen, true);
  });

  await test('being judged today does NOT carry over to tomorrow', async () => {
    const rider = await makeRider();
    await assignVisit(rider);
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: AFTER_DEADLINE,
    });
    await UserModel.updateOne(
      { _id: rider },
      { $set: { isFrozen: false }, $unset: { freezePardonedFor: 1 } },
    );

    const nextDay = localTimeOn(TEST_DAY.day + 1, deadline.hour + 1, deadline.minute);
    const refusal = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider, role: 'order_taker', now: nextDay,
    });

    assert.ok(refusal, 'a new day gets a fresh verdict');
  });

  await test('the frozen list is what the admin queue reads', async () => {
    const rider = await makeRider();
    await assignVisit(rider);
    await freezeService.sweepLateStarters(AFTER_DEADLINE);

    const frozen = await freezeService.findFrozenUsers();

    // Containment rather than an exact count: a sweep now freezes every eligible rider
    // left over from earlier cases, so the total is not a fixed number.
    assert.ok(frozen.some((u) => String(u._id) === String(rider)));
    assert.ok(frozen.every((u) => u.isFrozen === true));
    // Passwords never leave the service, even to an admin.
    assert.ok(frozen.every((u) => (u as unknown as { password?: string }).password === undefined));
  });

  await test('getFreezeStatus tells a rider why they are locked out', async () => {
    const rider = await makeRider();
    await assignVisit(rider);
    await freezeService.sweepLateStarters(AFTER_DEADLINE);

    const status = await freezeService.getFreezeStatus(String(rider), AFTER_DEADLINE);

    assert.equal(status.isFrozen, true);
    assert.equal(status.subjectToRule, true);
    assert.match(String(status.frozenReason), /contact the admin/i);
    assert.match(status.deadline, /\d{1,2}:\d{2} (AM|PM)/);
  });

  await test('getFreezeStatus marks non-rider roles as outside the rule', async () => {
    const manager = await makeRider('sales_manager');
    const status = await freezeService.getFreezeStatus(String(manager));

    assert.equal(status.isFrozen, false);
    assert.equal(status.subjectToRule, false);
  });

  // -------------------------------------------------------------------------
  console.log('\nWrite block');
  // -------------------------------------------------------------------------
  function runMiddleware(user: Record<string, unknown> | undefined, method: string) {
    let error: Error | undefined;
    let calledNext = false;
    blockFrozenWrites(
      { method, user } as never,
      {} as never,
      ((err?: Error) => {
        calledNext = true;
        error = err;
      }) as never,
    );
    return { calledNext, error };
  }

  await test('a frozen rider may still READ — that is how they learn why', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { calledNext, error } = runMiddleware({ isFrozen: true, frozenReason: 'r' }, method);
      assert.equal(calledNext, true);
      assert.equal(error, undefined, `${method} should pass`);
    }
  });

  await test('a frozen rider cannot write, and is told the stored reason', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { error } = runMiddleware(
        { isFrozen: true, frozenReason: 'You did not check in at any shop by 12:30 PM.' },
        method,
      );
      assert.ok(error, `${method} should be blocked`);
      assert.match(error!.message, /did not check in/i);
      // 403, not 401 — a 401 would log them straight back out of the admin app.
      assert.equal((error as unknown as { statusCode: number }).statusCode, 403);
    }
  });

  await test('a frozen account with no stored reason still gets a usable message', async () => {
    const { error } = runMiddleware({ isFrozen: true }, 'POST');
    assert.match(error!.message, /contact the admin/i);
  });

  await test('an unfrozen user writes normally', async () => {
    const { error } = runMiddleware({ isFrozen: false }, 'POST');
    assert.equal(error, undefined);
  });

  // -------------------------------------------------------------------------
  console.log('\nThe late-start fine');
  // -------------------------------------------------------------------------
  const ADMIN_ID = new Types.ObjectId().toString();

  /** Today's fine row for a rider, whatever its status. */
  async function fineFor(employeeId: Types.ObjectId, day: Date = AFTER_DEADLINE) {
    return RiderFineModel.findOne({ employeeId, fineDate: utcMidnight(day) }).lean().exec();
  }

  await test('a freeze at check-in raises a Rs. 200 fine and says so in the refusal', async () => {
    const rider = await makeRider();
    const visit = await assignVisit(rider);

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
      visitId: visit._id as Types.ObjectId,
    });

    // The rider is told the amount in the same breath as the refusal — this message is the
    // only thing some riders will ever read about the fine.
    assert.match(reason!, /Rs\. 200/);

    const fine = await fineFor(rider);
    assert.ok(fine, 'expected a fine to be raised');
    assert.equal(fine!.amount, 200);
    assert.equal(fine!.status, 'outstanding');
    assert.equal(fine!.source, 'check_in_guard');
    assert.equal(fine!.originalAmount, 200);
    // And it is on the user's stored reason too, so the write-block message carries it.
    assert.match((await reload(rider))!.frozenReason!, /Rs\. 200/);
  });

  await test('the flag the admin reads names the fine', async () => {
    const rider = await makeRider();
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    const flag = await PerformanceFlagModel.findOne({ employeeId: rider }).lean();
    assert.match(flag!.message, /Rs\. 200 fine/);
    assert.equal((flag!.meta as { fineAmount?: number })?.fineAmount, 200);
  });

  await test('a no-show caught by the sweep is fined the same way', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    const summary = await freezeService.sweepLateStarters(AFTER_DEADLINE);
    assert.ok(summary.fined >= 1);
    assert.ok(summary.finesTotal >= 200);

    const fine = await fineFor(rider);
    assert.equal(fine!.amount, 200);
    assert.equal(fine!.source, 'sweep');
  });

  await test('one offence, one fine — a re-run of the sweep does not charge twice', async () => {
    const rider = await makeRider();
    await assignVisit(rider);

    // The "Run late-start check now" button is easy to press twice.
    await freezeService.sweepLateStarters(AFTER_DEADLINE);
    await freezeService.sweepLateStarters(AFTER_DEADLINE);
    await freezeService.issueLateStartFine({
      employeeId: rider,
      day: AFTER_DEADLINE,
      arrivedAt: null,
      source: 'sweep',
    });

    const fines = await RiderFineModel.find({ employeeId: rider }).lean();
    assert.equal(fines.length, 1);
  });

  await test("a rider's own amount is charged instead of the company default", async () => {
    const rider = await makeRider('order_taker', { freezeFineAmount: 500 });

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.match(reason!, /Rs\. 500/);
    assert.equal((await fineFor(rider))!.amount, 500);
  });

  await test('an amount of 0 freezes the rider without fining them', async () => {
    const rider = await makeRider('order_taker', { freezeFineAmount: 0 });

    const reason = await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    assert.equal((await reload(rider))?.isFrozen, true);
    // No money mentioned, and no misleading Rs. 0 row in their history.
    assert.doesNotMatch(reason!, /Rs\./);
    assert.equal(await fineFor(rider), null);
  });

  await test("setting a rider's amount re-prices the fine already raised today", async () => {
    const rider = await makeRider();
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    const result = await freezeService.setRiderFineAmount(rider.toString(), 350, ADMIN_ID, AFTER_DEADLINE);

    assert.equal(result.fineAmount, 350);
    assert.equal(result.hasCustomFineAmount, true);
    // The admin is looking AT this freeze when they change the number; leaving today's fine
    // at 200 is not what anybody means by "change his fine".
    assert.equal(result.todayFineUpdated, true);

    const fine = await fineFor(rider);
    assert.equal(fine!.amount, 350);
    // …and what it was first raised at is still on the record.
    assert.equal(fine!.originalAmount, 200);
    assert.equal(String(fine!.amountChangedBy), ADMIN_ID);
  });

  await test('clearing the amount hands the rider back to the company default', async () => {
    const rider = await makeRider('order_taker', { freezeFineAmount: 500 });

    const result = await freezeService.setRiderFineAmount(rider.toString(), null, ADMIN_ID, AFTER_DEADLINE);

    assert.equal(result.fineAmount, 200);
    assert.equal(result.hasCustomFineAmount, false);
    // Absent, not 200: a later change to the company default must still reach this rider.
    assert.equal((await reload(rider))?.freezeFineAmount, undefined);
  });

  await test('a nonsense amount is refused rather than rounded or clamped', async () => {
    const rider = await makeRider();
    await rejectsWith(freezeService.setRiderFineAmount(rider.toString(), -100, ADMIN_ID), /negative/);
    await rejectsWith(freezeService.setRiderFineAmount(rider.toString(), 99.5, ADMIN_ID), /whole number/);
    await rejectsWith(freezeService.setRiderFineAmount('not-an-id', 100, ADMIN_ID), /Invalid user id/);
  });

  await test('waiving a fine keeps the row and leaves the freeze alone', async () => {
    const rider = await makeRider();
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });
    const raised = await fineFor(rider);

    await freezeService.waiveFine(String(raised!._id), ADMIN_ID, 'Bike broke down');

    const after = await fineFor(rider);
    assert.equal(after!.status, 'waived');
    assert.equal(after!.amount, 200, 'the amount stays on the record');
    assert.equal(after!.waiveNote, 'Bike broke down');
    // Waiving is not unfreezing — two separate judgements, two separate buttons.
    assert.equal((await reload(rider))?.isFrozen, true);

    await rejectsWith(
      freezeService.waiveFine(String(raised!._id), ADMIN_ID),
      /already been waived/,
    );
  });

  await test('re-pricing never un-forgives a waived fine', async () => {
    const rider = await makeRider();
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });
    const raised = await fineFor(rider);
    await freezeService.waiveFine(String(raised!._id), ADMIN_ID);

    const result = await freezeService.setRiderFineAmount(rider.toString(), 800, ADMIN_ID, AFTER_DEADLINE);

    assert.equal(result.todayFineUpdated, false);
    const after = await fineFor(rider);
    assert.equal(after!.status, 'waived');
    assert.equal(after!.amount, 200);
  });

  await test('an unfreeze does not cancel the fine', async () => {
    const rider = await makeRider();
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    await freezeService.unfreezeUser(rider.toString(), ADMIN_ID, undefined, AFTER_DEADLINE);

    // Letting a rider work again is not the same as forgiving the offence; the admin has a
    // separate waive for that.
    assert.equal((await fineFor(rider))!.status, 'outstanding');
  });

  await test("getFreezeStatus tells the rider the amount and what they still owe", async () => {
    const rider = await makeRider();
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    const status = await freezeService.getFreezeStatus(rider.toString(), AFTER_DEADLINE);

    assert.equal(status.fineAmount, 200);
    assert.equal(status.todayFine?.amount, 200);
    assert.equal(status.todayFine?.status, 'outstanding');
    assert.equal(status.outstandingFines, 200);
    assert.equal(status.outstandingFineCount, 1);
  });

  await test('a rider who has never been fined sees the amount, not a total', async () => {
    const rider = await makeRider();

    const status = await freezeService.getFreezeStatus(rider.toString(), AFTER_DEADLINE);

    // Shown on a clear day too: a penalty nobody knows about deters nothing.
    assert.equal(status.fineAmount, 200);
    assert.equal(status.todayFine, null);
    assert.equal(status.outstandingFines, 0);
  });

  await test("outstanding adds up across days, so yesterday's fine is not forgotten", async () => {
    const rider = await makeRider();
    const yesterday = localTimeOn(TEST_DAY.day - 1, deadline.hour + 1, deadline.minute);

    await freezeService.issueLateStartFine({
      employeeId: rider,
      day: yesterday,
      arrivedAt: null,
      source: 'sweep',
    });
    await freezeService.issueLateStartFine({
      employeeId: rider,
      day: AFTER_DEADLINE,
      arrivedAt: null,
      source: 'sweep',
    });

    const status = await freezeService.getFreezeStatus(rider.toString(), AFTER_DEADLINE);
    assert.equal(status.outstandingFineCount, 2);
    assert.equal(status.outstandingFines, 400);

    const history = await freezeService.listRiderFines(rider.toString());
    assert.equal(history.length, 2);
    // Newest first — the disputed fine is the one they are looking for.
    assert.ok(history[0].fineDate.getTime() > history[1].fineDate.getTime());
  });

  await test('the admin queue carries the money beside each frozen rider', async () => {
    const rider = await makeRider('order_taker', { freezeFineAmount: 300 });
    await freezeService.enforceFirstCheckInDeadline({
      employeeId: rider,
      role: 'order_taker',
      now: AFTER_DEADLINE,
    });

    const rows = await freezeService.findFrozenUsers(AFTER_DEADLINE);
    const row = rows.find((r) => String(r._id) === String(rider));

    assert.ok(row, 'the frozen rider should be in the queue');
    assert.equal(row!.fineAmount, 300);
    assert.equal(row!.hasCustomFineAmount, true);
    assert.equal(row!.todayFine?.amount, 300);
    assert.equal(row!.outstandingFines, 300);
  });

  await test('the admin banner counts the freezes and the rupees behind them', async () => {
    const overview = await freezeService.getFineOverview(AFTER_DEADLINE);

    assert.equal(overview.defaultFineAmount, 200);
    assert.ok(overview.frozenCount > 0);
    assert.ok(overview.finedToday > 0);
    // Whatever earlier tests raised, the total must be the sum of what is outstanding today,
    // never a count dressed up as money.
    const expected = await RiderFineModel.aggregate<{ total: number }>([
      { $match: { fineDate: utcMidnight(AFTER_DEADLINE), status: 'outstanding' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    assert.equal(overview.finesTodayTotal, expected[0]?.total ?? 0);
    assert.ok(overview.outstandingTotal >= overview.finesTodayTotal);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} account-freeze integration tests passed.`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('\n✗ FAILED:', err);
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(1);
  });
