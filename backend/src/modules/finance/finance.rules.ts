/**
 * Pure, side-effect-free rules for the Accounts & Finance module.
 *
 * Kept free of Mongoose and IO for the same reason `collections.rules.ts` is: the parts most
 * likely to be quietly wrong — which side of a report an account lands on, and which way its
 * balance signs — can then be unit-tested in isolation (`finance.rules.test.ts`).
 *
 * Nothing here reads the database. Everything here is a decision the whole module depends on.
 */

import { badRequest } from '../../utils/app-error';
import { round2 } from '../region-sales/region-sales.rules';

export { round2 };

/** Half a paisa. The same tolerance the collections module already compares money with. */
export const MONEY_EPSILON = 0.005;

// ---------------------------------------------------------------------------
// Account type
// ---------------------------------------------------------------------------

/**
 * The five classifications, and the correction that unblocks every financial statement.
 *
 * The client's v1.0 spec carried only `nature: DEBIT | CREDIT`. That cannot classify: Cash and
 * Fuel Expense are both debit-natured, but one belongs on the Balance Sheet and the other on
 * the P&L. With only a debit/credit flag, neither statement can be assembled — which is why
 * v1.0's own report section quietly asks for "Income or Expense" and "Asset / Liability /
 * Equity" labels its schema never defines.
 */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type NormalBalance = 'debit' | 'credit';

/**
 * Normal balance is DERIVED from the type, never stored and never chosen by hand.
 *
 * v1.0 has an admin pick it at group creation. That is one dropdown away from a balance sheet
 * that renders upside down, with no error anywhere to explain why. The accountant chooses what
 * an account *is*; the system decides which way it signs.
 */
const NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
  expense: 'debit',
};

export function normalBalanceFor(type: AccountType): NormalBalance {
  return NORMAL_BALANCE[type];
}

/** Types that carry forward across a year end and appear on the Balance Sheet. */
export function isBalanceSheetType(type: AccountType): boolean {
  return type === 'asset' || type === 'liability' || type === 'equity';
}

/** Types closed to Retained Earnings at year end, and shown on the Profit & Loss. */
export function isProfitAndLossType(type: AccountType): boolean {
  return type === 'income' || type === 'expense';
}

/**
 * A ledger's balance in its own natural direction, as a positive number for a normal balance.
 *
 * An asset with more debits than credits returns positive; so does a liability with more
 * credits than debits. A negative result therefore means something genuinely unusual — a bank
 * account overdrawn, a customer in credit — which is exactly what a report should highlight
 * rather than hide behind an absolute value.
 */
export function naturalBalance(
  type: AccountType,
  debitTotal: number,
  creditTotal: number,
): number {
  const net = round2(debitTotal - creditTotal);
  return normalBalanceFor(type) === 'debit' ? net : round2(-net);
}

/**
 * Which Trial Balance column a natural balance belongs in.
 *
 * A ledger sitting the wrong way round (an overdrawn bank) reports on the opposite side rather
 * than as a negative number in its usual column. That is what an accountant expects, and it is
 * what keeps the two column totals equal.
 */
