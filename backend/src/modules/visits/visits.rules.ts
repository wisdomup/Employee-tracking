/**
 * Pure, side-effect-free business rules for the visit check-in / completion flow.
 *
 * Kept free of Mongoose / IO so the geofence maths and status state-machine can be
 * unit-tested in isolation (see visits.rules.test.ts).
 */

export type VisitStatus =
  | 'todo'
  | 'in_progress'
  | 'checked_in'
  | 'completed'
  | 'skipped'
  | 'incomplete'
  | 'cancelled';

/**
 * A rider must complete at least this share of their assigned visits for the day.
 * Falling below it does NOT block them — it raises a flag for the admin.
 */
export const VISIT_COMPLETION_THRESHOLD_PERCENT = 75;

/** Maximum distance (metres) a rider may be from the store and still check in. */
export const CHECK_IN_RADIUS_METRES = 150;

/**
 * How long a rider is expected to spend at a store, from check-in to checkout.
 * Exceeding this does NOT block checkout — it raises a flag for the admin to review.
 */
export const VISIT_DURATION_LIMIT_MINUTES = 30;

/** Haversine great-circle distance in metres between two GPS points. */
export function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Whether the rider is close enough to the store to check in.
 * Returns the distance so callers can build a helpful "you are N metres away" message.
 */
export function evaluateCheckInProximity(
  riderLat: number,
  riderLng: number,
  storeLat: number,
  storeLng: number,
): { withinRange: boolean; distanceMetres: number } {
  const distanceMetres = haversineMetres(riderLat, riderLng, storeLat, storeLng);
  return { withinRange: distanceMetres <= CHECK_IN_RADIUS_METRES, distanceMetres };
}

/**
 * Validates whether a visit in the given status may be checked in.
 * @returns an error message when the transition is not allowed, otherwise `null`.
 */
export function checkInGuard(status: VisitStatus): string | null {
  if (status === 'checked_in') return 'You have already checked in to this visit';
  if (status === 'completed') return 'Visit is already completed';
  if (status === 'cancelled' || status === 'incomplete') {
    return `Cannot check in to a visit with status "${status}"`;
  }
  return null;
}

/**
 * Measures how long the rider stayed at the store and decides whether that
 * exceeds VISIT_DURATION_LIMIT_MINUTES (which raises an admin-side flag).
 *
 * Returns `durationMinutes: null` when the visit has no check-in timestamp
 * (e.g. an admin completing a visit directly) — nothing to measure, no flag.
 * A checkout that somehow predates the check-in is clamped to 0 rather than
 * producing a negative duration.
 */
export function evaluateVisitDuration(
  checkedInAt: Date | null | undefined,
  completedAt: Date,
): { durationMinutes: number | null; overstay: boolean } {
  if (!checkedInAt) {
    return { durationMinutes: null, overstay: false };
  }
  const elapsedMs = completedAt.getTime() - checkedInAt.getTime();
  const durationMinutes = Math.max(0, Math.round(elapsedMs / 60_000));
  return { durationMinutes, overstay: durationMinutes > VISIT_DURATION_LIMIT_MINUTES };
}

/**
 * Validates whether a visit may be completed.
 * Non-admin riders must have checked in first (the geofenced check-in is what proves
 * they were physically at the store). Admins may complete from any non-completed state.
 * @returns an error message when the transition is not allowed, otherwise `null`.
 */
export function completeGuard(status: VisitStatus, isAdmin: boolean): string | null {
  if (status === 'completed') return 'Visit is already completed';
  if (!isAdmin && status !== 'checked_in') {
    return 'You must check in at the store before completing the visit';
  }
  return null;
}

/** A tally of one rider's visits for a single day. */
export interface VisitDayTally {
  completed: number;
  /** Everything scheduled that day except cancelled visits. */
  assigned: number;
}

/**
 * Completion rate for a day, as a percentage rounded to one decimal.
 *
 * Cancelled visits are excluded from `assigned` by the caller — they are not work the
 * rider failed to do. Skipped and incomplete visits DO count against the rate.
 *
 * With nothing assigned the rate is 100: a rider with no work cannot be failing.
 * Returning 0 there would flag every rider who has an empty day.
 */
export function completionRate(tally: VisitDayTally): number {
  if (tally.assigned <= 0) return 100;
  return Math.round((tally.completed / tally.assigned) * 1000) / 10;
}

/** True when the rate is under the pass mark. */
export function isBelowCompletionThreshold(rate: number): boolean {
  return rate < VISIT_COMPLETION_THRESHOLD_PERCENT;
}

/**
 * The best rate the rider can still finish the day on if they skip one more visit.
 *
 * Skipping never changes the denominator (the visit was still assigned) — it only
 * removes one visit from the pool that could still be completed. So this answers
 * "where do I end up if I skip this and complete everything else that is left":
 * `(completed + stillOpen - 1) / assigned`.
 *
 * `stillOpen` is the number of visits that day not yet completed, skipped or cancelled,
 * INCLUDING the one being skipped.
 */
export function projectRateAfterSkip(tally: VisitDayTally, stillOpen: number): number {
  if (tally.assigned <= 0) return 100;
  const bestCaseCompleted = tally.completed + Math.max(0, stillOpen - 1);
  return Math.round((Math.min(bestCaseCompleted, tally.assigned) / tally.assigned) * 1000) / 10;
}

/**
 * Whether a visit in this status may be skipped.
 * A rider who has already checked in is standing at the shop, so finishing is the
 * expected action — skipping from `checked_in` is refused.
 */
export function skipGuard(status: VisitStatus): string | null {
  if (status === 'skipped') return 'This visit is already skipped';
  if (status === 'completed') return 'Visit is already completed';
  if (status === 'checked_in') {
    return 'You have already checked in at this store — complete the visit instead of skipping it';
  }
  if (status === 'cancelled' || status === 'incomplete') {
    return `Cannot skip a visit with status "${status}"`;
  }
  return null;
}
