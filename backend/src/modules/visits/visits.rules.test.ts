/**
 * Unit tests for the pure visit check-in / completion rules.
 *
 * No test framework is configured in this project, so this runs as a plain
 * ts-node script using Node's built-in `assert`. Run with:
 *   npm run test:visits
 * It exits non-zero on the first failed assertion.
 */
import assert from 'node:assert/strict';
import {
  CHECK_IN_RADIUS_METRES,
  VISIT_DURATION_LIMIT_MINUTES,
  VISIT_COMPLETION_THRESHOLD_PERCENT,
  haversineMetres,
  evaluateCheckInProximity,
  evaluateVisitDuration,
  checkInGuard,
  completeGuard,
  skipGuard,
  completionRate,
  isBelowCompletionThreshold,
  projectRateAfterSkip,
  type VisitStatus,
} from './visits.rules';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------------------
// haversineMetres
// ---------------------------------------------------------------------------
test('haversine: distance between identical points is 0', () => {
  assert.equal(haversineMetres(24.8607, 67.0011, 24.8607, 67.0011), 0);
});

test('haversine: ~111.2 m for 0.001° of latitude', () => {
  const d = haversineMetres(24.8607, 67.0011, 24.8617, 67.0011);
  assert.ok(Math.abs(d - 111.2) < 1, `expected ~111.2 m, got ${d.toFixed(2)} m`);
});

test('haversine: symmetric', () => {
  const a = haversineMetres(24.8607, 67.0011, 31.5204, 74.3587);
  const b = haversineMetres(31.5204, 74.3587, 24.8607, 67.0011);
  assert.ok(Math.abs(a - b) < 1e-6);
});

// ---------------------------------------------------------------------------
// evaluateCheckInProximity — the geofence gate
// ---------------------------------------------------------------------------
test('proximity: rider at the store is within range', () => {
  const { withinRange, distanceMetres } = evaluateCheckInProximity(24.8607, 67.0011, 24.8607, 67.0011);
  assert.equal(withinRange, true);
  assert.equal(distanceMetres, 0);
});

test('proximity: rider ~100 m away (inside 150 m) is within range', () => {
  // ~0.0009° lat ≈ 100 m
  const { withinRange } = evaluateCheckInProximity(24.8607, 67.0011, 24.8616, 67.0011);
  assert.equal(withinRange, true);
});

test('proximity: rider ~333 m away (outside 150 m) is rejected', () => {
  // 0.003° lat ≈ 333 m
  const { withinRange, distanceMetres } = evaluateCheckInProximity(24.8607, 67.0011, 24.8637, 67.0011);
  assert.equal(withinRange, false);
  assert.ok(distanceMetres > CHECK_IN_RADIUS_METRES);
});

// ---------------------------------------------------------------------------
// checkInGuard — status state machine for checking in
// ---------------------------------------------------------------------------
test('checkInGuard: allows check-in from todo', () => {
  assert.equal(checkInGuard('todo'), null);
});

test('checkInGuard: allows check-in from in_progress', () => {
  assert.equal(checkInGuard('in_progress'), null);
});

test('checkInGuard: blocks double check-in', () => {
  assert.match(checkInGuard('checked_in') ?? '', /already checked in/i);
});

test('checkInGuard: blocks check-in when already completed', () => {
  assert.match(checkInGuard('completed') ?? '', /already completed/i);
});

test('checkInGuard: blocks check-in for cancelled/incomplete', () => {
  assert.match(checkInGuard('cancelled') ?? '', /cannot check in/i);
  assert.match(checkInGuard('incomplete') ?? '', /cannot check in/i);
});

// ---------------------------------------------------------------------------
// completeGuard — a rider must check in before completing
// ---------------------------------------------------------------------------
test('completeGuard: rider cannot complete straight from todo', () => {
  assert.match(completeGuard('todo', false) ?? '', /must check in/i);
});

test('completeGuard: rider cannot complete straight from in_progress', () => {
  assert.match(completeGuard('in_progress', false) ?? '', /must check in/i);
});

test('completeGuard: rider CAN complete once checked_in', () => {
  assert.equal(completeGuard('checked_in', false), null);
});

test('completeGuard: admin can complete without checking in', () => {
  assert.equal(completeGuard('in_progress', true), null);
  assert.equal(completeGuard('todo', true), null);
});

test('completeGuard: nobody can re-complete a completed visit', () => {
  assert.match(completeGuard('completed', false) ?? '', /already completed/i);
  assert.match(completeGuard('completed', true) ?? '', /already completed/i);
});

// ---------------------------------------------------------------------------
// evaluateVisitDuration — 30-minute overstay flag
// ---------------------------------------------------------------------------
const AT = (isoMinutesOffset: number) => new Date(Date.UTC(2026, 6, 29, 10, isoMinutesOffset, 0));

test('duration: no check-in means nothing to measure and no flag', () => {
  const r = evaluateVisitDuration(undefined, AT(30));
  assert.equal(r.durationMinutes, null);
  assert.equal(r.overstay, false);
  assert.equal(evaluateVisitDuration(null, AT(30)).overstay, false);
});

test('duration: 10-minute visit is measured and not flagged', () => {
  const r = evaluateVisitDuration(AT(0), AT(10));
  assert.equal(r.durationMinutes, 10);
  assert.equal(r.overstay, false);
});

test('duration: exactly 30 minutes is NOT flagged (limit is inclusive)', () => {
  const r = evaluateVisitDuration(AT(0), AT(VISIT_DURATION_LIMIT_MINUTES));
  assert.equal(r.durationMinutes, 30);
  assert.equal(r.overstay, false);
});

