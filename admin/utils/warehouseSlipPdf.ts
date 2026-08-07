import {
  PAGE_W,
  M,
  INNER_W,
  PDF_BORDER_GRAY,
  COMPANY_NAME,
  COMPANY_CONTACT,
} from './orderInvoicePdf';

/**
 * Printable slips for warehouse paperwork: stock in, transfers, damage entries, stock counts.
 *
 * Deliberately NOT built on `printTableAsPdf` from tableExport: that can draw a title and one
 * table, whereas a slip needs a document header, a two-column meta block, line items, totals, a
 * free-text reason paragraph, signature rules, and a CANCELLED stamp. Cramming that into a title
 * string is the abuse that already produced the concatenated `exportPdfTitle` in stock-reports.
 *
 * It is also much simpler than `orderInvoicePdf.ts` — no logo, no html2canvas, no rich text. Just
 * jsPDF plus autoTable, both dynamically imported so they stay out of the main bundle.
 */
export type SlipKind = 'stock-in' | 'transfer' | 'damage' | 'stock-count';

export interface SlipMetaField {
  label: string;
  value: string;
}

export interface SlipColumn {
  key: string;
  title: string;
  align?: 'left' | 'right';
  widthMm?: number;
}

export interface WarehouseSlipDoc {
  kind: SlipKind;
  /** Banner text, e.g. 'STOCK IN RECEIPT'. */
  title: string;
  documentNo: string;
  /** Pre-formatted — the caller owns date formatting. */
  dateLabel: string;
  meta: SlipMetaField[];
  columns: SlipColumn[];
  rows: Record<string, string | number>[];
  totals?: SlipMetaField[];
  notes?: { label: string; text: string }[];
  signatures?: string[];
  /** Diagonal watermark: 'CANCELLED', 'REJECTED', 'PENDING APPROVAL'. */
  stamp?: string;
}

const DEFAULT_SIGNATURES = ['Prepared by', 'Approved by', 'Received by'];

