/**
 * Unit tests for the region-sales day/timezone/city helpers.
 * Run with: npm run test:region-sales
 */
import assert from 'node:assert/strict';
import {
  REPORT_TIMEZONE,
  UNASSIGNED_REGION,
  isValidDayKey,
  localDayRangeUtc,
  localDayKey,
  eachDayKey,
  dayRangeLength,
  normalizeCityKey,
  regionLabel,
} from './region-sales.rules';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------------------
console.log(`Day keys (timezone: ${REPORT_TIMEZONE})`);
// ---------------------------------------------------------------------------
test('isValidDayKey accepts YYYY-MM-DD and rejects anything else', () => {
  assert.equal(isValidDayKey('2026-07-31'), true);
  assert.equal(isValidDayKey('2026-01-01'), true);
  assert.equal(isValidDayKey('2026-7-31'), false);
  assert.equal(isValidDayKey('31-07-2026'), false);
  assert.equal(isValidDayKey('2026-13-01'), false);
  assert.equal(isValidDayKey('2026-07'), false);
  assert.equal(isValidDayKey(''), false);
});

test('isValidDayKey rejects impossible calendar dates', () => {
  assert.equal(isValidDayKey('2026-02-30'), false);
  assert.equal(isValidDayKey('2026-02-29'), false, '2026 is not a leap year');
  assert.equal(isValidDayKey('2028-02-29'), true, '2028 is a leap year');
  assert.equal(isValidDayKey('2026-04-31'), false);
});

// ---------------------------------------------------------------------------
console.log('\nLocal day → UTC range (the bug this feature exists to avoid)');
// ---------------------------------------------------------------------------
test('a Karachi day starts at 19:00Z the previous day and ends 18:59:59.999Z', () => {
  const { start, end } = localDayRangeUtc('2026-07-31', 'Asia/Karachi');
  assert.equal(start.toISOString(), '2026-07-30T19:00:00.000Z');
  assert.equal(end.toISOString(), '2026-07-31T18:59:59.999Z');
});

test('an order at 02:00 PKT belongs to that PKT day, not the previous UTC day', () => {
  // 2026-07-31T21:00Z is 2026-08-01 02:00 in Karachi.
  const earlyMorningPkt = new Date('2026-07-31T21:00:00.000Z');
  assert.equal(localDayKey(earlyMorningPkt, 'Asia/Karachi'), '2026-08-01');
  // Under plain UTC bucketing it would have been mis-filed on 2026-07-31:
  assert.equal(earlyMorningPkt.toISOString().slice(0, 10), '2026-07-31');

  // And the range for Aug 1 must actually contain it.
  const aug1 = localDayRangeUtc('2026-08-01', 'Asia/Karachi');
  assert.ok(earlyMorningPkt >= aug1.start && earlyMorningPkt <= aug1.end);
  // ...while Jul 31's range must not.
  const jul31 = localDayRangeUtc('2026-07-31', 'Asia/Karachi');
  assert.ok(earlyMorningPkt > jul31.end);
});

test('an order at 23:30 PKT stays on that same PKT day', () => {
  // 2026-07-31T18:30Z = 2026-07-31 23:30 PKT.
  const lateNight = new Date('2026-07-31T18:30:00.000Z');
  assert.equal(localDayKey(lateNight, 'Asia/Karachi'), '2026-07-31');
  const jul31 = localDayRangeUtc('2026-07-31', 'Asia/Karachi');
  assert.ok(lateNight >= jul31.start && lateNight <= jul31.end);
});

test('the range is contiguous — one day ends 1ms before the next begins', () => {
  const a = localDayRangeUtc('2026-07-31', 'Asia/Karachi');
  const b = localDayRangeUtc('2026-08-01', 'Asia/Karachi');
  assert.equal(b.start.getTime() - a.end.getTime(), 1);
});

test('UTC as the timezone gives plain UTC midnight boundaries', () => {
  const { start, end } = localDayRangeUtc('2026-07-31', 'UTC');
  assert.equal(start.toISOString(), '2026-07-31T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-07-31T23:59:59.999Z');
});

