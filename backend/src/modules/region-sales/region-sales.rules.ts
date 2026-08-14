/**
 * Pure, side-effect-free helpers for the region-wise daily sale dashboard.
 *
 * Kept free of Mongoose/IO so the timezone maths — the part most likely to be quietly
 * wrong — can be unit-tested in isolation (see region-sales.rules.test.ts).
 *
 * WHY A TIMEZONE AT ALL: the rest of the app buckets dates in UTC, which is invisible in
 * a monthly report but wrong for a *daily* figure. At UTC+5 an order booked at 02:00 PKT
 * would otherwise be counted on the previous day. This dashboard therefore works in
 * `REPORT_TIMEZONE`, and every day boundary here is a boundary in THAT zone, not UTC.
 */

/** Business timezone for day boundaries. Override with the REPORT_TIMEZONE env var. */
export const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Karachi';

/** Region shown for salesmen who have no city recorded. */
export const UNASSIGNED_REGION = 'Unassigned';

/** Stable key for the unassigned bucket (matches `normalizeCityKey('')`). */
export const UNASSIGNED_REGION_KEY = '';

/** True when the string is a well-formed `YYYY-MM-DD` day key. */
export function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject impossible calendar dates like 2026-02-30.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Offset of `timeZone` from UTC, in minutes, at the given instant.
 * Positive east of Greenwich (Asia/Karachi → +300).
 *
 * Derived from Intl rather than hardcoded so the helper stays correct if the deployment
 * moves to a zone that observes DST.
 */
function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // `hour` can come back as 24 for midnight under hour12:false in some runtimes.
  const hour = get('hour') % 24;
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  // formatToParts has no millisecond field, so `asIfUtc` is truncated to whole seconds
  // while `instant` may carry milliseconds. Every real-world zone offset is a whole
  // number of minutes, so rounding recovers the exact value instead of leaking that
  // sub-second difference into the computed boundary.
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/** The UTC instant corresponding to a wall-clock time in `timeZone`. */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // First guess using the offset at the naive instant, then re-resolve once. The second
  // pass matters only near a DST transition, where the offset differs either side.
  const firstOffset = timeZoneOffsetMinutes(new Date(naive), timeZone);
  const firstGuess = naive - firstOffset * 60_000;
  const secondOffset = timeZoneOffsetMinutes(new Date(firstGuess), timeZone);
  return new Date(naive - secondOffset * 60_000);
}

/**
 * UTC instants bounding a local calendar day, inclusive of both ends.
 *
 * `localDayRangeUtc('2026-07-31')` in Asia/Karachi spans
 * 2026-07-30T19:00:00.000Z .. 2026-07-31T18:59:59.999Z.
 */
export function localDayRangeUtc(
  day: string,
  timeZone: string = REPORT_TIMEZONE,
): { start: Date; end: Date } {
  if (!isValidDayKey(day)) {
    throw new Error(`Invalid day "${day}" — expected YYYY-MM-DD`);
  }
  const [y, m, d] = day.split('-').map(Number);
  return {
    start: zonedWallClockToUtc(y, m, d, 0, 0, 0, 0, timeZone),
    end: zonedWallClockToUtc(y, m, d, 23, 59, 59, 999, timeZone),
  };
}

/**
 * The local calendar day (`YYYY-MM-DD`) an instant falls on in `timeZone`.
 * Mirrors what Mongo's `$dateToString` with the same `timezone` produces, so the
 * JS-side and DB-side bucketing always agree.
 */
export function localDayKey(date: Date, timeZone: string = REPORT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's day key in the report timezone. */
export function todayDayKey(timeZone: string = REPORT_TIMEZONE): string {
  return localDayKey(new Date(), timeZone);
}

/** Inclusive range of consecutive day keys, so charts/tables can be zero-filled. */
export function eachDayKey(from: string, to: string): string[] {
  if (!isValidDayKey(from)) throw new Error(`Invalid from "${from}" — expected YYYY-MM-DD`);
  if (!isValidDayKey(to)) throw new Error(`Invalid to "${to}" — expected YYYY-MM-DD`);

  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  // Walk in plain UTC — these are calendar labels, not instants, so no zone is involved.
  const cursor = new Date(Date.UTC(fy, fm - 1, fd));
  const last = new Date(Date.UTC(ty, tm - 1, td));
  if (cursor > last) return [];

  const days: string[] = [];
  // Guard against a pathological range locking the process up.
  const MAX_DAYS = 732;
  while (cursor <= last && days.length < MAX_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Number of days an inclusive range covers, used to reject oversized requests. */
export function dayRangeLength(from: string, to: string): number {
  return eachDayKey(from, to).length;
}

/**
 * Grouping key for a city name: trimmed and lowercased.
 *
 * City is free text on User, so "Lahore", "lahore" and " Lahore " are the same region and
 * must collapse to one row. Missing/blank yields '' — the Unassigned bucket.
 */
export function normalizeCityKey(city?: string | null): string {
  if (typeof city !== 'string') return UNASSIGNED_REGION_KEY;
  return city.trim().toLowerCase();
}

/** Human-facing region name: the original casing, or "Unassigned" when there is none. */
export function regionLabel(rawCity?: string | null): string {
  const trimmed = typeof rawCity === 'string' ? rawCity.trim() : '';
  return trimmed === '' ? UNASSIGNED_REGION : trimmed;
}

/**
 * Money is summed as floats; round once at the edge to avoid 0.1+0.2 artefacts.
 *
 * Lives here rather than in a service so every money-bearing module shares ONE definition.
 * Two rounding rules eventually disagree, and when they do a grand total stops matching the
 * sum of its own rows.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
