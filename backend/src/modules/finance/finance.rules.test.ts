/**
 * Pure-rule checks for the Accounts & Finance module. No database, no Express.
 *
 * These cover the decisions that are cheapest to get wrong and most expensive to discover late:
 * which way an account signs, which Trial Balance column it lands in, and whether a code belongs
 * to the type it claims. Every financial statement is built on top of these four functions.
 *
 * Run with: npm run test:finance
 */
import assert from 'node:assert/strict';

import {
  ACCOUNT_TYPES,
  AccountType,
  CODE_BLOCKS,
  MAX_GROUP_DEPTH,
  assertCodeInBlock,
  assertControlConfigIsCoherent,
  assertDepthWithinLimit,
  isBalanceSheetType,
  isCodeInBlock,
  isProfitAndLossType,
  naturalBalance,
  nextCodeInBlock,
  normalBalanceFor,
  trialBalanceColumns,
} from './finance.rules';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function throws(fn: () => unknown, match: RegExp): void {
  assert.throws(fn, (err: Error) => match.test(err.message), `expected a message matching ${match}`);
}

console.log('\nfinance.rules\n');

// ---------------------------------------------------------------------------
// Normal balance
// ---------------------------------------------------------------------------

test('every account type has a normal balance', () => {
  for (const type of ACCOUNT_TYPES) {
    assert.ok(['debit', 'credit'].includes(normalBalanceFor(type)), `${type} has no side`);
  }
});

test('assets and expenses are debit-natured; liabilities, equity and income are credit', () => {
  assert.equal(normalBalanceFor('asset'), 'debit');
  assert.equal(normalBalanceFor('expense'), 'debit');
  assert.equal(normalBalanceFor('liability'), 'credit');
  assert.equal(normalBalanceFor('equity'), 'credit');
  assert.equal(normalBalanceFor('income'), 'credit');
});

test('every type belongs to exactly one statement', () => {
  // The v1.0 spec could not do this at all: with only a debit/credit flag, Cash and Fuel
  // Expense are indistinguishable, so neither statement can be assembled.
  for (const type of ACCOUNT_TYPES) {
    const onBalanceSheet = isBalanceSheetType(type);
    const onProfitAndLoss = isProfitAndLossType(type);
    assert.notEqual(onBalanceSheet, onProfitAndLoss, `${type} is on both statements or neither`);
  }
});

// ---------------------------------------------------------------------------
// Natural balance
// ---------------------------------------------------------------------------

test('a debit-natured account reads positive when debits exceed credits', () => {
  assert.equal(naturalBalance('asset', 5000, 1200), 3800);
  assert.equal(naturalBalance('expense', 900.5, 0), 900.5);
});

test('a credit-natured account reads positive when credits exceed debits', () => {
  assert.equal(naturalBalance('liability', 1200, 5000), 3800);
  assert.equal(naturalBalance('income', 0, 42_500.75), 42_500.75);
});

test('an account sitting the wrong way round reads negative, it is not hidden', () => {
  // An overdrawn bank account is real and must be visible as such, not absolute-valued into
  // looking like a healthy balance.
  assert.equal(naturalBalance('asset', 100, 900), -800);
  assert.equal(naturalBalance('income', 500, 200), -300);
});

test('natural balance rounds to paisa rather than accumulating float error', () => {
  assert.equal(naturalBalance('asset', 0.1 + 0.2, 0), 0.3);
});

// ---------------------------------------------------------------------------
// Trial balance columns
// ---------------------------------------------------------------------------

test('a normal balance lands in its own column', () => {
  assert.deepEqual(trialBalanceColumns('asset', 5000, 1200), { debit: 3800, credit: 0 });
  assert.deepEqual(trialBalanceColumns('liability', 1200, 5000), { debit: 0, credit: 3800 });
});

test('a reversed balance reports on the opposite side, not as a negative', () => {
  // This is what keeps the two column totals equal. A negative in the usual column would break
  // the one property the Trial Balance exists to demonstrate.
  assert.deepEqual(trialBalanceColumns('asset', 100, 900), { debit: 0, credit: 800 });
});

test('a balance inside the money epsilon reports as flat in both columns', () => {
  assert.deepEqual(trialBalanceColumns('asset', 1000.002, 1000), { debit: 0, credit: 0 });
});

