/**
 * Pure, side-effect-free rules for the rider late-start freeze.
 *
 * THE RULE: a rider must check in at their FIRST shop of the day by 12:30 PM. Miss it
 * and the account is frozen — they can still sign in and see why, but they cannot record
 * any work until an admin unfreezes them.
 *
 * Kept free of Mongoose/IO for the same reason `region-sales.rules.ts` is: the timezone
 * maths is the part most likely to be quietly wrong, and it needs to be testable without
 * a database (see account-freeze.rules.test.ts).
 *
 * WHY A TIMEZONE: "12:30 PM" is a wall-clock time in the business's own zone. At UTC+5 a
 * deadline compared in UTC would fire at 5:30 PM local — five and a half hours late, so
 * every rider would pass. Every comparison here therefore happens in `FREEZE_TIMEZONE`.
 */

import { ROLES, type Role } from '../../constants/global';
import { REPORT_TIMEZONE } from '../region-sales/region-sales.rules';

/**
 * Roles subject to the rule. Only `order_taker` today — they are the role the route/visit
 * cron assigns shop visits to, and the one whose day is measured by shop arrivals.
 * Adding a role here is all that is needed to extend the rule to it.
 */
export const FREEZE_ELIGIBLE_ROLES: readonly Role[] = [ROLES.ORDER_TAKER];

/** Business timezone the deadline is a wall-clock time in. */
export const FREEZE_TIMEZONE = process.env.RIDER_FREEZE_TIMEZONE?.trim() || REPORT_TIMEZONE;

/** Default wall-clock deadline for the first check-in of the day, `HH:MM` 24-hour. */
export const DEFAULT_FIRST_VISIT_DEADLINE = '12:30';

/** A wall-clock time of day, as hours and minutes. */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

/**
 * Parses an `HH:MM` 24-hour deadline.
 * @throws when the string is not a real time — a typo in the env var must fail loudly at
 * startup rather than silently freezing everyone at 00:00.
 */
export function parseTimeOfDay(value: string): TimeOfDay {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid time "${value}" — expected HH:MM (24-hour), e.g. 12:30`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid time "${value}" — hour must be 0-23 and minute 0-59`);
  }
  return { hour, minute };
}

/**
 * Master switch for the whole late-start rule, `RIDER_FREEZE_ENABLED=false` to turn it off.
 *
 * Covers BOTH enforcement paths — the check-in guard and the sweep — unlike
 * `LATE_START_CRON_ENABLED`, which only stops the sweep and would leave riders still being
 * refused at check-in. Read per call rather than captured at module load so it can be
 * flipped in a test without reordering imports.
 */
