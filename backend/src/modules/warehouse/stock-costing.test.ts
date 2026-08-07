/**
 * Weighted-average cost rules. Pure arithmetic, no database.
 *
 * Run with: npm run test:stock-costing
 */
import assert from 'node:assert/strict';
import { weightedAverageCost, averageCostFromReceipts, roundCost } from './stock-costing';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

/** Every ordering of `rows`, for the order-independence check. */
function permutations<T>(rows: T[]): T[][] {
  if (rows.length <= 1) return [rows];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const rest = [...rows.slice(0, i), ...rows.slice(i + 1)];
    for (const p of permutations(rest)) out.push([rows[i], ...p]);
  }
  return out;
}

// eslint-disable-next-line no-console
console.log('Incremental preview (weightedAverageCost)');

test('the first receipt sets the average outright', () => {
  assert.equal(weightedAverageCost({ qty: 0, avgCost: 0 }, { qty: 10, rate: 50 }), 50);
});

test('100 @ 10 then 100 @ 20 averages to 15', () => {
  assert.equal(weightedAverageCost({ qty: 100, avgCost: 10 }, { qty: 100, rate: 20 }), 15);
});

test('zero prior stock with a stale average uses the new rate, not a blend', () => {
  // Blending against stock that no longer exists would carry a phantom weight forwards.
  assert.equal(weightedAverageCost({ qty: 0, avgCost: 99 }, { qty: 5, rate: 20 }), 20);
});

test('an unpriced opening balance is replaced, not averaged down', () => {
  // 100 pieces at cost 0 + 10 @ 50 would give 4.55 — wildly wrong, and it would understate COGS
  // for the next 100 sales. The first real receipt sets the basis instead.
  assert.equal(weightedAverageCost({ qty: 100, avgCost: 0 }, { qty: 10, rate: 50 }), 50);
});

test('negative prior stock (mirror drift) clamps to empty', () => {
  assert.equal(weightedAverageCost({ qty: -40, avgCost: 10 }, { qty: 10, rate: 30 }), 30);
});

test('a zero-quantity receipt leaves the average alone', () => {
  assert.equal(weightedAverageCost({ qty: 50, avgCost: 12 }, { qty: 0, rate: 999 }), 12);
});

test('a negative rate is ignored rather than trusted', () => {
  assert.equal(weightedAverageCost({ qty: 50, avgCost: 12 }, { qty: 5, rate: -3 }), 12);
});

test('the result is never NaN, whatever the inputs', () => {
  const values = [
    weightedAverageCost({ qty: 0, avgCost: 0 }, { qty: 0, rate: 0 }),
    weightedAverageCost({ qty: NaN, avgCost: NaN }, { qty: 1, rate: 5 }),
    weightedAverageCost({ qty: 10, avgCost: 10 }, { qty: NaN, rate: NaN }),
  ];
  for (const v of values) assert.ok(Number.isFinite(v), `got ${v}`);
});

// eslint-disable-next-line no-console
console.log('\nAuthoritative average (averageCostFromReceipts)');

test('no priced receipts means cost basis unknown, reported as 0', () => {
  assert.equal(averageCostFromReceipts([]), 0);
  assert.equal(averageCostFromReceipts([{ qty: 10, rate: 0 }]), 0);
});

test('one receipt returns its rate', () => {
  assert.equal(averageCostFromReceipts([{ qty: 7, rate: 42 }]), 42);
});

test('weights by quantity, not by receipt count', () => {
  // 900 pieces at 10 and 100 at 20 → 11, not 15.
  assert.equal(averageCostFromReceipts([{ qty: 900, rate: 10 }, { qty: 100, rate: 20 }]), 11);
});

test('a free sample at rate 0 is excluded — it would otherwise crater the average', () => {
  assert.equal(averageCostFromReceipts([{ qty: 100, rate: 20 }, { qty: 900, rate: 0 }]), 20);
});

test('non-positive quantities are ignored', () => {
  assert.equal(averageCostFromReceipts([{ qty: 10, rate: 20 }, { qty: -5, rate: 100 }]), 20);
});

test('the result is order-independent — every permutation agrees', () => {
  const rows = [
    { qty: 30, rate: 12 },
    { qty: 45, rate: 18.5 },
    { qty: 7, rate: 200 },
    { qty: 120, rate: 9.25 },
  ];
  const expected = averageCostFromReceipts(rows);
  for (const p of permutations(rows)) {
    assert.equal(averageCostFromReceipts(p), expected);
  }
});

test('it matches what the incremental fold converges to', () => {
  const rows = [
    { qty: 30, rate: 12 },
    { qty: 45, rate: 18.5 },
    { qty: 7, rate: 200 },
    { qty: 120, rate: 9.25 },
  ];
  let qty = 0;
  let avg = 0;
  for (const row of rows) {
    avg = weightedAverageCost({ qty, avgCost: avg }, row);
    qty += row.qty;
  }
  // Within a rounding step — the fold rounds at every stage, the closed form only once.
  assert.ok(
    Math.abs(avg - averageCostFromReceipts(rows)) < 0.01,
    `fold ${avg} vs closed form ${averageCostFromReceipts(rows)}`,
  );
});

test('500 sequential receipts do not drift away from the exact value', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ qty: 3, rate: 10 + (i % 7) * 0.37 }));
  const exact =
    rows.reduce((s, r) => s + r.qty * r.rate, 0) / rows.reduce((s, r) => s + r.qty, 0);
  assert.ok(Math.abs(averageCostFromReceipts(rows) - exact) < 0.0001);
});

test('removing a reversed receipt from the input is all a reversal needs', () => {
  // This is why the closed form is the authoritative writer: a cancelled receipt is simply
  // excluded, whereas running the incremental formula backwards is not invertible.
  const all = [{ qty: 100, rate: 10 }, { qty: 100, rate: 30 }, { qty: 100, rate: 20 }];
  assert.equal(averageCostFromReceipts(all), 20);
  const withoutMiddle = [all[0], all[2]];
  assert.equal(averageCostFromReceipts(withoutMiddle), 15);
});

test('rounding is to 4 decimal places', () => {
  assert.equal(roundCost(1 / 3), 0.3333);
  assert.equal(averageCostFromReceipts([{ qty: 3, rate: 1 }, { qty: 4, rate: 2 }]), 1.5714);
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} stock-costing tests passed.`);
