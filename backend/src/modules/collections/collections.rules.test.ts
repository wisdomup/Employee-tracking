/**
 * Unit tests for the delivery-collection money helpers.
 * Run with: npm run test:collections
 */
import assert from 'node:assert/strict';
import {
  round2,
  moneyEquals,
  validateCollectionSplit,
  deriveOrderPaymentType,
  derivePaidAmount,
  validateRecoveryAmount,
  validateSettlementAmount,
} from './collections.rules';
import { normalizeCityKey } from '../region-sales/region-sales.rules';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

/** Asserts `fn` throws, and that the message contains `fragment` — the rider reads it. */
function throwsWith(fn: () => unknown, fragment: string, label: string): void {
  assert.throws(
    fn,
    (err: unknown) => {
      const message = (err as Error).message ?? '';
      assert.ok(
        message.includes(fragment),
        `${label}: expected message to contain "${fragment}", got "${message}"`,
      );
      return true;
    },
    label,
  );
}

// ---------------------------------------------------------------------------
console.log('Money rounding');
// ---------------------------------------------------------------------------
test('round2 kills float artefacts', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(12000), 12000);
  assert.equal(round2(7000.004), 7000);
  assert.equal(round2(7000.006), 7000.01);
  assert.equal(round2(-0.001), -0);
});

test('round2 rounds the STORED float, so exact-half decimals are not all treated alike', () => {
  // Documented, not fixed. `Math.round(v * 100) / 100` is the rule the rest of the app
  // already rounds money by, and one consistent rule beats two correct-looking ones.
  // Whether a "…5" decimal goes up or down depends on which side of the boundary its
  // binary representation lands on after the *100:
  assert.equal(round2(1.005), 1, '1.005 stores as 1.00499… → 100.49999… → down');
  assert.equal(round2(1.015), 1.01, 'stores below the boundary → down');
  assert.equal(round2(1.025), 1.02, 'stores below the boundary → down');
  assert.equal(round2(2.675), 2.68, 'stores at exactly 267.5 → half-up');
  assert.equal(round2(1.045), 1.05, 'stores at exactly 104.5 → half-up');

  // What this means in practice: the worst-case error on a single figure is one paisa, which
  // is why the split invariant compares with MONEY_EPSILON instead of ===.
  for (const v of [1.005, 1.015, 1.025, 2.675, 1.045]) {
    assert.ok(Math.abs(round2(v) - v) <= 0.01, `round2(${v}) drifts by at most a paisa`);
  }
});

test('moneyEquals tolerates float drift but not a real difference', () => {
  assert.equal(moneyEquals(0.1 + 0.2, 0.3), true);
  assert.equal(moneyEquals(12000, 12000.004), true);
  assert.equal(moneyEquals(12000, 12000.01), false);
  assert.equal(moneyEquals(12000, 11999.99), false);
});

// ---------------------------------------------------------------------------
console.log('\nSplit invariant (spec §4: Cash + Online + Credit = Order Amount)');
// ---------------------------------------------------------------------------
test('an exact three-way split is accepted', () => {
  const split = validateCollectionSplit({ cash: 7000, online: 3000, credit: 2000 }, 12000);
  assert.deepEqual(split, { cash: 7000, online: 3000, credit: 2000 });
});

test('a single-mode split is accepted for each of the three modes', () => {
  assert.deepEqual(validateCollectionSplit({ cash: 12000, online: 0, credit: 0 }, 12000), {
    cash: 12000, online: 0, credit: 0,
  });
  assert.deepEqual(validateCollectionSplit({ cash: 0, online: 12000, credit: 0 }, 12000), {
    cash: 0, online: 12000, credit: 0,
  });
  assert.deepEqual(validateCollectionSplit({ cash: 0, online: 0, credit: 12000 }, 12000), {
    cash: 0, online: 0, credit: 12000,
  });
});

test('two-mode partial splits are accepted', () => {
  assert.deepEqual(validateCollectionSplit({ cash: 5000, online: 0, credit: 7000 }, 12000), {
    cash: 5000, online: 0, credit: 7000,
  });
  assert.deepEqual(validateCollectionSplit({ cash: 0, online: 4500.5, credit: 7499.5 }, 12000), {
    cash: 0, online: 4500.5, credit: 7499.5,
  });
});