test('a DST-observing zone still yields a 1ms-contiguous, correctly offset day', () => {
  // New York in July is UTC-4.
  const { start, end } = localDayRangeUtc('2026-07-31', 'America/New_York');
  assert.equal(start.toISOString(), '2026-07-31T04:00:00.000Z');
  assert.equal(end.toISOString(), '2026-08-01T03:59:59.999Z');
  // In January it is UTC-5 — proves the offset is derived, not hardcoded.
  const winter = localDayRangeUtc('2026-01-15', 'America/New_York');
  assert.equal(winter.start.toISOString(), '2026-01-15T05:00:00.000Z');
});

test('the spring-forward day is still bounded correctly', () => {
  // 2026-03-08 is the US DST transition; the local day is only 23h long.
  const { start, end } = localDayRangeUtc('2026-03-08', 'America/New_York');
  assert.equal(start.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(end.toISOString(), '2026-03-09T03:59:59.999Z');
  const hours = (end.getTime() + 1 - start.getTime()) / 3_600_000;
  assert.equal(hours, 23, 'spring-forward day is 23 hours');
});

test('localDayRangeUtc rejects a malformed day', () => {
  assert.throws(() => localDayRangeUtc('2026-13-01'), /Invalid day/);
  assert.throws(() => localDayRangeUtc('nonsense'), /Invalid day/);
});

// ---------------------------------------------------------------------------
console.log('\nDense day series');
// ---------------------------------------------------------------------------
test('eachDayKey is inclusive of both ends', () => {
  assert.deepEqual(eachDayKey('2026-07-29', '2026-08-01'), [
    '2026-07-29',
    '2026-07-30',
    '2026-07-31',
    '2026-08-01',
  ]);
});

test('eachDayKey handles a single day and a year boundary', () => {
  assert.deepEqual(eachDayKey('2026-07-31', '2026-07-31'), ['2026-07-31']);
  assert.deepEqual(eachDayKey('2025-12-30', '2026-01-02'), [
    '2025-12-30',
    '2025-12-31',
    '2026-01-01',
    '2026-01-02',
  ]);
});

test('eachDayKey handles a leap day', () => {
  assert.deepEqual(eachDayKey('2028-02-28', '2028-03-01'), [
    '2028-02-28',
    '2028-02-29',
    '2028-03-01',
  ]);
});

test('a reversed range yields an empty series rather than looping forever', () => {
  assert.deepEqual(eachDayKey('2026-08-01', '2026-07-01'), []);
  assert.equal(dayRangeLength('2026-08-01', '2026-07-01'), 0);
});

test('dayRangeLength counts inclusively', () => {
  assert.equal(dayRangeLength('2026-07-01', '2026-07-31'), 31);
  assert.equal(dayRangeLength('2026-07-31', '2026-07-31'), 1);
});

// ---------------------------------------------------------------------------
console.log('\nCity / region normalization');
// ---------------------------------------------------------------------------
test('case and whitespace variants collapse to one region key', () => {
  const key = normalizeCityKey('Lahore');
  assert.equal(normalizeCityKey('lahore'), key);
  assert.equal(normalizeCityKey('LAHORE'), key);
  assert.equal(normalizeCityKey('  Lahore  '), key);
  assert.equal(key, 'lahore');
});

test('different cities keep different keys', () => {
  assert.notEqual(normalizeCityKey('Lahore'), normalizeCityKey('Karachi'));
});

test('missing, blank and whitespace-only cities all map to the Unassigned bucket', () => {
  assert.equal(normalizeCityKey(undefined), '');
  assert.equal(normalizeCityKey(null), '');
  assert.equal(normalizeCityKey(''), '');
  assert.equal(normalizeCityKey('   '), '');
});

test('regionLabel keeps the original casing but names the empty bucket', () => {
  assert.equal(regionLabel('Lahore'), 'Lahore');
  assert.equal(regionLabel('  Lahore  '), 'Lahore');
  assert.equal(regionLabel(''), UNASSIGNED_REGION);
  assert.equal(regionLabel(undefined), UNASSIGNED_REGION);
  assert.equal(regionLabel('   '), UNASSIGNED_REGION);
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} region-sales rule tests passed.`);
