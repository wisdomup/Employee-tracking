/**
 * Unit tests for the pure late-start freeze rules.
 *
 * No test framework is configured in this project, so this runs as a plain ts-node
 * script using Node's built-in `assert`. Run with:
 *   npm run test:freeze
 * It exits non-zero on the first failed assertion.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_FIRST_VISIT_DEADLINE,
  FREEZE_ELIGIBLE_ROLES,
  formatDeadline,
  formatWallClock,
  isPastDeadline,
  lateStartFlagMessage,
  lateStartReason,
  minuteOfDayInZone,
  minutesSinceMidnight,
  parseTimeOfDay,
  wallClockInZone,
} from './account-freeze.rules';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

const KARACHI = 'Asia/Karachi'; // UTC+5, no DST
const DEADLINE = parseTimeOfDay(DEFAULT_FIRST_VISIT_DEADLINE); // 12:30

/** A UTC instant that is `hh:mm` local time in Karachi on 2026-08-18. */
function karachiInstant(hour: number, minute: number, second = 0): Date {
  return new Date(Date.UTC(2026, 7, 18, hour - 5, minute, second));
}

// ---------------------------------------------------------------------------
// parseTimeOfDay
// ---------------------------------------------------------------------------
test('parseTimeOfDay: reads the default 12:30 deadline', () => {
  assert.deepEqual(parseTimeOfDay('12:30'), { hour: 12, minute: 30 });
});

test('parseTimeOfDay: accepts a single-digit hour', () => {
  assert.deepEqual(parseTimeOfDay('9:05'), { hour: 9, minute: 5 });
});

test('parseTimeOfDay: accepts midnight and the last minute of the day', () => {
  assert.deepEqual(parseTimeOfDay('00:00'), { hour: 0, minute: 0 });
  assert.deepEqual(parseTimeOfDay('23:59'), { hour: 23, minute: 59 });
});

test('parseTimeOfDay: rejects nonsense rather than defaulting silently', () => {
  // A typo in the env var must fail loudly, not freeze everyone at 00:00.
  for (const bad of ['', 'noon', '12', '12:', '12:3', '1230', '12:30pm', '-1:00']) {
    assert.throws(() => parseTimeOfDay(bad), /Invalid time/, `expected "${bad}" to throw`);
  }
});

test('parseTimeOfDay: rejects out-of-range hours and minutes', () => {
  assert.throws(() => parseTimeOfDay('24:00'), /hour must be 0-23/);
  assert.throws(() => parseTimeOfDay('12:60'), /minute 0-59/);
});

// ---------------------------------------------------------------------------
// minutesSinceMidnight
// ---------------------------------------------------------------------------
test('minutesSinceMidnight: 12:30 is minute 750', () => {
  assert.equal(minutesSinceMidnight(DEADLINE), 750);
});

test('minutesSinceMidnight: midnight is 0', () => {
  assert.equal(minutesSinceMidnight({ hour: 0, minute: 0 }), 0);
});

// ---------------------------------------------------------------------------
// wallClockInZone / minuteOfDayInZone
// ---------------------------------------------------------------------------
test('wallClockInZone: 07:30 UTC is 12:30 in Karachi', () => {
  assert.deepEqual(
    wallClockInZone(new Date(Date.UTC(2026, 7, 18, 7, 30)), KARACHI),
    { hour: 12, minute: 30 },
  );
});

test('wallClockInZone: the same instant is 07:30 in UTC', () => {
  assert.deepEqual(
    wallClockInZone(new Date(Date.UTC(2026, 7, 18, 7, 30)), 'UTC'),
    { hour: 7, minute: 30 },
  );
});

test('wallClockInZone: local midnight reads as hour 0, not 24', () => {
  // Some runtimes report hour 24 for midnight under hour12:false.
  assert.deepEqual(wallClockInZone(karachiInstant(0, 0), KARACHI), { hour: 0, minute: 0 });
});

test('minuteOfDayInZone: matches the wall clock reading', () => {
  assert.equal(minuteOfDayInZone(karachiInstant(12, 30), KARACHI), 750);
  assert.equal(minuteOfDayInZone(karachiInstant(13, 32), KARACHI), 812);
});