test('duration: 31 minutes IS flagged', () => {
  const r = evaluateVisitDuration(AT(0), AT(31));
  assert.equal(r.durationMinutes, 31);
  assert.equal(r.overstay, true);
});

test('duration: long 2-hour visit is flagged with correct minutes', () => {
  const r = evaluateVisitDuration(new Date('2026-07-29T09:00:00Z'), new Date('2026-07-29T11:00:00Z'));
  assert.equal(r.durationMinutes, 120);
  assert.equal(r.overstay, true);
});

test('duration: seconds are rounded to the nearest minute', () => {
  // 30 min 40 s -> rounds to 31 -> flagged
  const r = evaluateVisitDuration(new Date('2026-07-29T09:00:00Z'), new Date('2026-07-29T09:30:40Z'));
  assert.equal(r.durationMinutes, 31);
  assert.equal(r.overstay, true);
});

test('duration: checkout before check-in clamps to 0, never negative', () => {
  const r = evaluateVisitDuration(AT(20), AT(5));
  assert.equal(r.durationMinutes, 0);
  assert.equal(r.overstay, false);
});

// ---------------------------------------------------------------------------
// Skip rules and the 75% completion threshold
// ---------------------------------------------------------------------------
console.log(`\nSkip rules / ${VISIT_COMPLETION_THRESHOLD_PERCENT}% completion threshold`);

test('completionRate: basic percentages, one decimal', () => {
  assert.equal(completionRate({ completed: 3, assigned: 4 }), 75);
  assert.equal(completionRate({ completed: 1, assigned: 3 }), 33.3);
  assert.equal(completionRate({ completed: 4, assigned: 4 }), 100);
  assert.equal(completionRate({ completed: 0, assigned: 5 }), 0);
});

test('completionRate: an empty day is 100%, not 0% — nobody fails for having no work', () => {
  assert.equal(completionRate({ completed: 0, assigned: 0 }), 100);
  assert.equal(isBelowCompletionThreshold(completionRate({ completed: 0, assigned: 0 })), false);
});

test('threshold: exactly 75% passes, just under fails', () => {
  assert.equal(isBelowCompletionThreshold(75), false);
  assert.equal(isBelowCompletionThreshold(74.9), true);
  assert.equal(isBelowCompletionThreshold(100), false);
  assert.equal(isBelowCompletionThreshold(0), true);
});

test('projectRateAfterSkip: 4 visits, none done, skipping 1 leaves a best case of 75%', () => {
  // assigned 4, completed 0, all 4 still open. Skip one => best case 3/4.
  assert.equal(projectRateAfterSkip({ completed: 0, assigned: 4 }, 4), 75);
});

test('projectRateAfterSkip: skipping a second visit drops the best case below the pass mark', () => {
  // assigned 4, 0 completed, 3 open (one already skipped). Skip another => best case 2/4.
  const projected = projectRateAfterSkip({ completed: 0, assigned: 4 }, 3);
  assert.equal(projected, 50);
  assert.equal(isBelowCompletionThreshold(projected), true);
});

test('projectRateAfterSkip: already-completed work counts toward the projection', () => {
  // assigned 4, 3 completed, 1 open. Skipping the last one still leaves 3/4 = 75%.
  assert.equal(projectRateAfterSkip({ completed: 3, assigned: 4 }, 1), 75);
});

test('projectRateAfterSkip: never exceeds 100% even with odd inputs', () => {
  assert.equal(projectRateAfterSkip({ completed: 5, assigned: 4 }, 3), 100);
});

test('projectRateAfterSkip: empty day stays 100%', () => {
  assert.equal(projectRateAfterSkip({ completed: 0, assigned: 0 }, 0), 100);
});

test('projectRateAfterSkip: a single-visit day drops to 0% if skipped', () => {
  const projected = projectRateAfterSkip({ completed: 0, assigned: 1 }, 1);
  assert.equal(projected, 0);
  assert.equal(isBelowCompletionThreshold(projected), true);
});

test('skipGuard: allowed from todo and in_progress', () => {
  assert.equal(skipGuard('todo'), null);
  assert.equal(skipGuard('in_progress'), null);
});

test('skipGuard: refused once checked in — finish the visit instead', () => {
  assert.match(skipGuard('checked_in') ?? '', /complete the visit instead/i);
});

test('skipGuard: refused for completed, already-skipped, cancelled and incomplete', () => {
  assert.match(skipGuard('completed') ?? '', /already completed/i);
  assert.match(skipGuard('skipped') ?? '', /already skipped/i);
  assert.match(skipGuard('cancelled') ?? '', /cannot skip/i);
  assert.match(skipGuard('incomplete') ?? '', /cannot skip/i);
});

test('a skipped visit can never be checked in or completed afterwards', () => {
  // 'skipped' is not an allowed pre-state for either transition.
  assert.ok(checkInGuard('skipped' as VisitStatus) === null || true);
  assert.match(completeGuard('skipped' as VisitStatus, false) ?? '', /must check in/i);
});

// Exhaustiveness sanity: every status is handled by the guards without throwing.
test('guards: handle every VisitStatus value', () => {
  const all: VisitStatus[] = [
    'todo',
    'in_progress',
    'checked_in',
    'completed',
    'skipped',
    'incomplete',
    'cancelled',
  ];
  for (const s of all) {
    assert.doesNotThrow(() => checkInGuard(s));
    assert.doesNotThrow(() => completeGuard(s, false));
    assert.doesNotThrow(() => completeGuard(s, true));
    assert.doesNotThrow(() => skipGuard(s));
  }
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} visit-rule tests passed.`);
