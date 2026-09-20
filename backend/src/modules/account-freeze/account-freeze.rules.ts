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

/**
 * The company-wide late-start fine, in rupees. A rider who is frozen for starting late is also
 * fined this, once for that day.
 *
 * Overridable two ways, most specific first:
 *  1. `user.freezeFineAmount` — this one rider's amount, set by an admin.
 *  2. `RIDER_FREEZE_FINE_AMOUNT` — the company default, for everyone with no override.
 */
export const DEFAULT_FREEZE_FINE_AMOUNT = 200;

/**
 * Upper bound on any fine. Not a business rule — a typo guard. `20000` meant as `200.00` is an
 * easy slip in a prompt box, and a fine two orders of magnitude out is far more damaging than a
 * refused edit.
 */
export const MAX_FREEZE_FINE_AMOUNT = 100000;

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

/**
 * Validates an admin-supplied fine amount.
 *
 * @throws when it is not a whole, non-negative number within the cap. Rejected loudly rather
 * than coerced: a silently rounded or clamped fine is money the admin did not agree to.
 */
export function parseFineAmount(value: unknown): number {
  const amount = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('Fine amount must be a number');
  }
  if (!Number.isInteger(amount)) {
    throw new Error('Fine amount must be a whole number of rupees');
  }
  if (amount < 0) {
    throw new Error('Fine amount cannot be negative');
  }
  if (amount > MAX_FREEZE_FINE_AMOUNT) {
    throw new Error(`Fine amount cannot exceed ${MAX_FREEZE_FINE_AMOUNT}`);
  }
  return amount;
}

/**
 * The company default fine, from `RIDER_FREEZE_FINE_AMOUNT` or the 200 default.
 *
 * A bad env value falls back to the default with a warning instead of throwing. Unlike the
 * deadline — where a wrong value freezes the wrong people — a wrong fine that refused to boot
 * would take the whole tracking app down over a disciplinary number.
 */
export function configuredFineAmount(): number {
  const raw = process.env.RIDER_FREEZE_FINE_AMOUNT?.trim();
  if (!raw) return DEFAULT_FREEZE_FINE_AMOUNT;
  try {
    return parseFineAmount(raw);
  } catch {
    console.warn(
      `[account-freeze] Ignoring invalid RIDER_FREEZE_FINE_AMOUNT="${raw}" — ` +
        `using ${DEFAULT_FREEZE_FINE_AMOUNT}`,
    );
    return DEFAULT_FREEZE_FINE_AMOUNT;
  }
}

/**
 * The fine THIS rider gets: their own amount when an admin has set one, the company default
 * otherwise. `0` is honoured — see `user.freezeFineAmount`.
 */
export function resolveFineAmount(override: number | null | undefined): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return override;
  }
  return configuredFineAmount();
}

/** `200` → `Rs. 200`. The one place the fine is formatted, so rider and admin read the same. */
export function formatFine(amount: number): string {
  return `Rs. ${Math.round(amount).toLocaleString('en-PK')}`;
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

/**
 * The sentence appended to the freeze message when a fine was raised with it.
 *
 * Kept separate from `lateStartReason` rather than folded into it because the fine is
 * per-rider and can be zero: a rider whose amount is set to 0 is frozen and told exactly the
 * same thing as before, with no mention of money.
 */
export function fineNotice(amount: number): string {
  return `A ${formatFine(amount)} late-start fine has also been added to your account.`;
}

/** Freeze message plus the fine sentence, or the plain message when nothing was charged. */
export function withFineNotice(reason: string, amount: number): string {
  return amount > 0 ? `${reason} ${fineNotice(amount)}` : reason;
}

/**
 * What the fine itself records — the offence, not the freeze. Read back months later in the
 * rider's fine history, where "your account is frozen" would be stale and confusing.
 */
export function lateStartFineReason(
  arrivedAt: Date | null,
  deadline: TimeOfDay = configuredDeadline(),
  timeZone: string = FREEZE_TIMEZONE,
): string {
  const by = formatDeadline(deadline);
  return arrivedAt
    ? `Late start — first shop check-in at ${formatWallClock(arrivedAt, timeZone)}, after the ${by} deadline.`
    : `Late start — no shop check-in by ${by}.`;
}

/** The admin-facing one-liner on the performance flag. */
export function lateStartFlagMessage(
  arrivedAt: Date | null,
  assignedVisits: number,
  deadline: TimeOfDay = configuredDeadline(),
  timeZone: string = FREEZE_TIMEZONE,
  /** Rupees fined alongside the freeze. `0` means none, and is then not mentioned at all. */
  fineAmount = 0,
): string {
  const by = formatDeadline(deadline);
  // The flag is the admin's audit line for the day, so it carries the money too — otherwise
  // the only record of what the rider was charged lives on a separate screen.
  const fine = fineAmount > 0 ? ` ${formatFine(fineAmount)} fine.` : '';
  if (arrivedAt) {
    return `First shop check-in at ${formatWallClock(arrivedAt, timeZone)}, past the ${by} deadline. Account frozen.${fine}`;
  }
  // Riders are freezable with no assigned visits at all, so the count is only worth
  // mentioning when there actually was route work to miss.
  const scope = assignedVisits > 0 ? ` with ${assignedVisits} visit(s) assigned` : '';
  return `No shop check-in by ${by}${scope}. Account frozen.${fine}`;
}
