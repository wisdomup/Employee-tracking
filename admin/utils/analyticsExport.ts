/**
 * CSV / PDF export for analytics & report *pages* — the KPI cards, trend charts and report
 * tables that make up a dashboard view, exported as one document.
 *
 * `tableExport.ts` covers a single list table; this covers a whole page of mixed sections.
 */

import {
  escapeCsvField,
  getExportColumns,
  getExportTableData,
  safeDownloadFilename,
  type TableExportColumn,
} from './tableExport';

export interface AnalyticsKpi {
  label: string;
  value: string | number;
  /** Extra context printed next to the figure (e.g. "/ 80% pass"). */
  hint?: string;
}

export interface AnalyticsChartSection {
  title: string;
  labels: string[];
  datasets: Array<{ label: string; values: number[] }>;
  /**
   * `id` of the element wrapping the chart canvas. When present the PDF embeds a picture of
   * the rendered chart above its data table; without it only the data table is written.
   */
  elementId?: string;
  /** Column header for the label axis in the exported data table. Default: "Period". */
  labelHeader?: string;
}

export interface AnalyticsTableSection {
  title: string;
  columns: TableExportColumn[];
  rows: unknown[];
  grandTotalRow?: string[] | null;
}

export interface AnalyticsExportPayload {
  /** Base download name; extension added per format. */
  filename: string;
  title?: string;
  /** Filter/period line printed under the title. */
  subtitle?: string;
  kpis?: AnalyticsKpi[];
  charts?: AnalyticsChartSection[];
  tables?: AnalyticsTableSection[];
}

const KPI_SECTION_TITLE = 'Summary';

function kpiValueText(kpi: AnalyticsKpi): string {
  const base = typeof kpi.value === 'number' ? String(kpi.value) : String(kpi.value ?? '');
  return kpi.hint ? `${base} ${kpi.hint}`.trim() : base;
}

/** Rows for a chart section: one line per label, one column per series. */
function chartTableData(chart: AnalyticsChartSection): { headers: string[]; rows: string[][] } {
  const headers = [chart.labelHeader ?? 'Period', ...chart.datasets.map((d) => d.label)];
  const rows = chart.labels.map((label, i) => [
    String(label ?? ''),
    ...chart.datasets.map((d) => {
      const v = d.values?.[i];
      return v == null || !Number.isFinite(Number(v)) ? '' : String(v);
    }),
  ]);
  return { headers, rows };
}

function hasContent(payload: AnalyticsExportPayload): boolean {
  return Boolean(
    payload.kpis?.length ||
      payload.charts?.some((c) => c.labels.length) ||
      payload.tables?.some((t) => t.rows.length),
  );
}

/* -------------------------------------------------------------------------- CSV */

function csvLine(cells: string[]): string {
  return cells.map(escapeCsvField).join(',');
}

export function buildAnalyticsCsv(payload: AnalyticsExportPayload): string {
  const { title, subtitle, kpis, charts, tables } = payload;
  const lines: string[] = [];

  if (title) lines.push(csvLine([title]));
  if (subtitle) lines.push(csvLine([subtitle]));
  lines.push(csvLine([`Generated ${new Date().toLocaleString()}`]));

  if (kpis?.length) {
    lines.push('');
    lines.push(csvLine([KPI_SECTION_TITLE]));
    lines.push(csvLine(['Metric', 'Value']));
    kpis.forEach((kpi) => lines.push(csvLine([kpi.label, kpiValueText(kpi)])));
  }

  charts?.forEach((chart) => {
    if (!chart.labels.length) return;
    const { headers, rows } = chartTableData(chart);
    lines.push('');
    lines.push(csvLine([chart.title]));
    lines.push(csvLine(headers));
    rows.forEach((r) => lines.push(csvLine(r)));
  });

  tables?.forEach((section) => {
    if (!section.rows.length) return;
    const { headers, rows } = getExportTableData(section.columns, section.rows);
    lines.push('');
    lines.push(csvLine([section.title]));
    lines.push(csvLine(headers));
    rows.forEach((r) => lines.push(csvLine(r)));
    if (section.grandTotalRow?.length) lines.push(csvLine(section.grandTotalRow));
  });

  return lines.join('\r\n');
}

export function exportAnalyticsToCsv(payload: AnalyticsExportPayload): void {
  if (!hasContent(payload)) return;
  const csv = buildAnalyticsCsv(payload);
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, safeDownloadFilename(payload.filename, 'csv'));
}

/* -------------------------------------------------------------------------- PDF */

const MARGIN = { left: 12, right: 12, top: 14, bottom: 16 } as const;

/**
 * Chart.js draws on a transparent canvas; composite it over white so the picture does not
 * come out as a black block in the PDF.
 */
