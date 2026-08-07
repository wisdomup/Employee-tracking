/**
 * Weighted-average cost — pure arithmetic, no IO, so the rules can be unit-tested on their own
 * (same split as `region-sales.rules.ts`).
 *
 * The spec asks for "one running average cost per product, combined across all warehouses".
 * A moving average is only ever moved by RECEIPTS — consuming stock at the current average
 * leaves the average unchanged — so the authoritative value is simply
 *
 *     Σ(qty × rate) / Σ(qty)     over every live receipt
 *
 * which is what `averageCostFromReceipts` computes. That form is order-independent and stays
 * correct after a receipt is cancelled, whereas folding the incremental formula backwards is
 * not invertible once later receipts have landed.
 */

/** Cost values are money — 4 decimal places is plenty and keeps float drift out of reports. */
const COST_DP = 4;

export function roundCost(value: number): number {
  const factor = 10 ** COST_DP;
  return Math.round(value * factor) / factor;
}

export interface CostReceiptRow {
  qty: number;
  rate: number;
}

/**
 * What a single receipt would do to the running average. Used for the "this receipt will change
 * your cost to X" preview — the stored value always comes from `averageCostFromReceipts`.
 */
export function weightedAverageCost(
  prior: { qty: number; avgCost: number },
  receipt: CostReceiptRow,
): number {
  // Negative prior stock means the mirror has drifted; treat it as empty rather than letting a
  // phantom negative weight drag the average below zero.
  const priorQty = Math.max(prior.qty, 0);
  const priorAvg = Number.isFinite(prior.avgCost) && prior.avgCost > 0 ? prior.avgCost : 0;

  if (!Number.isFinite(receipt.qty) || receipt.qty <= 0) return roundCost(priorAvg);
  if (!Number.isFinite(receipt.rate) || receipt.rate < 0) return roundCost(priorAvg);

  // No prior weight — the receipt SETS the average. Blending against a stale average from stock
  // that no longer exists (or against an unpriced opening balance) produces nonsense.
  if (priorQty === 0 || priorAvg === 0) return roundCost(receipt.rate);

  const denominator = priorQty + receipt.qty;
  if (denominator <= 0) return roundCost(receipt.rate);

  return roundCost((priorQty * priorAvg + receipt.qty * receipt.rate) / denominator);
}

/**
 * The authoritative average over every live receipt for one product.
 *
 * Rows with a non-positive quantity or a zero rate are excluded: a free sample booked at rate 0
 * would otherwise crater the average for everything sold afterwards. Returns 0 when there is no
 * priced receipt at all — meaning "cost basis unknown", not "free".
 */
export function averageCostFromReceipts(rows: CostReceiptRow[]): number {
  let totalQty = 0;
  let totalValue = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.qty) || row.qty <= 0) continue;
    if (!Number.isFinite(row.rate) || row.rate <= 0) continue;
    totalQty += row.qty;
    totalValue += row.qty * row.rate;
  }

  if (totalQty <= 0) return 0;

  const avg = totalValue / totalQty;
  // Belt and braces: never let a NaN or a negative reach `Product.purchasePrice`, because the
  // P&L aggregation multiplies by it and one NaN turns company-wide COGS into NaN.
  if (!Number.isFinite(avg) || avg < 0) return 0;
  return roundCost(avg);
}
