/**
 * CSV / PDF export helpers for list tables (used by `Table` → react-data-table-component).
 */

export interface TableExportColumn {
  key: string;
  title: string;
  omitFromExport?: boolean;
  exportValue?: (row: unknown) => string;
  /** Grand-total treatment; mirrors `TableColumnConfig` so exports carry the same footer row. */
  total?: 'sum' | 'avg' | 'count';
  totalValue?: (row: any) => number;
  totalRender?: (value: number) => unknown;
}

/**
 * Grand total for one column across the WHOLE data set. Shared by the on-screen footer and the
 * CSV/PDF export so a printed report can never disagree with the screen it came from.
 */
export function aggregateColumn(column: TableExportColumn, data: unknown[]): number {
  const rows = data as Record<string, unknown>[];
  const rawOf = (row: Record<string, unknown>) =>
    column.totalValue ? column.totalValue(row) : row[column.key];

  if (column.total === 'count') {
    return rows.filter((row) => Boolean(rawOf(row))).length;
  }

  const numberOf = (row: Record<string, unknown>) => {
    const raw = rawOf(row);
    const num = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : Number(raw);
    return Number.isFinite(num) ? num : 0;
  };

  const sum = rows.reduce((total, row) => total + numberOf(row), 0);
  if (column.total === 'avg') {
    // Rows with no reading sit out of the divisor rather than dragging the average toward zero.
    const counted = rows.filter((row) => {
      const raw = rawOf(row);
      return raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw));
    }).length;
    return counted ? sum / counted : 0;
  }
  return sum;
}

/** Locale-grouped fallback for a total with no `totalRender`. */
export function formatTotalForDisplay(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type TableExportFormat = 'csv' | 'pdf';

function filterExportColumns(columns: TableExportColumn[]): TableExportColumn[] {
  return columns.filter(
    (c) => !c.omitFromExport && c.key !== 'actions' && c.key !== 'select',
  );
}

/** Headers and cell strings used by CSV and PDF export. */
export function getExportTableData(
  columns: TableExportColumn[],
  data: unknown[],
): { headers: string[]; rows: string[][] } {
  const exportCols = filterExportColumns(columns);
  const headers = exportCols.map((c) => c.title);
  const rows = (data as Record<string, unknown>[]).map((row) =>
    exportCols.map((col) => {
      const raw = col.exportValue ? col.exportValue(row) : formatCellForExport(row[col.key]);
      return raw ?? '';
    }),
  );

  const totalsRow = buildTotalsRow(exportCols, data);
  if (totalsRow) rows.push(totalsRow);

  return { headers, rows };
}

/** The exported footer, or `null` when no visible column declares a total. */
function buildTotalsRow(exportCols: TableExportColumn[], data: unknown[]): string[] | null {
  if (!data.length || !exportCols.some((col) => col.total)) return null;

  return exportCols.map((col, index) => {
    if (col.total) {
      const value = aggregateColumn(col, data);
      // `totalRender` may return JSX for the screen; only a plain string is usable in a file.
      const rendered = col.totalRender ? col.totalRender(value) : undefined;
      const text =
        typeof rendered === 'string' || typeof rendered === 'number'
          ? String(rendered)
          : formatTotalForDisplay(value);
      return col.total === 'avg' ? `Avg ${text}` : text;
    }
    return index === 0 ? `TOTAL (${data.length} entries)` : '';
  });
}

function escapeCsvField(val: string): string {
  const s = String(val).replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}

/** Turn a cell value into a plain string suitable for CSV (populated refs, arrays, etc.). */
export function formatCellForExport(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => formatCellForExport(item)).filter(Boolean).join('; ');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.shopName === 'string' && o.shopName) {
      const name = typeof o.name === 'string' ? o.name : '';
      return name ? `${name} (${o.shopName})` : o.shopName;
    }
    if (typeof o.name === 'string') return o.name;
    if (typeof o.username === 'string') return o.username;
    if (o.userID != null) return String(o.userID);
    if (o._id != null) return String(o._id);
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

export function buildTableCsv(
  columns: TableExportColumn[],
  data: unknown[],
  /** Appended as the last line so the exported file carries the same total as the screen. */
  grandTotalRow?: string[] | null,
): string {
  const { headers, rows } = getExportTableData(columns, data);
  const headerLine = headers.map(escapeCsvField).join(',');
  const lines = rows.map((r) => r.map(escapeCsvField).join(','));
  if (grandTotalRow?.length) {
    lines.push(grandTotalRow.map(escapeCsvField).join(','));
  }
  return [headerLine, ...lines].join('\r\n');
}

/** The export columns a grand-total row must line up with (same filter the data rows use). */
export function getExportColumns(columns: TableExportColumn[]): TableExportColumn[] {
  return filterExportColumns(columns);
}