export function isFreezeRuleEnabled(): boolean {
  const raw = process.env.RIDER_FREEZE_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

/** The configured deadline, from `RIDER_FIRST_VISIT_DEADLINE` or the 12:30 default. */
export function configuredDeadline(): TimeOfDay {
  return parseTimeOfDay(
    process.env.RIDER_FIRST_VISIT_DEADLINE?.trim() || DEFAULT_FIRST_VISIT_DEADLINE,
  );
}

/** Minutes since local midnight — the single scale every comparison here works on. */
export function minutesSinceMidnight(time: TimeOfDay): number {
  return time.hour * 60 + time.minute;
}

/** Wall-clock time of `instant` in `timeZone`. */
export function wallClockInZone(instant: Date, timeZone: string = FREEZE_TIMEZONE): TimeOfDay {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // `hour` can come back as 24 for midnight under hour12:false in some runtimes.
  const hour = get('hour') % 24;
  const minute = get('minute');
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid timezone "${timeZone}"`);
  }
  return { hour, minute };
}

/** Minutes since local midnight for `instant`, in `timeZone`. */
export function minuteOfDayInZone(instant: Date, timeZone: string = FREEZE_TIMEZONE): number {
  return minutesSinceMidnight(wallClockInZone(instant, timeZone));
}

/**
 * Whether an arrival at `instant` is past the deadline.
 *
 * Exactly on the deadline PASSES — 12:30:00 is "by 12:30", and a rider who makes it to
 * the second should not be punished for the seconds hand. Only 12:31 onwards is late.
 */
export function isPastDeadline(
  instant: Date,
  deadline: TimeOfDay = configuredDeadline(),
  timeZone: string = FREEZE_TIMEZONE,
): boolean {
  return minuteOfDayInZone(instant, timeZone) > minutesSinceMidnight(deadline);
}

/**
 * The company holiday, in `Date.getUTCDay()` numbering (0 = Sunday). Friday — the same day
 * the visit-generation cron already omits.
 */
export const NON_WORKING_WEEKDAY = 5;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday of `instant` in `timeZone`, 0 = Sunday … 6 = Saturday. */
export function weekdayInZone(instant: Date, timeZone: string = FREEZE_TIMEZONE): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  const index = WEEKDAY_LABELS.indexOf(label);
  if (index < 0) {
    throw new Error(`Invalid timezone "${timeZone}"`);
  }
  return index;
}

/**
 * True on the company holiday, when nobody is expected at a shop at all.
 *
 * Checked in the rule rather than only in the cron expression: the cron's default schedule
 * omits Friday, but the check-in guard runs on every check-in regardless of any schedule,
 * and an operator setting a custom `LATE_START_CRON_SCHEDULE` could easily reintroduce
 * Friday without realising. This makes the holiday hold on both paths.
 */
export function isNonWorkingDay(instant: Date, timeZone: string = FREEZE_TIMEZONE): boolean {
  return weekdayInZone(instant, timeZone) === NON_WORKING_WEEKDAY;
}

/** `12:30` → `12:30 PM`, for messages riders and admins actually read. */
export function formatDeadline(deadline: TimeOfDay = configuredDeadline()): string {
  const suffix = deadline.hour < 12 ? 'AM' : 'PM';
  const hour12 = deadline.hour % 12 === 0 ? 12 : deadline.hour % 12;
  return `${hour12}:${String(deadline.minute).padStart(2, '0')} ${suffix}`;
}

/** Local wall-clock time of `instant` as `HH:MM`, for messages. */
export function formatWallClock(
  instant: Date,
  timeZone: string = FREEZE_TIMEZONE,
): string {
  const { hour, minute } = wallClockInZone(instant, timeZone);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/**
 * The reason string stored on the user and shown to the rider.
 *
 * `arrivedAt` is the moment they finally tried to check in; `null` means they never
 * showed up at all, which reads differently and is worth saying differently.
 */
export function lateStartReason(
  arrivedAt: Date | null,
  deadline: TimeOfDay = configuredDeadline(),
  timeZone: string = FREEZE_TIMEZONE,
): string {
  const by = formatDeadline(deadline);
  return arrivedAt
    ? `Your first shop visit was at ${formatWallClock(arrivedAt, timeZone)}, after the ${by} deadline. ` +
        'Your account is frozen — please contact the admin to have it unfrozen.'
    : `You did not check in at any shop by ${by}. ` +
        'Your account is frozen — please contact the admin to have it unfrozen.';
}

/** The admin-facing one-liner on the performance flag. */
export function lateStartFlagMessage(
  arrivedAt: Date | null,
  assignedVisits: number,
  deadline: TimeOfDay = configuredDeadline(),
  timeZone: string = FREEZE_TIMEZONE,
): string {
  const by = formatDeadline(deadline);
  if (arrivedAt) {
    return `First shop check-in at ${formatWallClock(arrivedAt, timeZone)}, past the ${by} deadline. Account frozen.`;
  }
  // Riders are freezable with no assigned visits at all, so the count is only worth
  // mentioning when there actually was route work to miss.
  const scope = assignedVisits > 0 ? ` with ${assignedVisits} visit(s) assigned` : '';
  return `No shop check-in by ${by}${scope}. Account frozen.`;
}
