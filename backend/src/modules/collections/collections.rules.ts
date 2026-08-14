/**
 * Pure, side-effect-free helpers for the delivery collection module.
 *
 * Kept free of Mongoose/IO for the same reason `region-sales.rules.ts` is: the parts most
 * likely to be quietly wrong — money arithmetic and the split invariant — can then be
 * unit-tested in isolation (see collections.rules.test.ts).
 *
 * The split invariant deliberately lives HERE rather than in a Mongoose `pre('validate')`
 * hook. A hook would surface as a generic Mongoose-worded ValidationError through the global
 * error handler, and this message is read by a rider standing in a shop.
 */

import { badRequest } from '../../utils/app-error';
import { round2 } from '../region-sales/region-sales.rules';

export { round2 };

export interface CollectionSplit {
  cash: number;
  online: number;
  credit: number;
}

/** Tolerance for float drift when comparing money. Half a paisa. */
const MONEY_EPSILON = 0.005;

/**
 * Spec §4: Cash + Online + Credit = Order Amount, with any partial split across all three.
 *
 * `orderAmount` must always come from `order.grandTotal` server-side — never from the request
 * body, or a rider could under-declare a collection by shrinking the total it is checked against.
 */
export function validateCollectionSplit(
  split: { cash: unknown; online: unknown; credit: unknown },
  orderAmount: unknown,
): CollectionSplit {
  const amount = round2(Number(orderAmount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest(
      'This order has no amount recorded. Ask an admin to fix the order before delivering it.',
    );
  }

  const parts: [string, number][] = [
    ['Cash', round2(Number(split.cash))],
    ['Online', round2(Number(split.online))],
    ['Credit', round2(Number(split.credit))],
  ];
  for (const [name, value] of parts) {
    if (!Number.isFinite(value) || value < 0) {
      throw badRequest(`${name} must be zero or a positive amount.`);
    }
  }

  const [, cash] = parts[0];
  const [, online] = parts[1];
  const [, credit] = parts[2];

  const entered = round2(cash + online + credit);
  if (Math.abs(entered - amount) >= MONEY_EPSILON) {
    const diff = round2(amount - entered);
    throw badRequest(
      diff > 0
        ? `Cash + Online + Credit is Rs. ${entered} but the order is Rs. ${amount}. Rs. ${diff} is still unaccounted for.`
        : `Cash + Online + Credit is Rs. ${entered}, which is Rs. ${round2(Math.abs(diff))} more than the order total of Rs. ${amount}.`,
    );
  }

  return { cash, online, credit };
}

/**
 * Collapse a three-way split into the legacy single-value `Order.paymentType`.
 *
 * LOSSY BY CONSTRUCTION — the DeliveryCollection doc is authoritative for the split. This
 * exists only so the pre-existing analytics KPIs (`collectionRatePercent`, `creditOrders` in
 * analytics.service.ts) keep reporting something sensible instead of regressing to zero.
 *
 * Consequence worth knowing before anyone files it as a bug: `creditOrders` now counts only
 * orders where credit is the LARGEST component, so a Rs. 12,000 order carrying Rs. 2,000 of
 * credit will not appear in it. The Collection Report's `credit` column is the real figure.
 *
 * Ties break cash > online > credit, deterministically.
 */
export function deriveOrderPaymentType(split: CollectionSplit): 'cash' | 'online' | 'credit' {
  if (split.cash >= split.online && split.cash >= split.credit) return 'cash';
  if (split.online >= split.credit) return 'online';
  return 'credit';
}

/**
 * What the order should record as paid. Credit is money NOT collected — it is a receivable, so
 * it must never land in `paidAmount` or the collection-rate KPI reads every credit sale as
 * fully paid.
 */
export function derivePaidAmount(split: CollectionSplit): number {
  return round2(split.cash + split.online);
}

/**
 * Guard for a recovery entry: an amount that is positive and no larger than what the dealer
 * actually owes. Over-recovery is refused rather than clamped — a rider who typed 15000 for
 * 1500 needs to see the error, not have it silently accepted as the full outstanding.
 */
export function validateRecoveryAmount(amount: unknown, outstanding: number): number {
  const value = round2(Number(amount));
  if (!Number.isFinite(value) || value <= 0) {
    throw badRequest('Enter an amount greater than zero.');
  }
  const cap = round2(outstanding);
  if (cap <= 0) {
    throw badRequest('This client has no pending credit to recover.');
  }
  if (value - cap >= MONEY_EPSILON) {
    throw badRequest(
      `This client's pending credit is Rs. ${cap}. You cannot record a recovery of Rs. ${value}.`,
    );
  }
  return value;
}

/**
 * Guard for a settlement submit. `available` is already net of anything the rider has queued
 * but the office has not yet confirmed — without that subtraction a rider could submit the same
 * balance three times over and the admin's pending queue would stop meaning anything.
 */
export function validateSettlementAmount(
  amount: unknown,
  available: number,
  mode: 'cash' | 'online',
): number {
  const value = round2(Number(amount));
  if (!Number.isFinite(value) || value <= 0) {
    throw badRequest('Enter an amount greater than zero.');
  }
  const cap = round2(available);
  if (cap <= 0) {
    throw badRequest(
      mode === 'cash'
        ? 'You have no cash left to hand over.'
        : 'You have no online collection left to settle.',
    );
  }
  if (value - cap >= MONEY_EPSILON) {
    throw badRequest(
      `You can settle at most Rs. ${cap} right now (anything already submitted and awaiting confirmation is excluded).`,
    );
  }
  return value;
}

/** True when two money figures are equal within the tolerance used everywhere else here. */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(round2(a) - round2(b)) < MONEY_EPSILON;
}
