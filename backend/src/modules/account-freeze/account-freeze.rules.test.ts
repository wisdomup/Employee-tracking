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
  NON_WORKING_WEEKDAY,
  isNonWorkingDay,
  weekdayInZone,
  formatDeadline,
  formatWallClock,
  isPastDeadline,
  lateStartFlagMessage,
  lateStartReason,
  minuteOfDayInZone,
  minutesSinceMidnight,
  parseTimeOfDay,
  wallClockInZone,
  DEFAULT_FREEZE_FINE_AMOUNT,
  MAX_FREEZE_FINE_AMOUNT,
  configuredFineAmount,
  fineNotice,
  formatFine,
  lateStartFineReason,
  parseFineAmount,
  resolveFineAmount,
  withFineNotice,
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
// The company holiday
// ---------------------------------------------------------------------------
test('weekdayInZone: reads the local weekday, 0 = Sunday', () => {
  // 2026-08-16 is a Sunday, 2026-08-21 a Friday.
  assert.equal(weekdayInZone(new Date(Date.UTC(2026, 7, 16, 6, 0)), KARACHI), 0);
  assert.equal(weekdayInZone(new Date(Date.UTC(2026, 7, 21, 6, 0)), KARACHI), 5);
});

test('isNonWorkingDay: Friday is the company holiday, other days are not', () => {
  assert.equal(isNonWorkingDay(new Date(Date.UTC(2026, 7, 21, 6, 0)), KARACHI), true);
  for (const day of [16, 17, 18, 19, 20, 22]) {
    assert.equal(
      isNonWorkingDay(new Date(Date.UTC(2026, 7, day, 6, 0)), KARACHI),
      false,
      `2026-08-${day} should be a working day`,
    );
  }
});

test('isNonWorkingDay: the weekday is judged in the local zone, not UTC', () => {
  // 2026-08-20 21:00 UTC is still Thursday in UTC but already Friday 02:00 in Karachi.
  const instant = new Date(Date.UTC(2026, 7, 20, 21, 0));
  assert.equal(isNonWorkingDay(instant, 'UTC'), false);
  assert.equal(isNonWorkingDay(instant, KARACHI), true);
});

test('NON_WORKING_WEEKDAY matches the day the visit cron omits', () => {
  assert.equal(NON_WORKING_WEEKDAY, 5);
});

// ---------------------------------------------------------------------------
// Flag wording
// ---------------------------------------------------------------------------
test('lateStartFlagMessage: an empty day does not claim "0 visit(s) assigned"', () => {
  const msg = lateStartFlagMessage(null, 0, DEADLINE, KARACHI);
  assert.doesNotMatch(msg, /0 visit/);
  assert.match(msg, /No shop check-in by 12:30 PM\. Account frozen\./);
});

// ---------------------------------------------------------------------------
// Scope of the rule
// ---------------------------------------------------------------------------
test('FREEZE_ELIGIBLE_ROLES: order takers only', () => {
  assert.deepEqual([...FREEZE_ELIGIBLE_ROLES], ['order_taker']);
});

// ---------------------------------------------------------------------------
// The late-start fine
// ---------------------------------------------------------------------------
test('DEFAULT_FREEZE_FINE_AMOUNT is the agreed 200', () => {
  assert.equal(DEFAULT_FREEZE_FINE_AMOUNT, 200);
});

test('parseFineAmount: accepts whole rupees, including zero', () => {
  assert.equal(parseFineAmount(200), 200);
  assert.equal(parseFineAmount('350'), 350);
  // Zero is a real setting — frozen, not fined — and must not be rejected as "empty".
  assert.equal(parseFineAmount(0), 0);
});

test('parseFineAmount: rejects negatives, fractions and nonsense', () => {
  assert.throws(() => parseFineAmount(-50), /negative/);
  assert.throws(() => parseFineAmount(199.5), /whole number/);
  assert.throws(() => parseFineAmount('abc'), /number/);
  assert.throws(() => parseFineAmount(null), /number/);
});