test('sub-paisa drift is absorbed, a real mismatch is refused', () => {
  // 0.004 under — float noise, must pass.
  assert.doesNotThrow(() =>
    validateCollectionSplit({ cash: 6999.998, online: 3000, credit: 2000 }, 12000),
  );
  // 0.01 under — a real typo, must fail.
  throwsWith(
    () => validateCollectionSplit({ cash: 6999.99, online: 3000, credit: 2000 }, 12000),
    'still unaccounted for',
    'one paisa short',
  );
});

test('an under-collection names the shortfall', () => {
  throwsWith(
    () => validateCollectionSplit({ cash: 7000, online: 3000, credit: 1000 }, 12000),
    'Rs. 1000 is still unaccounted for',
    'under by 1000',
  );
});

test('an over-collection says so explicitly rather than reporting a shortfall', () => {
  throwsWith(
    () => validateCollectionSplit({ cash: 7000, online: 3000, credit: 5000 }, 12000),
    'Rs. 3000 more than the order total',
    'over by 3000',
  );
});

test('negative components are refused by name', () => {
  throwsWith(
    () => validateCollectionSplit({ cash: -100, online: 12100, credit: 0 }, 12000),
    'Cash must be zero or a positive amount',
    'negative cash',
  );
  throwsWith(
    () => validateCollectionSplit({ cash: 12100, online: -100, credit: 0 }, 12000),
    'Online must be zero or a positive amount',
    'negative online',
  );
  throwsWith(
    () => validateCollectionSplit({ cash: 12100, online: 0, credit: -100 }, 12000),
    'Credit must be zero or a positive amount',
    'negative credit',
  );
});

test('non-numeric components are refused', () => {
  throwsWith(
    () => validateCollectionSplit({ cash: 'abc', online: 0, credit: 0 }, 12000),
    'Cash must be zero or a positive amount',
    'NaN cash',
  );
  throwsWith(
    () => validateCollectionSplit({ cash: undefined, online: 0, credit: 0 }, 12000),
    'Cash must be zero or a positive amount',
    'undefined cash',
  );
});

test('an order with no amount is refused with a rider-actionable message', () => {
  const expected = 'Ask an admin to fix the order';
  throwsWith(() => validateCollectionSplit({ cash: 0, online: 0, credit: 0 }, 0), expected, 'zero total');
  throwsWith(() => validateCollectionSplit({ cash: 0, online: 0, credit: 0 }, undefined), expected, 'missing total');
  throwsWith(() => validateCollectionSplit({ cash: 0, online: 0, credit: 0 }, null), expected, 'null total');
  throwsWith(() => validateCollectionSplit({ cash: 0, online: 0, credit: 0 }, -5), expected, 'negative total');
});

// ---------------------------------------------------------------------------
console.log('\nLegacy Order.paymentType / paidAmount derivation');
// ---------------------------------------------------------------------------
test('the largest component wins', () => {
  assert.equal(deriveOrderPaymentType({ cash: 7000, online: 3000, credit: 2000 }), 'cash');
  assert.equal(deriveOrderPaymentType({ cash: 2000, online: 7000, credit: 3000 }), 'online');
  assert.equal(deriveOrderPaymentType({ cash: 2000, online: 3000, credit: 7000 }), 'credit');
});

test('single-mode splits map to their own mode', () => {
  assert.equal(deriveOrderPaymentType({ cash: 12000, online: 0, credit: 0 }), 'cash');
  assert.equal(deriveOrderPaymentType({ cash: 0, online: 12000, credit: 0 }), 'online');
  assert.equal(deriveOrderPaymentType({ cash: 0, online: 0, credit: 12000 }), 'credit');
});

test('ties break deterministically: cash > online > credit', () => {
  assert.equal(deriveOrderPaymentType({ cash: 4000, online: 4000, credit: 4000 }), 'cash');
  assert.equal(deriveOrderPaymentType({ cash: 6000, online: 6000, credit: 0 }), 'cash');
  assert.equal(deriveOrderPaymentType({ cash: 0, online: 6000, credit: 6000 }), 'online');
  assert.equal(deriveOrderPaymentType({ cash: 6000, online: 0, credit: 6000 }), 'cash');
});