export function downloadCsv(filename: string, csvBody: string): void {
  const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeDownloadFilename(filename, 'csv');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportTableToCsv(options: {
  filename: string;
  columns: TableExportColumn[];
  data: unknown[];
  grandTotalRow?: string[] | null;
}): void {
  const { filename, columns, data, grandTotalRow } = options;
  if (!data.length) return;
  const csv = buildTableCsv(columns, data, grandTotalRow);
  downloadCsv(filename, csv);
}

function safeDownloadFilename(filename: string, ext: 'csv' | 'pdf'): string {
  const base = filename.replace(/\.(csv|pdf)$/i, '').trim() || 'export';
  return `${base}.${ext}`.replace(/[/\\?%*:|"<>]/g, '-');
}

/** Normalize text for PDF cells so line-break wrapping behaves predictably. */
function cellTextForPdf(value: string): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ');
}

const PDF_MARGIN = { left: 10, right: 10, bottom: 16 } as const;
/** Minimum column width (mm); avoids unreadable slivers and triggers horizontal page slices when needed. */
const PDF_MIN_COL_MM = 26;
const A4_WIDTH_MM = 210;

function pdfPickOrientation(colCount: number): 'portrait' | 'landscape' {
  const portraitInner = A4_WIDTH_MM - PDF_MARGIN.left - PDF_MARGIN.right;
  const minTableWidth = colCount * PDF_MIN_COL_MM;
  if (minTableWidth > portraitInner - 4) return 'landscape';
  if (colCount >= 6) return 'landscape';
  return 'portrait';
}

/**
 * Builds a PDF with a simple table (dynamic import keeps the PDF libs out of the main chunk).
 */
export async function exportTableToPdf(options: {
  filename: string;
  columns: TableExportColumn[];
  data: unknown[];
  title?: string;
  grandTotalRow?: string[] | null;
}): Promise<void> {
  const { filename } = options;
  const blob = await buildTablePdfBlob(options);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeDownloadFilename(filename, 'pdf');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function buildTablePdfBlob(options: {
  columns: TableExportColumn[];
  data: unknown[];
  title?: string;
  grandTotalRow?: string[] | null;
}): Promise<Blob | null> {
  const { columns, data, title, grandTotalRow } = options;
  if (!data.length) return null;

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const { headers, rows } = getExportTableData(columns, data);
  const colCount = headers.length;
  const headRow = headers.map((h) => cellTextForPdf(h));
  const bodyRows = rows.map((r) => r.map((c) => cellTextForPdf(String(c))));

  const orientation = pdfPickOrientation(colCount);
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const innerW = pageW - PDF_MARGIN.left - PDF_MARGIN.right;
  const horizontalPageBreak = colCount * PDF_MIN_COL_MM > innerW + 2;

  let startY = 14;
  if (title?.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(17, 24, 39);
    const titleLines = doc.splitTextToSize(title.trim(), innerW);
    doc.text(titleLines, PDF_MARGIN.left, startY + 4);
    startY += titleLines.length * 5.8 + 2;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text(`${bodyRows.length} row${bodyRows.length === 1 ? '' : 's'} · ${colCount} column${colCount === 1 ? '' : 's'}`, PDF_MARGIN.left, startY + 3);
  startY += 7;

  autoTable(doc, {
    startY,
    theme: 'grid',
    head: [headRow],
    body: bodyRows,
    // `foot` repeats on every page and is styled apart from the data, which is exactly what
    // a grand total wants to be.
    ...(grandTotalRow?.length
      ? { foot: [grandTotalRow.map((c) => cellTextForPdf(String(c)))] }
      : {}),
    footStyles: {
      fontStyle: 'bold',
      fillColor: [243, 244, 246],
      textColor: [17, 24, 39],
      lineWidth: 0.15,
      lineColor: [209, 213, 219],
    },
    showFoot: 'lastPage',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 2.2, right: 2.8, bottom: 2.2, left: 2.8 },
      textColor: [31, 41, 55],
      valign: 'top',
      overflow: 'linebreak',
      minCellWidth: PDF_MIN_COL_MM,
      minCellHeight: 6,
      lineWidth: 0.15,
      lineColor: [209, 213, 219],
    },
    headStyles: {
      fontStyle: 'bold',
      fillColor: [31, 41, 55],
      textColor: 255,
      valign: 'middle',
      fontSize: 9,
      overflow: 'linebreak',
      minCellHeight: 8,
    },
    bodyStyles: {
      valign: 'top',
      overflow: 'linebreak',
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: {
      left: PDF_MARGIN.left,
      right: PDF_MARGIN.right,
      bottom: PDF_MARGIN.bottom,
    },
    tableLineColor: [209, 213, 219],
    tableLineWidth: 0.2,
    showHead: 'everyPage',
    horizontalPageBreak,
    horizontalPageBreakBehaviour: 'afterAllRows',
    ...(horizontalPageBreak && colCount > 0 ? { horizontalPageBreakRepeat: 0 } : {}),
    didDrawPage: (data) => {
      const d = data.doc;
      const pw = d.internal.pageSize.getWidth();
      const ph = d.internal.pageSize.getHeight();
      d.setFont('helvetica', 'normal');
      d.setFontSize(8);
      d.setTextColor(120, 120, 120);
      d.text(`Page ${data.pageNumber}`, pw / 2, ph - 7, { align: 'center' });
    },
  });

  return doc.output('blob');
}

export async function printTableAsPdf(options: {
  columns: TableExportColumn[];
  data: unknown[];
  title?: string;
}): Promise<void> {
  const blob = await buildTablePdfBlob(options);
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }

  // Give the browser a moment to render the PDF before triggering print.
  const triggerPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      // Ignore print errors from restrictive browser contexts.
    }
  };

  win.addEventListener('load', triggerPrint, { once: true });
  setTimeout(triggerPrint, 900);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
