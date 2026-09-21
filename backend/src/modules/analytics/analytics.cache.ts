import { toPeriodMonth } from './analytics.rules';

/**
 * Tiny in-process TTL cache for the analytics reports.
 *
 * The reports fan out across ten collections, and the admin UI re-requests the same
 * month constantly (revisiting the page, toggling the employee filter, switching back
 * to a month already seen). Almost all of that work is repeated for data that has not
 * changed.
 *
 * The TTL is picked from the period being asked for: a month that has already ended is
 * frozen apart from a target edit, so it can be held for a long time, while the current
 * month is still accumulating orders and visits and gets a short one.
 *
 * SECURITY: every report is scope-filtered for the caller — an admin sees everyone, a
 * sales manager only their own team, everyone else only themselves. The cache key MUST
 * therefore include the viewer's id and role. Keying on the period alone would serve one
 * manager's team report to another manager, or to a rider. `cacheKey` is the only place
 * that key is built, so it is the only place that invariant has to hold.
 *
 * Deliberately per-process: it is a latency cache, not a source of truth, so a restart or
 * a second instance simply means a cold miss rather than an inconsistency.
 */

/**
 * Current month is still moving, so it is held only briefly. This is the one real
 * trade-off in the cache: an order or visit recorded now can take up to this long to
 * show up on the dashboard. Closed months are exact.
 *
 * Kept short deliberately — riders check their own scorecard right after finishing a
 * delivery, and a longer window makes their own work look missing. Most of the saving
 * comes from closed months anyway, which are cached for an hour.
 */
const DEFAULT_LIVE_TTL_MS = 15_000;
/** A finished month only changes when someone edits a target, which busts the cache. */
const DEFAULT_CLOSED_TTL_MS = 60 * 60_000;
/** Bound on memory. Well above one team's working set of months. */
const MAX_ENTRIES = 500;

interface Entry {
  expiresAt: number;
  value: unknown;
}

const store = new Map<string, Entry>();

/**
 * Env is read on every call rather than at import time so that tests (and an operator
 * with a shell) can turn the cache off without controlling module load order.
 */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Kill switch: `ANALYTICS_CACHE_DISABLED=1` makes every read a miss. */
function isDisabled(): boolean {
  const raw = process.env.ANALYTICS_CACHE_DISABLED;
  return raw === '1' || raw === 'true';
}

/**
 * Cache key for one report request.
 *
 * `viewerId` and `viewerRole` are both included because scope is derived from the pair:
 * the same user id with a different role resolves to a different set of employees.
 */
export function cacheKey(
  kind: string,
  viewerId: string,
  viewerRole: string,
  parts: (string | number | undefined)[],
): string {
  return [kind, viewerId, viewerRole, ...parts.map((p) => p ?? '')].join('|');
}

/** TTL for a report covering `periodMonth`, or the live TTL when it spans the current one. */
export function ttlForPeriod(periodMonth: string | undefined): number {
  const live = envMs('ANALYTICS_CACHE_LIVE_TTL_MS', DEFAULT_LIVE_TTL_MS);
  if (!periodMonth) return live;
  // A future month can still gain targets, so it is treated as live rather than closed.
  return periodMonth < toPeriodMonth(new Date())
    ? envMs('ANALYTICS_CACHE_CLOSED_TTL_MS', DEFAULT_CLOSED_TTL_MS)
    : live;
}

/**
 * Cached value for `key`, or `undefined` on a miss.
 *
 * The stored object is returned by reference. Callers serialise it straight to JSON and
 * never mutate it; anything that needs to modify a report must copy it first.
 */
export function getCached<T>(key: string): T | undefined {
  if (isDisabled()) return undefined;
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
  if (isDisabled() || ttlMs <= 0) return;
  // Drop whatever expired since the last write before deciding we are full, so a burst of
  // stale entries does not evict live ones.
  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, entry] of store) {
      if (entry.expiresAt <= now) store.delete(k);
    }
    // Still full: evict oldest-inserted first (Map preserves insertion order).
    while (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
    }
  }
  store.set(key, { expiresAt: Date.now() + ttlMs, value });
}

/**
 * Drops every cached report.
 *
 * Called when a target is written or deleted. A target edit changes achievement and
 * status for that employee, and rolls up into the team KPIs of every viewer who can see
 * them, so working out exactly which keys went stale costs more than simply recomputing.
 * Target writes are rare; report reads are not.
 */
export function invalidateAnalyticsCache(): void {
  store.clear();
}

/** Test seam — lets a suite assert on hit/miss behaviour without waiting out a TTL. */
export function analyticsCacheSize(): number {
  return store.size;
}