export async function buildWarehouseSlipPdfBlob(doc: WarehouseSlipDoc): Promise<Blob> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = (autoTableModule as unknown as { default: typeof import('jspdf-autotable').default })
    .default;

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = M;

  // ---- Letterhead ---------------------------------------------------------
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(COMPANY_NAME, PAGE_W / 2, y + 4, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(90);
  pdf.text(COMPANY_CONTACT, PAGE_W / 2, y + 9, { align: 'center' });
  pdf.setTextColor(0);
  y += 14;

  // ---- Title band ---------------------------------------------------------
  pdf.setDrawColor(...PDF_BORDER_GRAY);
  pdf.setFillColor(243, 244, 246);
  pdf.rect(M, y, INNER_W, 10, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text(doc.title, M + 3, y + 6.7);
  pdf.setFontSize(9.5);
  pdf.text(`No. ${doc.documentNo}`, PAGE_W - M - 3, y + 6.7, { align: 'right' });
  y += 14;

  // ---- Meta block: two columns of label/value pairs -----------------------
  const metaFields: SlipMetaField[] = [{ label: 'Date', value: doc.dateLabel }, ...doc.meta];
  const colWidth = INNER_W / 2;
  pdf.setFontSize(9);

  metaFields.forEach((field, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = M + col * colWidth;
    const lineY = y + row * 5.5;
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(90);
    pdf.text(`${field.label}:`, x, lineY);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0);
    // Keep the value inside its half of the page.
    const labelWidth = pdf.getTextWidth(`${field.label}: `);
    const available = colWidth - labelWidth - 4;
    const lines = pdf.splitTextToSize(field.value || '—', available);
    pdf.text(lines[0] ?? '—', x + labelWidth, lineY);
  });

  y += Math.ceil(metaFields.length / 2) * 5.5 + 4;

  // ---- Line items ---------------------------------------------------------
  autoTable(pdf, {
    startY: y,
    head: [doc.columns.map((c) => c.title)],
    body: doc.rows.map((row) => doc.columns.map((c) => String(row[c.key] ?? ''))),
    margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 1.8, lineColor: PDF_BORDER_GRAY, lineWidth: 0.1 },
    headStyles: { fillColor: [243, 244, 246], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(
      doc.columns.map((c, i) => [
        i,
        {
          halign: c.align ?? 'left',
          ...(c.widthMm ? { cellWidth: c.widthMm } : {}),
        },
      ]),
    ),
  });

  y = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  // ---- Totals, right-aligned ----------------------------------------------
  if (doc.totals?.length) {
    pdf.setFontSize(9.5);
    for (const total of doc.totals) {
      pdf.setFont('helvetica', 'bold');
      pdf.text(`${total.label}:`, PAGE_W - M - 45, y, { align: 'right' });
      pdf.setFont('helvetica', 'normal');
      pdf.text(total.value, PAGE_W - M, y, { align: 'right' });
      y += 5;
    }
    y += 3;
  }

  // ---- Notes (reason, rejection reason, resolution note) ------------------
  if (doc.notes?.length) {
    pdf.setFontSize(9);
    for (const note of doc.notes) {
      if (!note.text) continue;
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(90);
      pdf.text(`${note.label}:`, M, y);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0);
      const lines = pdf.splitTextToSize(note.text, INNER_W - 32);
      pdf.text(lines, M + 30, y);
      y += Math.max(lines.length * 4.4, 5) + 2;
    }
    y += 2;
  }

  // ---- Signature rules ----------------------------------------------------
  const signatures = doc.signatures ?? DEFAULT_SIGNATURES;
  const sigY = Math.min(Math.max(y + 16, 240), 262);
  const sigWidth = INNER_W / signatures.length;
  pdf.setFontSize(8.5);
  signatures.forEach((label, i) => {
    const x = M + i * sigWidth;
    pdf.setDrawColor(...PDF_BORDER_GRAY);
    pdf.line(x + 4, sigY, x + sigWidth - 8, sigY);
    pdf.setTextColor(90);
    pdf.text(label, x + 4, sigY + 4);
    pdf.setTextColor(0);
  });

  // ---- Cancelled / rejected stamp ----------------------------------------
  if (doc.stamp) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(48);
    pdf.setTextColor(220, 38, 38);
    // jsPDF's GState opacity is not available in every build, so a light colour stands in.
    pdf.setTextColor(248, 180, 180);
    pdf.text(doc.stamp, PAGE_W / 2, 150, { align: 'center', angle: 24 });
    pdf.setTextColor(0);
  }

  // ---- Footer -------------------------------------------------------------
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(120);
  pdf.text(`${COMPANY_NAME}  |  ${COMPANY_CONTACT}`, PAGE_W / 2, 288, { align: 'center' });

  return pdf.output('blob');
}

/**
 * Open the slip in a new tab and trigger print. Same open-blob-then-print dance as
 * `printOrderInvoice` / `printTableAsPdf`, including the timeout backstop for browsers that never
 * fire `load` on a blob URL.
 */