test('the trial balance is self-proving across a mixed set of accounts', () => {
  // The property the whole module rests on: summing both columns over every account must agree.
  const accounts: { type: AccountType; debit: number; credit: number }[] = [
    { type: 'asset', debit: 120_000, credit: 45_000 },
    { type: 'asset', debit: 8_000, credit: 12_500 },
    { type: 'liability', debit: 3_000, credit: 61_500 },
    { type: 'equity', debit: 0, credit: 50_000 },
    { type: 'income', debit: 1_200, credit: 90_000 },
    { type: 'expense', debit: 126_800, credit: 0 },
  ];
  // Debits 259,000 = credits 259,000. The `assert` below is not decoration: the first draft of
  // this fixture did not balance, and it would have proved nothing while looking convincing.
  const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
  const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);
  assert.equal(totalDebit, totalCredit, 'the fixture itself must balance');

  const columns = accounts.map((a) => trialBalanceColumns(a.type, a.debit, a.credit));
  const dr = columns.reduce((s, c) => s + c.debit, 0);
  const cr = columns.reduce((s, c) => s + c.credit, 0);
  assert.equal(dr, cr, `trial balance does not agree: ${dr} vs ${cr}`);
});

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

test('each type accepts its own block and refuses another type\'s', () => {
  assert.ok(isCodeInBlock('1110', 'asset'));
  assert.ok(isCodeInBlock('2110', 'liability'));
  assert.ok(isCodeInBlock('3130', 'equity'));
  assert.ok(isCodeInBlock('4110', 'income'));
  assert.ok(isCodeInBlock('5110', 'expense'));
  assert.ok(isCodeInBlock('6900', 'expense'), 'operating expenses share the expense block');

  assert.ok(!isCodeInBlock('4110', 'asset'));
  assert.ok(!isCodeInBlock('1110', 'income'));
});

test('the 9xxx suspense block is admitted for every type', () => {
  // 9110 Cash Difference is an expense; 9190 Suspense is an asset. Both live in the same block
  // because a suspense account is unclassified by definition.
  for (const type of ACCOUNT_TYPES) {
    assert.ok(isCodeInBlock('9110', type), `${type} should admit 9110`);
  }
});

test('a code must be exactly four digits', () => {
  throws(() => assertCodeInBlock('111', 'asset'), /four digits/);
  throws(() => assertCodeInBlock('11100', 'asset'), /four digits/);
  throws(() => assertCodeInBlock('AC-1001', 'asset'), /four digits/);
});

test('a wrong-block code names the block it should be in', () => {
  throws(() => assertCodeInBlock('4110', 'asset'), /1000–1999/);
});

test('the next free code steps by ten so accounts can be inserted later', () => {
  assert.equal(nextCodeInBlock('asset', []), '1100');
  assert.equal(nextCodeInBlock('asset', ['1100']), '1110');
  assert.equal(nextCodeInBlock('asset', ['1100', '1110', '1120']), '1130');
});

test('the next free code falls back to single steps once the tens are gone', () => {
  const tens: string[] = [];
  for (let n = CODE_BLOCKS.asset.min + 100; n <= CODE_BLOCKS.asset.max; n += 10) {
    tens.push(String(n));
  }
  assert.equal(nextCodeInBlock('asset', tens), '1001');
});

test('a suggested code always belongs to the block it was asked for', () => {
  for (const type of ACCOUNT_TYPES) {
    const code = nextCodeInBlock(type, []);
    assert.ok(isCodeInBlock(code, type), `${code} is not a valid ${type} code`);
  }
});

// ---------------------------------------------------------------------------
// Depth
// ---------------------------------------------------------------------------

test('groups nest to the documented depth and no further', () => {
  assertDepthWithinLimit(MAX_GROUP_DEPTH);
  throws(() => assertDepthWithinLimit(MAX_GROUP_DEPTH + 1), /levels deep/);
});

// ---------------------------------------------------------------------------
// Control accounts
// ---------------------------------------------------------------------------

test('a control account must name the subledger it summarises', () => {
  throws(() => assertControlConfigIsCoherent(true, null), /which subledger/);
  throws(() => assertControlConfigIsCoherent(true, undefined), /which subledger/);
});

test('a plain account may not carry a subledger', () => {
  throws(() => assertControlConfigIsCoherent(false, 'dealer'), /Only a control ledger/);
});

test('an unknown subledger is refused', () => {
  throws(() => assertControlConfigIsCoherent(true, 'supplier'), /not a subledger/);
});

test('the five real subledger pairings are accepted', () => {
  for (const t of ['dealer', 'vendor', 'rider', 'warehouse', 'employee']) {
    assertControlConfigIsCoherent(true, t);
  }
  assertControlConfigIsCoherent(false, null);
});

console.log(`\n  ${passed} checks passed\n`);