test('parseFineAmount: refuses an amount past the typo cap', () => {
  // `20000` typed for `200.00` is the slip this guards; a fine 100x out is worse than a
  // refused edit.
  assert.throws(() => parseFineAmount(MAX_FREEZE_FINE_AMOUNT + 1), /exceed/);
  assert.equal(parseFineAmount(MAX_FREEZE_FINE_AMOUNT), MAX_FREEZE_FINE_AMOUNT);
});

test('configuredFineAmount: env overrides the default', () => {
  const previous = process.env.RIDER_FREEZE_FINE_AMOUNT;
  try {
    process.env.RIDER_FREEZE_FINE_AMOUNT = '500';
    assert.equal(configuredFineAmount(), 500);
    delete process.env.RIDER_FREEZE_FINE_AMOUNT;
    assert.equal(configuredFineAmount(), DEFAULT_FREEZE_FINE_AMOUNT);
  } finally {
    if (previous === undefined) delete process.env.RIDER_FREEZE_FINE_AMOUNT;
    else process.env.RIDER_FREEZE_FINE_AMOUNT = previous;
  }
});

test('configuredFineAmount: a bad env value falls back instead of crashing the app', () => {
  const previous = process.env.RIDER_FREEZE_FINE_AMOUNT;
  try {
    process.env.RIDER_FREEZE_FINE_AMOUNT = 'two hundred';
    assert.equal(configuredFineAmount(), DEFAULT_FREEZE_FINE_AMOUNT);
  } finally {
    if (previous === undefined) delete process.env.RIDER_FREEZE_FINE_AMOUNT;
    else process.env.RIDER_FREEZE_FINE_AMOUNT = previous;
  }
});

test('resolveFineAmount: a rider override wins, absent falls back to the default', () => {
  assert.equal(resolveFineAmount(500), 500);
  assert.equal(resolveFineAmount(undefined), DEFAULT_FREEZE_FINE_AMOUNT);
  assert.equal(resolveFineAmount(null), DEFAULT_FREEZE_FINE_AMOUNT);
});

test('resolveFineAmount: an override of 0 is honoured, not read as "unset"', () => {
  // The whole reason `freezeFineAmount` has no schema default: 0 must mean "do not fine
  // this rider", and collapsing it into absent would silently charge them 200.
  assert.equal(resolveFineAmount(0), 0);
});

test('formatFine: rupees with separators, no decimals', () => {
  assert.equal(formatFine(200), 'Rs. 200');
  assert.equal(formatFine(1500), 'Rs. 1,500');
});

test('withFineNotice: the fine is named in the freeze message', () => {
  const message = withFineNotice('Your account is frozen.', 200);
  assert.match(message, /Your account is frozen\./);
  assert.match(message, /Rs\. 200/);
  assert.equal(message.includes(fineNotice(200)), true);
});

test('withFineNotice: a zero fine says nothing about money', () => {
  assert.equal(withFineNotice('Your account is frozen.', 0), 'Your account is frozen.');
});

test('the freeze message with a fine still fits the stored 500-character reason', () => {
  // `user.frozenReason` is capped at 500 by the schema; a message Mongoose silently
  // refuses would leave the rider with no explanation at all.
  const message = withFineNotice(lateStartReason(karachiInstant(13, 35)), MAX_FREEZE_FINE_AMOUNT);
  assert.ok(message.length <= 500, `freeze reason is ${message.length} characters`);
});

test('lateStartFineReason: records the offence, not the lockout', () => {
  const late = lateStartFineReason(karachiInstant(13, 35), DEADLINE, KARACHI);
  assert.match(late, /1:35 PM/);
  assert.match(late, /12:30 PM/);
  // Read months later in a fine history, "your account is frozen" would be stale.
  assert.doesNotMatch(late, /frozen/i);

  const noShow = lateStartFineReason(null, DEADLINE, KARACHI);
  assert.match(noShow, /no shop check-in by 12:30 PM/i);
});

test('lateStartFlagMessage: carries the fine for the admin, and omits it at zero', () => {
  assert.match(lateStartFlagMessage(null, 3, DEADLINE, KARACHI, 200), /Rs\. 200 fine\./);
  assert.doesNotMatch(lateStartFlagMessage(null, 3, DEADLINE, KARACHI, 0), /fine/i);
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} account-freeze rule tests passed.`);