export async function printWarehouseSlip(doc: WarehouseSlipDoc): Promise<void> {
  const blob = await buildWarehouseSlipPdfBlob(doc);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');

  if (!win) {
    // Popup blocked — fall back to a download so the user still gets the slip.
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.kind}-${doc.documentNo}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      win.focus();
      win.print();
    } catch {
      /* the tab is open with the PDF either way */
    }
  };

  win.addEventListener('load', triggerPrint, { once: true });
  setTimeout(triggerPrint, 900);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadWarehouseSlip(
  doc: WarehouseSlipDoc,
  filename: string,
): Promise<void> {
  const blob = await buildWarehouseSlipPdfBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Mappers — keep PDF layout knowledge out of the page components.
// ---------------------------------------------------------------------------

/** Stock In receipt slip, built from the API's slip payload. */
export function stockInSlipDoc(slip: StockInSlipInput): WarehouseSlipDoc {
  const showMoney = slip.totalAmount !== null;

  return {
    kind: 'stock-in',
    title: 'STOCK IN RECEIPT',
    documentNo: slip.documentNo ? String(slip.documentNo).padStart(5, '0') : '—',
    dateLabel: slip.receiptDateLabel,
    meta: [
      { label: 'Supplier', value: slip.supplierName || '—' },
      { label: 'Received into', value: slip.warehouseName },
      { label: 'Warehouse city', value: slip.warehouseCity || '—' },
      { label: 'Prepared by', value: slip.preparedBy || '—' },
      { label: 'Status', value: slip.status === 'cancelled' ? 'CANCELLED' : 'Posted' },
      ...(slip.cancelledByName ? [{ label: 'Cancelled by', value: slip.cancelledByName }] : []),
    ],
    columns: [
      { key: 'sr', title: '#', widthMm: 10 },
      { key: 'productName', title: 'Product' },
      { key: 'barcode', title: 'Barcode', widthMm: 32 },
      { key: 'quantity', title: 'Pieces', align: 'right', widthMm: 20 },
      ...(showMoney
        ? [
            { key: 'rate', title: 'Rate', align: 'right' as const, widthMm: 26 },
            { key: 'amount', title: 'Amount', align: 'right' as const, widthMm: 28 },
          ]
        : []),
    ],
    rows: slip.lines.map((line, i) => ({
      sr: i + 1,
      productName: line.productName,
      barcode: line.barcode,
      quantity: line.quantity,
      rate: line.rateLabel,
      amount: line.amountLabel,
    })),
    totals: [
      { label: 'Total pieces', value: String(slip.totalPieces) },
      ...(showMoney && slip.totalAmountLabel
        ? [{ label: 'Total value', value: slip.totalAmountLabel }]
        : []),
    ],
    notes: [
      ...(slip.notes ? [{ label: 'Notes', text: slip.notes }] : []),
      ...(slip.cancelReason ? [{ label: 'Cancel reason', text: slip.cancelReason }] : []),
    ],
    signatures: ['Prepared by', 'Store keeper', 'Approved by'],
    stamp: slip.status === 'cancelled' ? 'CANCELLED' : undefined,
  };
}

/** Transfer slip — a dispatch note that doubles as the receiving check sheet. */
export function transferSlipDoc(slip: TransferSlipInput): WarehouseSlipDoc {
  const received = slip.lines.some((l) => l.receivedQty !== null);

  return {
    kind: 'transfer',
    title: 'STOCK TRANSFER NOTE',
    documentNo: slip.documentNo ? String(slip.documentNo).padStart(5, '0') : '—',
    dateLabel: slip.transferDateLabel,
    meta: [
      { label: 'From', value: slip.fromWarehouseName },
      { label: 'To', value: slip.toWarehouseName },
      { label: 'Prepared by', value: slip.preparedBy || '—' },
      { label: 'Approved by', value: slip.approvedByName || 'Not yet approved' },
      { label: 'Received by', value: slip.receivedByName || 'Not yet received' },
      { label: 'Status', value: slip.statusLabel },
    ],
    columns: [
      { key: 'sr', title: '#', widthMm: 10 },
      { key: 'productName', title: 'Product' },
      { key: 'barcode', title: 'Barcode', widthMm: 32 },
      { key: 'sentQty', title: 'Sent', align: 'right', widthMm: 20 },
      { key: 'receivedQty', title: 'Received', align: 'right', widthMm: 24 },
      { key: 'difference', title: 'Difference', align: 'right', widthMm: 24 },
    ],
    rows: slip.lines.map((line, i) => ({
      sr: i + 1,
      productName: line.productName,
      barcode: line.barcode,
      sentQty: line.sentQty,
      // Blank rather than 0 before receipt, so an unreceived note prints as a check sheet.
      receivedQty: line.receivedQty === null ? '' : line.receivedQty,
      difference: line.difference === null ? '' : line.difference === 0 ? '—' : line.difference,
    })),
    totals: [
      { label: 'Total sent', value: String(slip.totalSent) },
      ...(received ? [{ label: 'Total received', value: String(slip.totalReceived) }] : []),
    ],
    notes: [
      ...(slip.notes ? [{ label: 'Notes', text: slip.notes }] : []),
      ...(slip.rejectionReason ? [{ label: 'Rejected', text: slip.rejectionReason }] : []),
      ...(slip.mismatchResolutionNote
        ? [{ label: 'Mismatch resolved', text: slip.mismatchResolutionNote }]
        : []),
      ...(slip.cancelReason ? [{ label: 'Cancelled', text: slip.cancelReason }] : []),
    ],
    signatures: ['Dispatched by', 'Driver', 'Received by'],
    stamp:
      slip.status === 'cancelled'
        ? 'CANCELLED'
        : slip.status === 'rejected'
          ? 'REJECTED'
          : slip.status === 'pending'
            ? 'PENDING APPROVAL'
            : undefined,
  };
}

export interface TransferSlipInput {
  documentNo: number | null;
  transferDateLabel: string;
  status: string;
  statusLabel: string;
  fromWarehouseName: string;
  toWarehouseName: string;
  preparedBy: string;
  approvedByName: string | null;
  receivedByName: string | null;
  notes: string | null;
  cancelReason: string | null;
  rejectionReason: string | null;
  mismatchResolutionNote: string | null;
  totalSent: number;
  totalReceived: number;
  lines: {
    productName: string;
    barcode: string;
    sentQty: number;
    receivedQty: number | null;
    difference: number | null;
  }[];
}

/** Damage / claim slip — the paper trail for a write-off. */
export function damageSlipDoc(slip: DamageSlipInput): WarehouseSlipDoc {
  return {
    kind: 'damage',
    title: 'DAMAGE / CLAIM NOTE',
    documentNo: slip.documentNo ? String(slip.documentNo).padStart(5, '0') : '—',
    dateLabel: slip.entryDateLabel,
    meta: [
      { label: 'Warehouse', value: slip.warehouseName },
      { label: 'Type', value: slip.sourceLabel },
      { label: 'Client', value: slip.clientName || '—' },
      { label: 'Raised by', value: slip.raisedBy || '—' },
      { label: 'Approved by', value: slip.approvedByName || 'Not yet approved' },
      { label: 'Status', value: slip.status.toUpperCase() },
    ],
    columns: [
      { key: 'sr', title: '#', widthMm: 10 },
      { key: 'productName', title: 'Product' },
      { key: 'barcode', title: 'Barcode', widthMm: 32 },
      { key: 'quantity', title: 'Pieces', align: 'right', widthMm: 22 },
    ],
    rows: slip.lines.map((line, i) => ({
      sr: i + 1,
      productName: line.productName,
      barcode: line.barcode,
      quantity: line.quantity,
    })),
    totals: [{ label: 'Total pieces', value: String(slip.totalPieces) }],
    notes: [
      { label: 'Reason', text: slip.reason },
      ...(slip.rejectionReason ? [{ label: 'Rejected', text: slip.rejectionReason }] : []),
      ...(slip.cancelReason ? [{ label: 'Cancelled', text: slip.cancelReason }] : []),
    ],
    signatures: ['Raised by', 'Store keeper', 'Approved by'],
    stamp:
      slip.status === 'cancelled'
        ? 'CANCELLED'
        : slip.status === 'rejected'
          ? 'REJECTED'
          : slip.status === 'pending'
            ? 'PENDING APPROVAL'
            : undefined,
  };
}

export interface DamageSlipInput {
  documentNo: number | null;
  entryDateLabel: string;
  status: string;
  sourceLabel: string;
  clientName: string | null;
  warehouseName: string;
  reason: string;
  rejectionReason: string | null;
  cancelReason: string | null;
  raisedBy: string;
  approvedByName: string | null;
  totalPieces: number;
  lines: { productName: string; barcode: string; quantity: number }[];
}

/** Shape the Stock In detail page passes in — money already formatted, so the PDF stays dumb. */
export interface StockInSlipInput {
  documentNo: number | null;
  receiptDateLabel: string;
  supplierName: string | null;
  warehouseName: string;
  warehouseCity: string;
  preparedBy: string;
  status: string;
  cancelledByName: string | null;
  cancelReason: string | null;
  notes: string | null;
  totalPieces: number;
  totalAmount: number | null;
  totalAmountLabel?: string;
  lines: {
    productName: string;
    barcode: string;
    quantity: number;
    rateLabel: string;
    amountLabel: string;
  }[];
}