export function trialBalanceColumns(
  type: AccountType,
  debitTotal: number,
  creditTotal: number,
): { debit: number; credit: number } {
  const net = round2(debitTotal - creditTotal);
  if (Math.abs(net) < MONEY_EPSILON) return { debit: 0, credit: 0 };
  return net > 0 ? { debit: net, credit: 0 } : { debit: 0, credit: round2(-net) };
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * Numeric code blocks, one per type.
 *
 * v1.0 proposed a flat `AC-1001` sequence. Replaced because an accountant reading a trial
 * balance expects the code itself to say where a line sits — 1xxx is an asset, 5xxx is a cost
 * of sale — and a flat sequence throws that information away. Suspense sits at 9xxx and is
 * allowed for any type, because a suspense account is by definition unclassified until someone
 * works out what it was.
 */
export const CODE_BLOCKS: Record<AccountType, { min: number; max: number }> = {
  asset: { min: 1000, max: 1999 },
  liability: { min: 2000, max: 2999 },
  equity: { min: 3000, max: 3999 },
  income: { min: 4000, max: 4999 },
  // Cost of sales (5xxx) and operating expenses (6xxx) are both expense-typed. Kept as one
  // block rather than two types: the distinction matters for the P&L layout, which reads the
  // group tree, not for how the amount signs.
  expense: { min: 5000, max: 6999 },
};

const SUSPENSE_BLOCK = { min: 9000, max: 9999 };

export function isCodeInBlock(code: string, type: AccountType): boolean {
  const n = Number(code);
  if (!Number.isInteger(n)) return false;
  if (n >= SUSPENSE_BLOCK.min && n <= SUSPENSE_BLOCK.max) return true;
  const block = CODE_BLOCKS[type];
  return n >= block.min && n <= block.max;
}

/** Throws a message an admin can act on, naming the block the type belongs in. */
export function assertCodeInBlock(code: string, type: AccountType): void {
  if (!/^\d{4}$/.test(code)) {
    throw badRequest('A ledger code must be exactly four digits, for example 1110.');
  }
  if (!isCodeInBlock(code, type)) {
    const block = CODE_BLOCKS[type];
    throw badRequest(
      `Code ${code} does not belong to a ${type} account. `
        + `Use ${block.min}–${block.max}, or the ${SUSPENSE_BLOCK.min}–${SUSPENSE_BLOCK.max} suspense block.`,
    );
  }
}

/**
 * The next free code in a type's block, given the codes already taken.
 *
 * Steps by 10, not by 1. Charts of accounts are read as an outline and get inserted into for
 * years; leaving nine slots between siblings means a new account can sit where it belongs
 * instead of at the end. Falls back to filling gaps by 1 once the tens are exhausted.
 */
export function nextCodeInBlock(type: AccountType, taken: readonly string[]): string {
  const block = CODE_BLOCKS[type];
  const used = new Set(taken.map((c) => Number(c)).filter(Number.isInteger));

  for (let n = block.min + 100; n <= block.max; n += 10) {
    if (!used.has(n)) return String(n);
  }
  for (let n = block.min + 1; n <= block.max; n += 1) {
    if (!used.has(n)) return String(n);
  }
  throw badRequest(`Every code in the ${type} block (${block.min}–${block.max}) is in use.`);
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

/**
 * Report rendering, indentation and the recursive rollup all get materially more expensive
 * past four levels, and no distribution business needs a fifth.
 */
export const MAX_GROUP_DEPTH = 4;

export function assertDepthWithinLimit(depth: number): void {
  if (depth > MAX_GROUP_DEPTH) {
    throw badRequest(
      `Account groups may nest ${MAX_GROUP_DEPTH} levels deep. Add the ledger to an existing group instead.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Control accounts
// ---------------------------------------------------------------------------

/**
 * A control account holds the total of a subledger whose detail lives in an operational
 * module: receivables per shop, payables per supplier, cash per rider, stock per warehouse.
 *
 * The rule that makes it worth having: a manual journal entry may never post to one. Manual
 * adjustments to receivables or inventory are precisely how a control account stops agreeing
 * with the module it is supposed to mirror, and the nightly reconciliation then reports a drift
 * nobody can trace to a document.
 */
export const SUBLEDGER_TYPES = ['dealer', 'vendor', 'rider', 'warehouse', 'employee'] as const;

export type SubledgerType = (typeof SUBLEDGER_TYPES)[number];

export function assertControlConfigIsCoherent(
  isControl: boolean,
  subledgerType: string | null | undefined,
): void {
  if (isControl && !subledgerType) {
    throw badRequest('A control ledger must say which subledger it summarises.');
  }
  if (!isControl && subledgerType) {
    throw badRequest(
      'Only a control ledger can have a subledger. Tick "control account" or clear the subledger.',
    );
  }
  if (subledgerType && !(SUBLEDGER_TYPES as readonly string[]).includes(subledgerType)) {
    throw badRequest(`"${subledgerType}" is not a subledger this system keeps.`);
  }
}
