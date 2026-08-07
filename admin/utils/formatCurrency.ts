/**
 * Rupee formatting. Extracted because four divergent implementations had already grown across the
 * app (`regionSalesService.formatRs`, `stock-reports`'s local `formatCurrency`, `analytics`'s
 * `money`, plus inline template strings) and the warehouse module would otherwise have added a
 * dozen more.
 *
 * `formatRs` is the house default: thousands separators, no decimals, for figures an admin reads
 * out loud. Use `formatRsExact` where the paisa matter — rates on a Stock In slip, stock valuation.
 */

/** e.g. `Rs. 1,250` — whole rupees, for totals and KPI tiles. */
export function formatRs(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `Rs. ${safe.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/** e.g. `Rs. 1,250.75` — for rates and valuations where rounding would hide a discrepancy. */
export function formatRsExact(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `Rs. ${safe.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Piece counts. Stock is always pieces, never cartons — the label is part of the contract. */
export function formatPieces(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('en-PK');
}