test('an all-zero split still returns a value rather than throwing', () => {
  // Unreachable through validateCollectionSplit, but deriveOrderPaymentType is also called
  // from the correction path and must never be the thing that throws.
  assert.equal(deriveOrderPaymentType({ cash: 0, online: 0, credit: 0 }), 'cash');
});

test('paidAmount counts collected money only — credit is a receivable, not a payment', () => {
  assert.equal(derivePaidAmount({ cash: 7000, online: 3000, credit: 2000 }), 10000);
  assert.equal(derivePaidAmount({ cash: 0, online: 0, credit: 12000 }), 0);
  assert.equal(derivePaidAmount({ cash: 12000, online: 0, credit: 0 }), 12000);
  assert.equal(derivePaidAmount({ cash: 0.1, online: 0.2, credit: 0 }), 0.3);
});

// ---------------------------------------------------------------------------
console.log('\nCredit recovery amount (spec §5)');
// ---------------------------------------------------------------------------
test('a recovery up to the outstanding balance is accepted', () => {
  assert.equal(validateRecoveryAmount(1500, 2000), 1500);
  assert.equal(validateRecoveryAmount(2000, 2000), 2000, 'settling in full is allowed');
  assert.equal(validateRecoveryAmount('1500', 2000), 1500, 'numeric strings from the body are coerced');
});

test('over-recovery is refused and names the real outstanding', () => {
  throwsWith(
    () => validateRecoveryAmount(3000, 2000),
    "pending credit is Rs. 2000",
    'over-recovery',
  );
});

test('a recovery against a client who owes nothing is refused', () => {
  throwsWith(() => validateRecoveryAmount(500, 0), 'no pending credit to recover', 'zero outstanding');
});

test('zero and negative recoveries are refused', () => {
  throwsWith(() => validateRecoveryAmount(0, 2000), 'greater than zero', 'zero');
  throwsWith(() => validateRecoveryAmount(-500, 2000), 'greater than zero', 'negative');
  throwsWith(() => validateRecoveryAmount('abc', 2000), 'greater than zero', 'NaN');
});

// ---------------------------------------------------------------------------
console.log('\nSettlement amount (spec §6)');
// ---------------------------------------------------------------------------
test('a settlement up to the available balance is accepted', () => {
  assert.equal(validateSettlementAmount(8000, 8500, 'cash'), 8000);
  assert.equal(validateSettlementAmount(8500, 8500, 'cash'), 8500, 'settling everything is allowed');
});

test('over-settlement is refused and names the cap', () => {
  throwsWith(
    () => validateSettlementAmount(1000, 500, 'cash'),
    'at most Rs. 500',
    'over-settle',
  );
});

test('a rider with nothing left to settle gets a mode-specific message', () => {
  throwsWith(() => validateSettlementAmount(100, 0, 'cash'), 'no cash left to hand over', 'cash exhausted');
  throwsWith(
    () => validateSettlementAmount(100, 0, 'online'),
    'no online collection left to settle',
    'online exhausted',
  );
});

test('zero and negative settlements are refused', () => {
  throwsWith(() => validateSettlementAmount(0, 8500, 'cash'), 'greater than zero', 'zero');
  throwsWith(() => validateSettlementAmount(-100, 8500, 'cash'), 'greater than zero', 'negative');
});

// ---------------------------------------------------------------------------
console.log('\nCity key normalisation (shared with region-sales)');
// ---------------------------------------------------------------------------
test('the collection module groups on the same key region-sales does', () => {
  // Grouping and filtering MUST use one key, or a grand total stops matching the sum of its
  // own city subtotals. This test exists to catch a future divergence.
  assert.equal(normalizeCityKey(' Lahore '), 'lahore');
  assert.equal(normalizeCityKey('LAHORE'), 'lahore');
  assert.equal(normalizeCityKey('lahore'), normalizeCityKey('Lahore'));
  assert.equal(normalizeCityKey(undefined), '');
  assert.equal(normalizeCityKey('   '), '');
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} collection rule tests passed.`);
