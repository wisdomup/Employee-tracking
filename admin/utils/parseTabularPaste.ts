/**
 * Parse a block of text pasted out of Excel, Google Sheets or a CSV file.
 *
 * Suppliers send stock lists in whatever their system exports, so the delimiter is detected rather
 * than configured: a spreadsheet paste arrives tab-separated, a saved export comma- or
 * semicolon-separated. Quoted fields are honoured because a product name containing a comma is
 * ordinary in a CSV and would otherwise shift every column after it.
 */

export type TabularRow = string[];

/** Tab wins when present — a spreadsheet paste is tab-separated and its cells may contain commas. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  if (sample.includes('\t')) return '\t';

  const semicolons = (sample.match(/;/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  if (semicolons > commas) return ';';
  return ',';
}

/** Split one line, treating `"` as a quote character and `""` as an escaped quote inside one. */
function splitLine(line: string, delimiter: string): TabularRow {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

/** Non-empty rows only — a trailing newline or a blank separator line is not a line item. */
export function parseTabular(text: string, delimiter = detectDelimiter(text)): TabularRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => splitLine(line, delimiter))
    .filter((row) => row.some((cell) => cell.length > 0));
}

/**
 * A first row is a header when it names columns rather than holding data. The reliable tell is that
 * the quantity column is not a number, so any row whose cells are all non-numeric is treated as one.
 */
export function looksLikeHeader(row: TabularRow): boolean {
  if (row.length === 0) return false;
  const anyNumeric = row.some((cell) => cell !== '' && Number.isFinite(parseNumericCell(cell)));
  if (anyNumeric) return false;
  return row.some((cell) => /product|item|name|barcode|code|sku|qty|quantity|piece|rate|price|cost/i.test(cell));
}

/**
 * `1,234.50`, `Rs. 90`, `12 pcs` and `` become numbers or NaN — never a silent 0.
 *
 * Thousands separators are dropped, then the first number in the cell is taken. Stripping every
 * non-numeric character instead would turn `Rs. 90` into `.90` — a rate imported at a hundredth of
 * its value, which is exactly the kind of quiet error a bulk import must not make.
 */
export function parseNumericCell(cell: string): number {
  const withoutSeparators = (cell ?? '').replace(/,/g, '');
  const match = withoutSeparators.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

export interface ColumnMapping {
  product: number;
  qty: number;
  rate: number;
}

const PRODUCT_HEADER = /product|item|name|barcode|code|sku|description/i;
const QTY_HEADER = /qty|quantity|piece|pcs|units?|count/i;
const RATE_HEADER = /rate|price|cost|amount|value/i;

/**
 * Best guess at which column is which. With a header row the names decide; without one, fall back to
 * the order the fields are entered in on the form — product, pieces, rate.
 */
export function guessColumns(rows: TabularRow[], hasHeader: boolean): ColumnMapping {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const fallback: ColumnMapping = {
    product: 0,
    qty: width > 1 ? 1 : -1,
    rate: width > 2 ? 2 : -1,
  };

  if (!hasHeader || rows.length === 0) return fallback;

  const header = rows[0];
  const find = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));

  // Quantity headers like "Qty" also match nothing else, but "Amount" matches RATE before a
  // dedicated "Rate" column is seen — so resolve quantity first and never reuse an index.
  const qty = find(QTY_HEADER);
  const rate = header.findIndex((cell, i) => i !== qty && RATE_HEADER.test(cell));
  const product = header.findIndex((cell, i) => i !== qty && i !== rate && PRODUCT_HEADER.test(cell));

  return {
    product: product >= 0 ? product : fallback.product,
    qty: qty >= 0 ? qty : fallback.qty,
    rate: rate >= 0 ? rate : fallback.rate,
  };
}
