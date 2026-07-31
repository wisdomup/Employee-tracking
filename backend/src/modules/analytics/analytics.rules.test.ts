/**
 * Unit tests for the pure analytics helpers (period maths, achievement, pacing).
 * Run with: npm run test:analytics
 */
import assert from 'node:assert/strict';
import {
  toPeriodMonth,
  isValidPeriodMonth,
  periodMonthToRange,
  monthsInRange,
  achievementPercent,
  remainingToTarget,
  achievementStatus,
  monthElapsedFraction,
  safeRate,
} from './analytics.rules';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------------------
console.log('Period keys');
// ---------------------------------------------------------------------------
test('toPeriodMonth zero-pads the month and uses UTC', () => {
  assert.equal(toPeriodMonth(new Date('2026-07-29T00:00:00Z')), '2026-07');
  assert.equal(toPeriodMonth(new Date('2026-01-01T00:00:00Z')), '2026-01');
  assert.equal(toPeriodMonth(new Date('2026-12-31T23:59:59Z')), '2026-12');
});

test('isValidPeriodMonth accepts YYYY-MM and rejects anything else', () => {
  assert.equal(isValidPeriodMonth('2026-07'), true);
  assert.equal(isValidPeriodMonth('2026-01'), true);
  assert.equal(isValidPeriodMonth('2026-12'), true);
  assert.equal(isValidPeriodMonth('2026-00'), false);
  assert.equal(isValidPeriodMonth('2026-13'), false);
  assert.equal(isValidPeriodMonth('2026-7'), false);
  assert.equal(isValidPeriodMonth('07-2026'), false);
  assert.equal(isValidPeriodMonth(''), false);
});

test('periodMonthToRange covers the whole month inclusively', () => {
  const { start, end } = periodMonthToRange('2026-07');
  assert.equal(start.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-07-31T23:59:59.999Z');
});

test('periodMonthToRange handles February in a leap year', () => {
  const { end } = periodMonthToRange('2028-02');
  assert.equal(end.toISOString(), '2028-02-29T23:59:59.999Z');
  assert.equal(periodMonthToRange('2026-02').end.toISOString(), '2026-02-28T23:59:59.999Z');
});

test('periodMonthToRange rejects a malformed month', () => {
  assert.throws(() => periodMonthToRange('2026-13'), /Invalid periodMonth/);
});

test('monthsInRange spans year boundaries', () => {
  const months = monthsInRange(new Date('2025-11-15T00:00:00Z'), new Date('2026-02-03T00:00:00Z'));
  assert.deepEqual(months, ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('monthsInRange returns a single month when start and end share one', () => {
  assert.deepEqual(
    monthsInRange(new Date('2026-07-02T00:00:00Z'), new Date('2026-07-28T00:00:00Z')),
    ['2026-07'],
  );
});

// ---------------------------------------------------------------------------
console.log('\nAchievement');
// ---------------------------------------------------------------------------
test('achievementPercent computes progress to one decimal', () => {
  assert.equal(achievementPercent(50, 100), 50);
  assert.equal(achievementPercent(33, 100), 33);
  assert.equal(achievementPercent(1, 3), 33.3);
});

test('no target yields null, NOT zero', () => {
  assert.equal(achievementPercent(500, null), null);
  assert.equal(achievementPercent(500, undefined), null);
  assert.equal(achievementPercent(500, 0), null);
});

test('achievement is not capped — over-performance shows through', () => {
  assert.equal(achievementPercent(150, 100), 150);
  assert.equal(achievementPercent(1000, 100), 1000);
});

test('zero sales against a real target is 0%, not null', () => {
  assert.equal(achievementPercent(0, 100), 0);
});

test('remainingToTarget floors at zero once the target is met', () => {
  assert.equal(remainingToTarget(30, 100), 70);
  assert.equal(remainingToTarget(100, 100), 0);
  assert.equal(remainingToTarget(150, 100), 0);
  assert.equal(remainingToTarget(30, null), null);
});

test('safeRate never returns NaN or Infinity', () => {
  assert.equal(safeRate(5, 10), 50);
  assert.equal(safeRate(0, 0), 0);
  assert.equal(safeRate(5, 0), 0);
  assert.equal(safeRate(1, 3), 33.3);
});

// ---------------------------------------------------------------------------
console.log('\nPacing / status');
// ---------------------------------------------------------------------------
test('status is no_target when nothing was set', () => {
  assert.equal(achievementStatus(500, null, 0.5), 'no_target');
});

test('status is achieved at or over 100% regardless of pace', () => {
  assert.equal(achievementStatus(100, 100, 0.1), 'achieved');
  assert.equal(achievementStatus(250, 100, 1), 'achieved');
});

test('same achievement reads differently early vs late in the month', () => {
  // 40% achieved with only 10% of the month gone — comfortably ahead.
  assert.equal(achievementStatus(40, 100, 0.1), 'on_track');
  // The same 40% with the month nearly over — behind.
  assert.equal(achievementStatus(40, 100, 0.95), 'behind');
});

test('at_risk sits between on_track and behind', () => {
  // 60% done, 90% of month elapsed: 60 >= 90*0.6 (54) but < 90*0.9 (81).
  assert.equal(achievementStatus(60, 100, 0.9), 'at_risk');
});

test('elapsedFraction is clamped, so out-of-range values do not break status', () => {
  assert.equal(achievementStatus(50, 100, -5), 'on_track');
  assert.equal(achievementStatus(10, 100, 99), 'behind');
});

test('monthElapsedFraction is 0 before, 1 after, fractional during', () => {
  assert.equal(monthElapsedFraction('2026-07', new Date('2026-06-01T00:00:00Z')), 0);
  assert.equal(monthElapsedFraction('2026-07', new Date('2026-08-01T00:00:00Z')), 1);
  const mid = monthElapsedFraction('2026-07', new Date('2026-07-16T12:00:00Z'));
  assert.ok(mid > 0.45 && mid < 0.55, `expected ~0.5, got ${mid}`);
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} analytics-rule tests passed.`);
