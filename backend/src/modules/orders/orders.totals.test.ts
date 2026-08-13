/**
 * Unit tests for the pure order totals math (per-line + order-level discounts).
 *
 * No test framework is configured in this project, so this runs as a plain
 * ts-node script using Node's built-in `assert`. Run with:
 *   npm run test:orders:totals
 * It exits non-zero on the first failed assertion.
 */
import assert from 'node:assert/strict';
import { clampLineDiscount, computeOrderTotals } from './orders.totals';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

test('no discounts anywhere: grandTotal equals the gross total', () => {
  const t = computeOrderTotals([
    { quantity: 2, price: 100 },
    { quantity: 3, price: 50 },
  ]);
  assert.equal(t.totalPrice, 350);
  assert.equal(t.itemsDiscountTotal, 0);
  assert.equal(t.grandTotal, 350);
  assert.deepEqual(t.lineDiscounts, [0, 0]);
});

test('line discounts and the order-level discount both reduce grandTotal', () => {
  const t = computeOrderTotals(
    [
      { quantity: 2, price: 100, discount: 30 },
      { quantity: 1, price: 50, discount: 10 },
    ],
    15,
  );
  assert.equal(t.totalPrice, 250);
  assert.equal(t.itemsDiscountTotal, 40);
  assert.equal(t.grandTotal, 195);
  assert.deepEqual(t.lineDiscounts, [30, 10]);
});

test('a line discount larger than its subtotal is clamped to the subtotal', () => {
  assert.equal(clampLineDiscount({ quantity: 2, price: 100, discount: 500 }), 200);
  const t = computeOrderTotals([{ quantity: 2, price: 100, discount: 500 }]);
  assert.equal(t.itemsDiscountTotal, 200);
  assert.equal(t.grandTotal, 0);
  assert.deepEqual(t.lineDiscounts, [200]);
});

test('negative amounts clamp to zero instead of inflating the total', () => {
  const t = computeOrderTotals([{ quantity: 1, price: 100, discount: -50 }], -20);
  assert.equal(t.itemsDiscountTotal, 0);
  assert.equal(t.grandTotal, 100);
  assert.deepEqual(t.lineDiscounts, [0]);
});

test('missing / non-finite discount values are treated as zero', () => {
  const t = computeOrderTotals(
    [
      { quantity: 1, price: 100 },
      { quantity: 1, price: 100, discount: null },
      { quantity: 1, price: 100, discount: Number.NaN },
    ],
    undefined,
  );
  assert.equal(t.totalPrice, 300);
  assert.equal(t.itemsDiscountTotal, 0);
  assert.equal(t.grandTotal, 300);
});

test('grandTotal only counts the clamped line discounts', () => {
  const t = computeOrderTotals(
    [
      { quantity: 1, price: 100, discount: 25 },
      { quantity: 1, price: 100, discount: 999 },
    ],
    10,
  );
  assert.equal(t.grandTotal, 200 - 125 - 10);
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} order-totals tests passed.`);
