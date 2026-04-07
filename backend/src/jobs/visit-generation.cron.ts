import cron, { type ScheduledTask } from 'node-cron';
import * as visitsService from '../modules/visits/visits.service';

function parseBoolEnv(value: string | undefined, defaultTrue: boolean): boolean {
  if (value === undefined || value === '') return defaultTrue;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

/** Hour (0–23) and minute in `timeZone` for instant `d`. */
function wallClockInZone(d: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid VISIT_CRON_TIMEZONE or date: ${timeZone}`);
  }
  return { hour, minute };
}

/**
 * Resolves cron expression: explicit VISIT_CRON_SCHEDULE wins; else optional
 * VISIT_CRON_STARTUP_OFFSET_MINUTES builds a daily job at wall clock (now + offset) in VISIT_CRON_TIMEZONE.
 */
function resolveSchedule(): { expression: string; timezone: string; label: string } {
  const timezone = process.env.VISIT_CRON_TIMEZONE?.trim() || 'UTC';
  const explicit = process.env.VISIT_CRON_SCHEDULE?.trim();
  if (explicit) {
    return { expression: explicit, timezone, label: explicit };
  }

  const offsetRaw = process.env.VISIT_CRON_STARTUP_OFFSET_MINUTES?.trim();
  if (offsetRaw !== undefined && offsetRaw !== '') {
    const offsetMin = parseInt(offsetRaw, 10);
    if (!Number.isNaN(offsetMin)) {
      const target = new Date(Date.now() + offsetMin * 60 * 1000);
      const { hour, minute } = wallClockInZone(target, timezone);
      const expression = `${minute} ${hour} * * 0,1,2,3,4,6`;
      const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} daily except Fri (${timezone}, from startup +${offsetMin}m)`;
      return { expression, timezone, label };
    }
  }

  // node-cron DOW: 0=Sun … 5=Fri … 6=Sat — omit Friday (company holiday)
  return {
    expression: '0 0 * * 0,1,2,3,4,6',
    timezone,
    label: '0 0 * * 0,1,2,3,4,6 (midnight; not Fri)',
  };
}

/**
 * Schedules daily visit generation for routes that have an assigned order_taker and at least one dealer.
 * - `VISIT_CRON_SCHEDULE` — cron expression (overrides startup offset when set).
 * - `VISIT_CRON_STARTUP_OFFSET_MINUTES` — if schedule unset, daily at wall clock = now + N minutes in `VISIT_CRON_TIMEZONE`.
 * - Default schedule: `0 0 * * 0,1,2,3,4,6` (midnight in `VISIT_CRON_TIMEZONE`; **not Friday**).
 * Set VISIT_CRON_ENABLED=false to disable.
 */
export function startVisitGenerationCron(): ScheduledTask | null {
  const enabled = parseBoolEnv(process.env.VISIT_CRON_ENABLED, true);
  if (!enabled) {
    console.log('[visit-cron] Disabled (VISIT_CRON_ENABLED=false)');
    return null;
  }

  const { expression, timezone, label } = resolveSchedule();

  const task = cron.schedule(
    expression,
    async () => {
      try {
        const summary = await visitsService.createVisitsForAllEligibleRoutes();
        console.log('[visit-cron] Daily visit generation:', summary);
      } catch (err) {
        console.error('[visit-cron] Failed:', err);
      }
    },
    { timezone },
  );

  console.log(
    `[visit-cron] Scheduled (${label}) — eligible routes get visits once per run`,
  );
  return task;
}