// ---------------------------------------------------------------------------
// isPastDeadline — the boundary is the whole point
// ---------------------------------------------------------------------------
test('isPastDeadline: 12:29 local is on time', () => {
  assert.equal(isPastDeadline(karachiInstant(12, 29), DEADLINE, KARACHI), false);
});

test('isPastDeadline: exactly 12:30:00 passes — "by 12:30" includes 12:30', () => {
  assert.equal(isPastDeadline(karachiInstant(12, 30), DEADLINE, KARACHI), false);
});

test('isPastDeadline: 12:30:59 still passes — seconds do not make a rider late', () => {
  assert.equal(isPastDeadline(karachiInstant(12, 30, 59), DEADLINE, KARACHI), false);
});

test('isPastDeadline: 12:31 local is late', () => {
  assert.equal(isPastDeadline(karachiInstant(12, 31), DEADLINE, KARACHI), true);
});

test('isPastDeadline: early morning is never late', () => {
  assert.equal(isPastDeadline(karachiInstant(6, 0), DEADLINE, KARACHI), false);
  assert.equal(isPastDeadline(karachiInstant(0, 0), DEADLINE, KARACHI), false);
});

test('isPastDeadline: the zone actually matters', () => {
  // 09:00 UTC is 14:00 in Karachi — late there, on time if you (wrongly) compared in UTC.
  const instant = new Date(Date.UTC(2026, 7, 18, 9, 0));
  assert.equal(isPastDeadline(instant, DEADLINE, KARACHI), true);
  assert.equal(isPastDeadline(instant, DEADLINE, 'UTC'), false);
});

test('isPastDeadline: a custom deadline is honoured', () => {
  const nine = parseTimeOfDay('09:00');
  assert.equal(isPastDeadline(karachiInstant(9, 30), nine, KARACHI), true);
  assert.equal(isPastDeadline(karachiInstant(9, 30), DEADLINE, KARACHI), false);
});

// ---------------------------------------------------------------------------
// Formatting — these strings are read by riders, so they must be right
// ---------------------------------------------------------------------------
test('formatDeadline: 12:30 renders as 12:30 PM, not 0:30 PM', () => {
  assert.equal(formatDeadline(DEADLINE), '12:30 PM');
});

test('formatDeadline: midnight and noon do not collapse to 0', () => {
  assert.equal(formatDeadline({ hour: 0, minute: 0 }), '12:00 AM');
  assert.equal(formatDeadline({ hour: 12, minute: 0 }), '12:00 PM');
});

test('formatDeadline: morning and evening carry the right suffix', () => {
  assert.equal(formatDeadline({ hour: 9, minute: 5 }), '9:05 AM');
  assert.equal(formatDeadline({ hour: 17, minute: 45 }), '5:45 PM');
});

test('formatWallClock: renders the local time of an instant', () => {
  assert.equal(formatWallClock(karachiInstant(13, 32), KARACHI), '1:32 PM');
  assert.equal(formatWallClock(karachiInstant(8, 5), KARACHI), '8:05 AM');
});

test('lateStartReason: a late arrival names the time and the deadline', () => {
  const reason = lateStartReason(karachiInstant(13, 32), DEADLINE, KARACHI);
  assert.match(reason, /1:32 PM/);
  assert.match(reason, /12:30 PM/);
  assert.match(reason, /contact the admin/i);
});

test('lateStartReason: a no-show reads differently from a late arrival', () => {
  const noShow = lateStartReason(null, DEADLINE, KARACHI);
  assert.match(noShow, /did not check in at any shop/i);
  assert.doesNotMatch(noShow, /Your first shop visit was at/);
});

test('lateStartFlagMessage: the no-show variant reports the assigned count', () => {
  assert.match(lateStartFlagMessage(null, 7, DEADLINE, KARACHI), /7 visit\(s\) assigned/);
});

test('lateStartFlagMessage: the late variant reports the arrival time', () => {
  const msg = lateStartFlagMessage(karachiInstant(13, 32), 7, DEADLINE, KARACHI);
  assert.match(msg, /First shop check-in at 1:32 PM/);
  assert.match(msg, /Account frozen/);
});

// ---------------------------------------------------------------------------
// Scope of the rule
// ---------------------------------------------------------------------------
test('FREEZE_ELIGIBLE_ROLES: order takers only', () => {
  assert.deepEqual([...FREEZE_ELIGIBLE_ROLES], ['order_taker']);
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} account-freeze rule tests passed.`);
