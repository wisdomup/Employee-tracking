/**
 * Order money math, kept pure so the rules are testable without a database.
 *
 * Vocabulary:
 * - line subtotal = quantity × price (gross)
 * - line discount = flat Rs. off the subtotal, clamped to it so a line can never go
 *   below zero (a typo must not turn into negative billing)
 * - totalPrice = sum of gross subtotals (unchanged meaning everywhere it is displayed)
 * - itemsDiscountTotal = sum of the (clamped) line discounts
 * - grandTotal = totalPrice − itemsDiscountTotal − order-level discount
 */

export interface OrderLineForTotals {
  quantity: number;
  price: number;
  discount?: number | null;
}

export interface OrderTotals {
  totalPrice: number;
  itemsDiscountTotal: number;
  grandTotal: number;
  /** The line discounts after clamping — what should actually be stored. */
  lineDiscounts: number[];
}

export function clampLineDiscount(line: OrderLineForTotals): number {
  const subtotal = line.quantity * line.price;
  const raw = typeof line.discount === 'number' && Number.isFinite(line.discount) ? line.discount : 0;
  return Math.min(Math.max(raw, 0), subtotal);
}

export function computeOrderTotals(
  lines: OrderLineForTotals[],
  orderDiscount?: number | null,
): OrderTotals {
  const totalPrice = lines.reduce((sum, l) => sum + l.quantity * l.price, 0);
  const lineDiscounts = lines.map(clampLineDiscount);
  const itemsDiscountTotal = lineDiscounts.reduce((sum, d) => sum + d, 0);
  const orderLevel =
    typeof orderDiscount === 'number' && Number.isFinite(orderDiscount)
      ? Math.max(orderDiscount, 0)
      : 0;
  return {
    totalPrice,
    itemsDiscountTotal,
    grandTotal: totalPrice - itemsDiscountTotal - orderLevel,
    lineDiscounts,
  };
}