function captureChartImage(elementId?: string): { dataUrl: string; ratio: number } | null {
  if (!elementId || typeof document === 'undefined') return null;
  const host = document.getElementById(elementId);
  const source = host?.querySelector('canvas') as HTMLCanvasElement | null;
  if (!source || !source.width || !source.height) return null;

  try {
    const flat = document.createElement('canvas');
    flat.width = source.width;
    flat.height = source.height;
    const ctx = flat.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(source, 0, 0);
    return { dataUrl: flat.toDataURL('image/png'), ratio: source.height / source.width };
  } catch {
    // Tainted canvas or an unsupported context — fall back to the data table alone.
    return null;
  }
}

export async function buildAnalyticsPdfBlob(
  payload: AnalyticsExportPayload,
): Promise<Blob | null> {
  if (!hasContent(payload)) return null;

  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const { title, subtitle, kpis, charts, tables } = payload;

  // Wide report tables read better across the page than squeezed into portrait.
  const widest = Math.max(
    0,
    ...(tables ?? []).map((t) => getExportColumns(t.columns).length),
    ...(charts ?? []).map((c) => c.datasets.length + 1),
  );
  const orientation: 'portrait' | 'landscape' = widest >= 7 ? 'landscape' : 'portrait';

  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const innerW = pageW - MARGIN.left - MARGIN.right;

  const baseStyles = {
    font: 'helvetica',
    fontSize: 9,
    cellPadding: { top: 2.2, right: 2.8, bottom: 2.2, left: 2.8 },
    textColor: [31, 41, 55] as [number, number, number],
    valign: 'top' as const,
    overflow: 'linebreak' as const,
    lineWidth: 0.15,
    lineColor: [209, 213, 219] as [number, number, number],
  };
  const headStyles = {
    fontStyle: 'bold' as const,
    fillColor: [31, 41, 55] as [number, number, number],
    textColor: 255,
    valign: 'middle' as const,
    fontSize: 9,
    overflow: 'linebreak' as const,
  };

  let y = MARGIN.top;

  if (title?.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(17, 24, 39);
    const lines = doc.splitTextToSize(title.trim(), innerW);
    doc.text(lines, MARGIN.left, y);
    y += lines.length * 6.2 + 1;
  }
  if (subtitle?.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(90, 90, 90);
    const lines = doc.splitTextToSize(subtitle.trim(), innerW);
    doc.text(lines, MARGIN.left, y);
    y += lines.length * 5 + 1;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated ${new Date().toLocaleString()}`, MARGIN.left, y + 3);
  y += 8;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - MARGIN.bottom) {
      doc.addPage();
      y = MARGIN.top;
    }
  };

  const sectionHeading = (text: string) => {
    ensureSpace(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(17, 24, 39);
    doc.text(text, MARGIN.left, y + 4);
    y += 8;
  };

  const runTable = (head: string[][], body: string[][], foot?: string[][]) => {
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      head,
      body,
      ...(foot?.length ? { foot } : {}),
      footStyles: {
        fontStyle: 'bold',
        fillColor: [243, 244, 246],
        textColor: [17, 24, 39],
        lineWidth: 0.15,
        lineColor: [209, 213, 219],
      },
      showFoot: 'lastPage',
      styles: baseStyles,
      headStyles,
      alternateRowStyles: { fillColor: [249, 250, 251] },
      margin: { left: MARGIN.left, right: MARGIN.right, bottom: MARGIN.bottom },
      tableLineColor: [209, 213, 219],
      tableLineWidth: 0.2,
      showHead: 'everyPage',
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;
  };

  if (kpis?.length) {
    sectionHeading(KPI_SECTION_TITLE);
    runTable([['Metric', 'Value']], kpis.map((k) => [k.label, kpiValueText(k)]));
  }

  charts?.forEach((chart) => {
    if (!chart.labels.length) return;
    sectionHeading(chart.title);

    const image = captureChartImage(chart.elementId);
    if (image) {
      const imgW = innerW;
      const imgH = Math.min(
        Math.max(imgW * image.ratio, 40),
        pageH - MARGIN.top - MARGIN.bottom - 20,
      );
      ensureSpace(imgH + 4);
      try {
        doc.addImage(image.dataUrl, 'PNG', MARGIN.left, y, imgW, imgH);
        y += imgH + 6;
      } catch {
        // Image embedding failed — the data table below still carries the numbers.
      }
    }

    const { headers, rows } = chartTableData(chart);
    runTable([headers], rows);
  });

  tables?.forEach((section) => {
    if (!section.rows.length) return;
    sectionHeading(section.title);
    const { headers, rows } = getExportTableData(section.columns, section.rows);
    runTable([headers], rows, section.grandTotalRow?.length ? [section.grandTotalRow] : undefined);
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Page ${i} of ${pages}`, pageW / 2, pageH - 7, { align: 'center' });
  }

  return doc.output('blob');
}

export async function exportAnalyticsToPdf(payload: AnalyticsExportPayload): Promise<void> {
  const blob = await buildAnalyticsPdfBlob(payload);
  if (!blob) return;
  triggerDownload(blob, safeDownloadFilename(payload.filename, 'pdf'));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
