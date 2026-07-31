/**
 * Pure, side-effect-free helpers for performance analytics.
 *
 * Kept free of Mongoose/IO so period maths and achievement calculations can be
 * unit-tested in isolation (see analytics.rules.test.ts).
 */

/** Metrics a monthly target can be set on. */
export type TargetMetric = 'salesAmount' | 'orderCount' | 'visitCount';

export const TARGET_METRICS: readonly TargetMetric[] = ['salesAmount', 'orderCount', 'visitCount'];

/**
 * Canonical month key (`YYYY-MM`) for a date, in UTC.
 * Matches the `$dateToString` `%Y-%m` format used by the aggregations, so a
 * target row joins straight onto a monthly bucket.
 */
export function toPeriodMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** True when the string is a well-formed `YYYY-MM` month key. */
export function isValidPeriodMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** UTC start (inclusive) and end (inclusive) instants covering a `YYYY-MM` month. */
export function periodMonthToRange(periodMonth: string): { start: Date; end: Date } {
  if (!isValidPeriodMonth(periodMonth)) {
    throw new Error(`Invalid periodMonth "${periodMonth}" — expected YYYY-MM`);
  }
  const [year, month] = periodMonth.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  // Day 0 of the next month is the last day of this one.
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

/** Every month key from `start` to `end` inclusive, ascending. */
export function monthsInRange(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(toPeriodMonth(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Progress against a target as a percentage, rounded to one decimal.
 *
 * - No target (undefined / null / 0) ⇒ `null`. "No target" is not 0% and must not be
 *   rendered as failure; callers show a dash instead.
 * - Achievement is NOT capped at 100 — over-performance is meaningful.
 */
export function achievementPercent(
  actual: number,
  target: number | null | undefined,
): number | null {
  if (target == null || target <= 0) return null;
  return Math.round((actual / target) * 1000) / 10;
}

/** Remaining amount needed to hit the target; 0 once met, `null` when no target is set. */
export function remainingToTarget(
  actual: number,
  target: number | null | undefined,
): number | null {
  if (target == null || target <= 0) return null;
  return Math.max(0, target - actual);
}

export type AchievementStatus = 'no_target' | 'on_track' | 'at_risk' | 'behind' | 'achieved';

/**
 * Classifies progress, accounting for how far through the month we are.
 *
 * `elapsedFraction` is 0..1 — the portion of the period already gone. A rider at 40%
 * achievement is fine on day 5 but behind on day 25, so the thresholds are relative to
 * expected pace rather than absolute.
 */
export function achievementStatus(
  actual: number,
  target: number | null | undefined,
  elapsedFraction: number,
): AchievementStatus {
  const percent = achievementPercent(actual, target);
  if (percent == null) return 'no_target';
  if (percent >= 100) return 'achieved';

  const expected = Math.min(Math.max(elapsedFraction, 0), 1) * 100;
  // Ahead of, or close to, the pace needed to finish on time.
  if (percent >= expected * 0.9) return 'on_track';
  if (percent >= expected * 0.6) return 'at_risk';
  return 'behind';
}

/**
 * How far through a month we are, as 0..1.
 * Past months are 1 (fully elapsed), future months 0.
 */
export function monthElapsedFraction(periodMonth: string, now: Date): number {
  const { start, end } = periodMonthToRange(periodMonth);
  if (now >= end) return 1;
  if (now <= start) return 0;
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

/** Safe division that yields 0 rather than NaN/Infinity for a zero denominator. */
export function safeRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
