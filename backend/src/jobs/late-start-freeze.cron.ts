import cron, { type ScheduledTask } from 'node-cron';
import { sweepLateStarters } from '../modules/account-freeze/account-freeze.service';
import {
  FREEZE_TIMEZONE,
  configuredDeadline,
  formatDeadline,
} from '../modules/account-freeze/account-freeze.rules';

/**
 * Daily late-start sweep: freezes riders who had visits assigned today and never checked
 * in at a shop by the deadline.
 *
 * This is the half of the rule the check-in guard cannot cover. A rider who turns up late
 * is caught when they try to check in; a rider who never turns up at all performs no
 * action to be caught by, so the account would sit quietly unfrozen and the admin would
 * see nothing. This sweep is what makes a no-show visible.
 *
 * Runs a few minutes AFTER the deadline (not exactly on it) so a rider checking in at
 * 12:29:58 is never raced by the sweep. `sweepLateStarters` re-checks the deadline itself
 * and no-ops if called early, so an odd schedule cannot freeze anyone prematurely.
 *
 * - `LATE_START_CRON_ENABLED=false` — turn the sweep off entirely.
 * - `LATE_START_CRON_SCHEDULE` — cron expression; defaults to deadline + 5 minutes,
 *   every day except Friday (the company holiday the visit cron already skips).
 * - `RIDER_FREEZE_TIMEZONE` / `REPORT_TIMEZONE` — the zone the deadline is a time in.
 */
function parseBoolEnv(value: string | undefined, defaultTrue: boolean): boolean {
  if (value === undefined || value === '') return defaultTrue;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

/** Grace between the deadline and the sweep, so a last-second check-in is never raced. */
const SWEEP_DELAY_MINUTES = 5;

/** Default expression: deadline + 5 minutes, daily except Friday (node-cron DOW 5). */
function defaultExpression(): string {
  const deadline = configuredDeadline();
  const total = deadline.hour * 60 + deadline.minute + SWEEP_DELAY_MINUTES;
  // A deadline late enough that +5 crosses midnight would move the sweep onto the next
  // calendar day, where it would query the wrong day's visits. Clamp to 23:59 instead.
  const clamped = Math.min(total, 23 * 60 + 59);
  return `${clamped % 60} ${Math.floor(clamped / 60)} * * 0,1,2,3,4,6`;
}

let task: ScheduledTask | undefined;

export function startLateStartFreezeCron(): ScheduledTask | null {
  if (!parseBoolEnv(process.env.LATE_START_CRON_ENABLED, true)) {
    console.log('[late-start-cron] Disabled (LATE_START_CRON_ENABLED=false)');
    return null;
  }

  let expression: string;
  let deadlineLabel: string;
  try {
    expression = process.env.LATE_START_CRON_SCHEDULE?.trim() || defaultExpression();
    deadlineLabel = formatDeadline();
  } catch (err) {
    // A malformed RIDER_FIRST_VISIT_DEADLINE must not take the server down, but it must
    // not silently freeze people at the wrong time either — so the sweep stays off.
    console.error('[late-start-cron] Not started:', (err as Error).message);
    return null;
  }

  if (!cron.validate(expression)) {
    console.error(
      `[late-start-cron] Invalid LATE_START_CRON_SCHEDULE "${expression}" — sweep not started`,
    );
    return null;
  }

  task?.stop();
  task = cron.schedule(
    expression,
    () => {
      sweepLateStarters()
        .then((summary) => console.log('[late-start-cron] Sweep:', summary))
        .catch((err) => console.error('[late-start-cron] Failed:', err));
    },
    { timezone: FREEZE_TIMEZONE },
  );

  console.log(
    `[late-start-cron] Scheduled "${expression}" (${FREEZE_TIMEZONE}) — freezes riders with no check-in by ${deadlineLabel}`,
  );
  return task;
}
