/**
 * Grand totals for report tables.
 *
 * The rule the client asked for is a general one — every report shows the sum of its numeric
 * columns underneath — so this is deliberately generic rather than hand-written per report.
 *
 * Two things worth knowing:
 *
 * 1. Totals are computed over the WHOLE dataset handed to the table, not the visible page.
 *    A "grand total" that changed when you clicked to page 2 would be worse than none.
 * 2. A column is only summed when every non-empty value in it is a number. An id column that
 *    happens to hold digits stays out because its values arrive as strings; a column of mixed
 *    types is skipped rather than half-added.
 */

export interface GrandTotalColumn {
  key: string;
  title: string;
  /** Force a column in or out of the total, overriding the numeric sniff. */
  total?: 'sum' | 'none';
  /** Render the summed figure — currency, units, whatever the column shows. */
  totalFormat?: (total: number) => string;
}

export interface GrandTotalEntry {
  key: string;
  title: string;
  value: number;
  /** Display string, already formatted. */
  text: string;
}

/** True when the column's values are all numbers (ignoring blanks), so summing means something. */
function isSummable(rows: Record<string, unknown>[], key: string): boolean {
  let sawNumber = false;
  for (const row of rows) {
    const value = row?.[key];
    if (value == null || value === '') continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    sawNumber = true;
  }
  return sawNumber;
}

/** Whole numbers stay whole; anything with a fraction shows two decimals, as money does. */
function defaultFormat(total: number, allIntegers: boolean): string {
  return allIntegers
    ? total.toLocaleString('en-US')
    : total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * One entry per summable column, in the column order of the table.
 * Returns an empty array when nothing is summable — the caller then renders no total bar.
 */
export function computeGrandTotals(
  columns: GrandTotalColumn[],
  data: unknown[],
): GrandTotalEntry[] {
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const entries: GrandTotalEntry[] = [];

  for (const column of columns) {
    if (column.total === 'none') continue;
    if (column.total !== 'sum' && !isSummable(rows, column.key)) continue;

    let total = 0;
    let allIntegers = true;
    for (const row of rows) {
      const value = row?.[column.key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      total += value;
      if (!Number.isInteger(value)) allIntegers = false;
    }

    // Float addition drifts (0.1 + 0.2); round once at the edge, as the backend does.
    total = Math.round(total * 100) / 100;
    if (!Number.isInteger(total)) allIntegers = false;

    entries.push({
      key: column.key,
      title: column.title,
      value: total,
      text: column.totalFormat ? column.totalFormat(total) : defaultFormat(total, allIntegers),
    });
  }

  return entries;
}

/**
 * The grand total as one export row, aligned to the export columns.
 *
 * The label goes in the first column that carries no total of its own — an unlabelled row of
 * numbers at the bottom of a CSV is indistinguishable from another data row. Using "the first
 * column" unconditionally would overwrite a real figure whenever the leftmost column happens to
 * be numeric, which is exactly the case where the row is hardest to recognise.
 */
export function buildGrandTotalExportRow(
  exportColumns: { key: string; title: string }[],
  totals: GrandTotalEntry[],
): string[] | null {
  if (totals.length === 0 || exportColumns.length === 0) return null;

  const byKey = new Map(totals.map((t) => [t.key, t.text]));
  const labelIndex = exportColumns.findIndex((c) => !byKey.has(c.key));

  return exportColumns.map((column, index) => {
    const hit = byKey.get(column.key);
    if (hit != null) return hit;
    return index === labelIndex ? 'Grand Total' : '';
  });
}
