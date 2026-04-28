import type { Order } from '../services/orderService';
import { format } from 'date-fns';
import { employeeDisplayLabel } from './employeeDisplayLabel';

const PAGE_W = 210;
const M = 14;
const INNER_W = PAGE_W - M * 2; // 182 mm
/** Light gray strokes for invoice boxes / tables (RGB). */
const PDF_BORDER_GRAY: [number, number, number] = [180, 180, 180];

/** Header band + matching BILL TO / INVOICE DETAILS panel chrome (template). */
const INVOICE_HEADER_FILL: [number, number, number] = [245, 245, 245]; // #F5F5F5
const INVOICE_HEADER_CORNER_MM = 3.2; // ~12px — main header & twin detail boxes
const INVOICE_BANNER_CORNER_MM = 1.7; // ~6px — SALE INVOICE bar
const INVOICE_RIGHT_BADGE_CORNER_MM = 2.1; // ~8px — LIGHTSPEED fallback box

/** Terms & Conditions panel (footer template — light fill, rounded, gray stroke). */
const TERMS_BOX_FILL: [number, number, number] = [242, 242, 242]; // ~#f2f2f2
const TERMS_BOX_CORNER_MM = 2.6; // ~10px — closer to expected ref
/** Inner inset (box border → content). */
const TERMS_INNER_PAD_MM = 4.5;
/** Space below the terms panel before signatures. */
const TERMS_AFTER_BOX_GAP_MM = 12;
/** Expected ref: title and list body same optical size; title stays bold. */
const TERMS_TITLE_FONT_PT = 9;
const TERMS_BODY_FONT_PT = 9;
/** Box inner top → “Terms & Conditions:” baseline (mm). */
const TERMS_TITLE_BASELINE_MM = 4;
/** Plain path: title baseline → first body baseline (mm) — ~8px breathing room. */
const TERMS_GAP_TITLE_TO_BODY_MM = 2.2;
/** Plain-text wrapped line height (mm). */
const TERMS_BODY_LINE_HEIGHT_MM = 4.65;
/** Inner bottom below last line / raster (mm). */
const TERMS_BOTTOM_INNER_MM = 4.5;
/**
 * Rich path: gap from PDF title baseline → top of html2canvas image (mm).
 * ~8px (~2.2mm) under “Terms & Conditions:” before the list raster.
 */
const TERMS_GAP_BELOW_TITLE_MM = 2.2;

const COMPANY_NAME = 'Lightspeed International Private Limited';
const COMPANY_CONTACT = '+92-327-9800153  |  www.wisdomup.pk';
const BRAND_LINE1 = 'LIGHTSPEED';
const BRAND_LINE2 = 'INTERNATIONAL';
const INVOICE_TITLE = 'SALE INVOICE';
const WISDOMUP = 'WisdomUp';

/** Collapse whitespace for one PDF line. */
function normalizeInvoiceLineText(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Turn stored terms HTML into logical lines for the invoice (numbered / bullet lists, paragraphs).
 * Plain `textContent` merges `<li>` siblings into one string — this preserves list markers and line breaks.
 */
function htmlToInvoiceTermsLogicalLines(html: string): string[] {
  if (typeof document === 'undefined' || !html.trim()) return [];
  try {
    const host = document.createElement('div');
    host.innerHTML = html;
    const lines: string[] = [];

    const pushBlock = (raw: string) => {
      const t = normalizeInvoiceLineText(raw);
      if (t) lines.push(t);
    };

    const liPlainText = (li: Element) => normalizeInvoiceLineText(li.textContent || '');

    const walk = (parent: Node) => {
      for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          pushBlock(node.textContent || '');
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        if (tag === 'ol') {
          let n = 1;
          el.querySelectorAll(':scope > li').forEach((li) => {
            const t = liPlainText(li);
            if (t) lines.push(`${n}. ${t}`);
            n += 1;
          });
          continue;
        }
        if (tag === 'ul') {
          el.querySelectorAll(':scope > li').forEach((li) => {
            const t = liPlainText(li);
            if (t) lines.push(`• ${t}`);
          });
          continue;
        }
        if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'blockquote') {
          pushBlock(el.textContent || '');
          continue;
        }
        if (tag === 'br') {
          continue;
        }
        if (tag === 'li') {
          const t = liPlainText(el);
          if (t) lines.push(`• ${t}`);
          continue;
        }
        walk(el);
      }
    };

    walk(host);
    return lines;
  } catch {
    const n = normalizeInvoiceLineText(html.replace(/<[^>]+>/g, ' '));
    return n ? [n] : [];
  }
}

const PDF_MM_TO_PX = 96 / 25.4;

/**
 * Trim flat #f2f2f2 bands from top and bottom of html2canvas output (wrapper padding / slack).
 */
function cropInvoiceTermsCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const [br, bg, bb] = TERMS_BOX_FILL;
  const tol = 14;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return canvas;

  const { data: d } = ctx.getImageData(0, 0, w, h);
  const rowHasInk = (y: number) => {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (
        Math.abs(d[i]! - br) > tol ||
        Math.abs(d[i + 1]! - bg) > tol ||
        Math.abs(d[i + 2]! - bb) > tol
      ) {
        return true;
      }
    }
    return false;
  };

  let top = 0;
  while (top < h && !rowHasInk(top)) top += 1;
  if (top >= h) return canvas;

  let bottom = h - 1;
  while (bottom >= top && !rowHasInk(bottom)) bottom -= 1;

  const margin = 1;
  const srcY = Math.max(0, top - margin);
  const srcBottom = Math.min(h - 1, bottom + margin);
  const srcH = srcBottom - srcY + 1;
  if (srcH <= 0 || (srcY === 0 && srcH >= h)) return canvas;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = srcH;
  const octx = out.getContext('2d');
  if (!octx) return canvas;
  octx.drawImage(canvas, 0, srcY, w, srcH, 0, 0, w, srcH);
  return out;
}

/** Plain-line terms block when raster capture is unavailable. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawInvoiceTermsPlainFallback(doc: any, html: string, yStart: number): number {
  const pad = TERMS_INNER_PAD_MM;
  const termsTextW = INNER_W - 2 * pad;
  const logicalTermLines = htmlToInvoiceTermsLogicalLines(html);
  const termsLines: string[] = [];
  for (const logical of logicalTermLines) {
    termsLines.push(...doc.splitTextToSize(logical, termsTextW));
  }
  if (termsLines.length === 0) return yStart;

  const lineH = TERMS_BODY_LINE_HEIGHT_MM;
  const termsBoxH =
    pad +
    TERMS_TITLE_BASELINE_MM +
    TERMS_GAP_TITLE_TO_BODY_MM +
    termsLines.length * lineH +
    TERMS_BOTTOM_INNER_MM;
  const y = yStart;

  doc.setFillColor(...TERMS_BOX_FILL);
  doc.setDrawColor(...PDF_BORDER_GRAY);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, INNER_W, termsBoxH, TERMS_BOX_CORNER_MM, TERMS_BOX_CORNER_MM, 'FD');

  const titleY = y + pad + TERMS_TITLE_BASELINE_MM;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TERMS_TITLE_FONT_PT);
  doc.setTextColor(0, 0, 0);
  doc.text('Terms & Conditions:', M + pad, titleY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TERMS_BODY_FONT_PT);
  doc.setTextColor(0, 0, 0);
  const bodyStartY = titleY + TERMS_GAP_TITLE_TO_BODY_MM;
  termsLines.forEach((line: string, i: number) => {
    doc.text(line, M + pad, bodyStartY + i * lineH);
  });

  return y + termsBoxH + TERMS_AFTER_BOX_GAP_MM;
}

/**
 * Renders terms HTML with the same styling as the order detail page (`.invoiceTermsRich`),
 * captures via html2canvas, and embeds in the PDF so bold, links, headings, lists match.
 */
async function drawInvoiceTermsRichBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsPDF instance from dynamic import
  doc: any,
  html: string,
  yStart: number,
): Promise<number> {
  let wrapper: HTMLDivElement | null = null;
  try {
    const { default: html2canvas } = await import('html2canvas');
    const pad = TERMS_INNER_PAD_MM;
    const innerContentWmm = INNER_W - 2 * pad;
    const contentWpx = Math.max(120, Math.ceil(innerContentWmm * PDF_MM_TO_PX));
    const padPx = Math.round(pad * PDF_MM_TO_PX);
    const bottomPadPx = Math.max(4, Math.round(1.5 * PDF_MM_TO_PX));

    wrapper = document.createElement('div');
    wrapper.className = 'invoiceTermsRich invoiceTermsRich--invoicePdfCapture';
    wrapper.setAttribute('dir', 'ltr');
    // Minimal padding-top: PDF already draws “Terms & Conditions:” — avoid double top gap.
    wrapper.style.cssText = [
      'position:fixed',
      'left:-14000px',
      'top:0',
      'z-index:-1',
      `width:${contentWpx}px`,
      'box-sizing:border-box',
      `padding:1px ${padPx}px ${bottomPadPx}px ${padPx}px`,
    ].join(';');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    let y = yStart;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const canvas = await html2canvas(wrapper, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#f2f2f2',
    });

    if (!canvas.width || !canvas.height) {
      return drawInvoiceTermsPlainFallback(doc, html, yStart);
    }

    const cropped = cropInvoiceTermsCanvas(canvas);
    const dataUrl = cropped.toDataURL('image/png');
    const cw = cropped.width;
    const ch = cropped.height;
    const MAX_IMG_H_MM = 88;
    let imgWmm = innerContentWmm;
    let imgHmm = (ch / cw) * imgWmm;
    if (imgHmm > MAX_IMG_H_MM) {
      imgHmm = MAX_IMG_H_MM;
      imgWmm = (cw / ch) * imgHmm;
    }
    const imgXMm = M + pad;

    const bottomPad = TERMS_BOTTOM_INNER_MM;
    const titleToImage =
      TERMS_TITLE_BASELINE_MM + TERMS_GAP_BELOW_TITLE_MM;
    const boxH = pad + titleToImage + imgHmm + bottomPad;

    const pageH = doc.internal.pageSize.getHeight();
    const reserveBottom = 52;
    if (y + boxH > pageH - reserveBottom) {
      doc.addPage();
      y = 14;
    }

    doc.setFillColor(...TERMS_BOX_FILL);
    doc.setDrawColor(...PDF_BORDER_GRAY);
    doc.setLineWidth(0.3);
    doc.roundedRect(M, y, INNER_W, boxH, TERMS_BOX_CORNER_MM, TERMS_BOX_CORNER_MM, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TERMS_TITLE_FONT_PT);
    doc.setTextColor(0, 0, 0);
    doc.text('Terms & Conditions:', M + pad, y + pad + TERMS_TITLE_BASELINE_MM);

    const imgTop = y + pad + titleToImage;
    doc.addImage(dataUrl, 'PNG', imgXMm, imgTop, imgWmm, imgHmm);

    return y + boxH + TERMS_AFTER_BOX_GAP_MM;
  } catch {
    return drawInvoiceTermsPlainFallback(doc, html, yStart);
  } finally {
    wrapper?.remove();
  }
}

function formatRs(n: number): string {
  return `Rs. ${Number(n).toFixed(2)}`;
}

function formatInvoiceNo(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `INV-${String(Math.floor(n)).padStart(6, '0')}`;
}

type DealerLike = Record<string, unknown> | null | undefined;

interface LoadedImage {
  data: string;
  naturalW: number;
  naturalH: number;
  format: 'JPEG' | 'PNG';
}

/** Pixels at/above this (RGB) are treated as “paper white” for header PNG blending. */
const LOGO_BLEND_WHITE_MIN = 245;

/** Dark-on-white `/logo.jpeg`: light pixels → header, dark → black. */
const LS_DOL_BG = 251; // L ≥ → header
const LS_DOL_INK = 88; // L ≤ → black

/** White-on-black `/logo.jpeg`: dark pixels → header, light → black (matches WisdomUp-style blend). */
const LS_LOD_BG_MAX = 82; // L ≤ → header (remove black plate)
const LS_LOD_INK_MIN = 178; // L ≥ → black (white artwork → black)

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function sampleLuminanceAt(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const xi = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const yi = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const i = (yi * w + xi) * 4;
  return luminance(d[i]!, d[i + 1]!, d[i + 2]!);
}

/** Corners / edges after draw — low average ⇒ black plate (white-on-dark art). */
function lightspeedLogoIsLightOnDark(d: Uint8ClampedArray, w: number, h: number): boolean {
  const pad = 2;
  const pts: [number, number][] = [
    [pad, pad],
    [w - 1 - pad, pad],
    [pad, h - 1 - pad],
    [w - 1 - pad, h - 1 - pad],
    [w / 2, pad],
    [w / 2, h - 1 - pad],
    [pad, h / 2],
    [w - 1 - pad, h / 2],
  ];
  let sum = 0;
  for (const [x, y] of pts) {
    sum += sampleLuminanceAt(d, w, h, x, y);
  }
  const avg = sum / pts.length;
  return avg < 130;
}

function applyLightspeedDarkOnLight(d: Uint8ClampedArray, hr: number, hg: number, hb: number): void {
  const span = Math.max(1, LS_DOL_BG - LS_DOL_INK);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    const L = luminance(r, g, b);
    if (L >= LS_DOL_BG) {
      d[i] = hr;
      d[i + 1] = hg;
      d[i + 2] = hb;
    } else if (L <= LS_DOL_INK) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
    } else {
      const t = Math.max(0, Math.min(1, (L - LS_DOL_INK) / span));
      d[i] = Math.round(hr * t);
      d[i + 1] = Math.round(hg * t);
      d[i + 2] = Math.round(hb * t);
    }
  }
}

function applyLightspeedLightOnDark(d: Uint8ClampedArray, hr: number, hg: number, hb: number): void {
  const span = Math.max(1, LS_LOD_INK_MIN - LS_LOD_BG_MAX);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    const L = luminance(r, g, b);
    if (L <= LS_LOD_BG_MAX) {
      d[i] = hr;
      d[i + 1] = hg;
      d[i + 2] = hb;
    } else if (L >= LS_LOD_INK_MIN) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
    } else {
      const k = Math.max(0, Math.min(1, (L - LS_LOD_BG_MAX) / span)); // 0 = black plate, 1 = white ink
      d[i] = Math.round(hr * (1 - k));
      d[i + 1] = Math.round(hg * (1 - k));
      d[i + 2] = Math.round(hb * (1 - k));
    }
  }
}

/**
 * `/logo.jpeg` on invoice: auto dark-on-white vs white-on-black, then map to black art on header fill.
 */
function applyLightspeedHeaderLogoToCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const [hr, hg, hb] = INVOICE_HEADER_FILL;
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  if (lightspeedLogoIsLightOnDark(d, w, h)) {
    applyLightspeedLightOnDark(d, hr, hg, hb);
  } else {
    applyLightspeedDarkOnLight(d, hr, hg, hb);
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Loads an image into a canvas (fills white or header gray behind transparency),
 * optionally inverts pixels to replicate `filter: invert(1)`, and returns
 * a base64 data URL + natural dimensions for use with jsPDF addImage.
 *
 * When `blendWithHeaderBackground` is true, PNGs use near-white → header fill.
 * When `blendWithHeaderBackground` and `invert` (invoice `/logo.jpeg` only), uses
 * luminance remapping with auto polarity (white-on-black vs dark-on-white) so the
 * mark is black on the header fill with no separate plate.
 */
async function loadImageForPdf(
  src: string,
  invert = false,
  blendWithHeaderBackground = false,
): Promise<LoadedImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        const [bgR, bgG, bgB] = blendWithHeaderBackground
          ? INVOICE_HEADER_FILL
          : [255, 255, 255];
        ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        const nearPaperWhite = (r: number, g: number, b: number) =>
          r >= LOGO_BLEND_WHITE_MIN && g >= LOGO_BLEND_WHITE_MIN && b >= LOGO_BLEND_WHITE_MIN;

        if (blendWithHeaderBackground && invert) {
          applyLightspeedHeaderLogoToCanvas(ctx, canvas.width, canvas.height);
        } else if (blendWithHeaderBackground) {
          const [hr, hg, hb] = INVOICE_HEADER_FILL;
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imageData.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i]!;
            const g = d[i + 1]!;
            const b = d[i + 2]!;
            if (nearPaperWhite(r, g, b)) {
              d[i] = hr;
              d[i + 1] = hg;
              d[i + 2] = hb;
            }
          }
          ctx.putImageData(imageData, 0, 0);
        } else if (invert) {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imageData.data;
          for (let i = 0; i < d.length; i += 4) {
            d[i] = 255 - d[i]!;
            d[i + 1] = 255 - d[i + 1]!;
            d[i + 2] = 255 - d[i + 2]!;
          }
          ctx.putImageData(imageData, 0, 0);
        }
        const isPng = src.toLowerCase().endsWith('.png');
        resolve({
          data: canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg'),
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          format: isPng ? 'PNG' : 'JPEG',
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function dealerDisplayName(dealer: DealerLike): string {
  if (!dealer) return '—';
  const shop =
    typeof dealer.shopName === 'string' && dealer.shopName.trim() ? dealer.shopName.trim() : '';
  const name =
    typeof dealer.name === 'string' && dealer.name.trim() ? dealer.name.trim() : '';
  return shop || name || '—';
}

function dealerAddressLine(dealer: DealerLike): string {
  const a = dealer?.address;
  if (!a || typeof a !== 'object') return '—';
  const o = a as Record<string, unknown>;
  const parts = [o.street, o.city, o.state, o.country, o.postalCode].filter(
    (x) => typeof x === 'string' && (x as string).trim(),
  ) as string[];
  return parts.length ? parts.join(', ') : '—';
}

function dealerPhone(dealer: DealerLike): string {
  const p = dealer?.phone;
  return typeof p === 'string' && p.trim() ? p.trim() : '—';
}

function paymentLabel(type?: string): string {
  if (!type) return '—';
  const m: Record<string, string> = {
    online: 'Online',
    cash: 'Cash',
    credit: 'Credit',
    adjustment: 'Adjustment',
  };
  return m[type] ?? type;
}

function bookedByName(order: Order): string {
  return employeeDisplayLabel(order.createdBy)?.charAt(0).toUpperCase() + employeeDisplayLabel(order.createdBy)?.slice(1) || '—';
}

function approvedByName(order: Order): string {
  return employeeDisplayLabel(order.approvedBy)?.charAt(0).toUpperCase() + employeeDisplayLabel(order.approvedBy)?.slice(1) || '—';
}

export async function buildOrderInvoicePdfBlob(order: Order): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const dealer = order.dealerId as DealerLike;
  const [logoImg, wisdomupImg] = await Promise.all([
    loadImageForPdf('/logo.jpeg', true, true), // luminance → black on header (no white box)
    loadImageForPdf('/wisdomup.png', false, true),
  ]);

  // ── HEADER BAND (fill + dark stroke + radius — logos unchanged) ─────────
  const headerTop = 10;
  const headerH = 36;

  doc.setFillColor(...INVOICE_HEADER_FILL);
  doc.setDrawColor(...PDF_BORDER_GRAY);
  doc.setLineWidth(0.3);
  doc.roundedRect(
    M,
    headerTop,
    INNER_W,
    headerH,
    INVOICE_HEADER_CORNER_MM,
    INVOICE_HEADER_CORNER_MM,
    'FD',
  );

  // Left: WisdomUp logo image (proportionally fitted in a 28×28 mm slot)
  const leftSlotW = 28;
  const leftSlotH = headerH - 6;
  const leftSlotX = M + 2;
  const leftSlotY = headerTop + 3;
  if (wisdomupImg) {
    const aspect = wisdomupImg.naturalW / wisdomupImg.naturalH;
    let imgW = leftSlotW;
    let imgH = imgW / aspect;
    if (imgH > leftSlotH) { imgH = leftSlotH; imgW = imgH * aspect; }
    const imgX = leftSlotX + (leftSlotW - imgW) / 2;
    const imgY = leftSlotY + (leftSlotH - imgH) / 2;
    doc.addImage(wisdomupImg.data, wisdomupImg.format, imgX, imgY, imgW, imgH);
  } else {
    // Fallback: dark circle with "W"
    const cx = M + 14;
    const cy = headerTop + 13;
    doc.setFillColor(17, 24, 39);
    doc.circle(cx, cy, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text('W', cx, cy + 0.8, { align: 'center', baseline: 'middle' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(31, 41, 55);
    doc.text(WISDOMUP, cx, headerTop + headerH - 4, { align: 'center' });
  }

  // Center: company name, contact line, SALE INVOICE banner
  const centerX = PAGE_W / 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15.5);
  doc.setTextColor(0, 0, 0);
  doc.text(COMPANY_NAME, centerX, headerTop + 9, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(102, 102, 102); // ~#666
  doc.text(COMPANY_CONTACT, centerX, headerTop + 17.5, { align: 'center' });

  // SALE INVOICE black banner (centered, rounded)
  const bannerW = 58;
  const bannerH = 8;
  const bannerX = centerX - bannerW / 2;
  const bannerY = headerTop + 21;
  doc.setFillColor(0, 0, 0);
  doc.roundedRect(
    bannerX,
    bannerY,
    bannerW,
    bannerH,
    INVOICE_BANNER_CORNER_MM,
    INVOICE_BANNER_CORNER_MM,
    'F',
  );
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(INVOICE_TITLE, centerX, bannerY + 5.4, { align: 'center' });

  // Right: logo image fitted proportionally within a 38×28 mm slot (or fallback text box)
  const slotW = 38;
  const slotH = 28;
  const slotX = M + INNER_W - slotW - 2;
  const slotY = headerTop + 3;
  if (logoImg) {
    const aspect = logoImg.naturalW / logoImg.naturalH;
    let imgW = slotW;
    let imgH = imgW / aspect;
    if (imgH > slotH) { imgH = slotH; imgW = imgH * aspect; }
    const imgX = slotX + (slotW - imgW) / 2;
    const imgY = slotY + (slotH - imgH) / 2;
    doc.addImage(logoImg.data, 'JPEG', imgX, imgY, imgW, imgH);
  } else {
    doc.setFillColor(0, 0, 0);
    doc.roundedRect(
      slotX,
      slotY,
      slotW,
      slotH,
      INVOICE_RIGHT_BADGE_CORNER_MM,
      INVOICE_RIGHT_BADGE_CORNER_MM,
      'F',
    );
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(BRAND_LINE1, slotX + slotW / 2, slotY + 11, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(BRAND_LINE2, slotX + slotW / 2, slotY + 17, { align: 'center' });
  }

  let y = headerTop + headerH + 6;

  // ── BILL TO / INVOICE DETAILS (two equal rounded boxes + gutter) ────────
  const pad = 4;
  const lineH = 5.5;
  const billBoxH = 3 * lineH + 14;
  const gutter = 3;
  const boxW = (INNER_W - gutter) / 2;
  const leftBoxX = M;
  const rightBoxX = M + boxW + gutter;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PDF_BORDER_GRAY);
  doc.setLineWidth(0.3);
  doc.roundedRect(
    leftBoxX,
    y,
    boxW,
    billBoxH,
    INVOICE_HEADER_CORNER_MM,
    INVOICE_HEADER_CORNER_MM,
    'FD',
  );
  doc.roundedRect(
    rightBoxX,
    y,
    boxW,
    billBoxH,
    INVOICE_HEADER_CORNER_MM,
    INVOICE_HEADER_CORNER_MM,
    'FD',
  );

  // "BILL TO" header + underline (line width = text width)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text('BILL TO', leftBoxX + pad, y + 7);
  const billToW = doc.getTextWidth('BILL TO');
  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.4);
  doc.line(leftBoxX + pad, y + 8, leftBoxX + pad + billToW, y + 8);

  // "INVOICE DETAILS" header + underline
  doc.text('INVOICE DETAILS', rightBoxX + pad, y + 7);
  const invDetW = doc.getTextWidth('INVOICE DETAILS');
  doc.line(rightBoxX + pad, y + 8, rightBoxX + pad + invDetW, y + 8);

  doc.setDrawColor(...PDF_BORDER_GRAY);
  doc.setLineWidth(0.3);

  const billFields = [
    ['Party / Customer Name', dealerDisplayName(dealer)],
    ['Address', dealerAddressLine(dealer)],
    ['Phone No#', dealerPhone(dealer)],
  ];
  const invFields = [
    ['Invoice No#', formatInvoiceNo(order.invoiceNumber)],
    ['Date', order.createdAt ? format(new Date(order.createdAt), 'MMM dd, yyyy') : '—'],
    ['Mode of Payment', paymentLabel(order.paymentType)],
  ];

  doc.setFontSize(8.5);
  billFields.forEach(([label, value], i) => {
    const ty = y + 13 + i * lineH;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    const lbl = `${label}:`;
    doc.text(lbl, leftBoxX + pad, ty);
    const lblW = doc.getTextWidth(lbl);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(31, 41, 55);
    const maxW = boxW - pad * 2 - lblW - 2;
    const wrapped = doc.splitTextToSize(value, maxW);
    doc.text(wrapped[0] ?? value, leftBoxX + pad + lblW + 2, ty);
  });

  invFields.forEach(([label, value], i) => {
    const ty = y + 13 + i * lineH;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    const lbl = `${label}:`;
    doc.text(lbl, rightBoxX + pad, ty);
    const lblW = doc.getTextWidth(lbl);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(31, 41, 55);
    doc.text(value, rightBoxX + pad + lblW + 2, ty);
  });

  y += billBoxH + 6;

  // ── LINE ITEMS TABLE ───────────────────────────────────────────────────
  const head = [['Sr#', 'Item Code', 'Description', 'Unit Price', 'Qty', 'Total Price']];
  const body: string[][] = [];
  const products = order.products ?? [];
  products.forEach((item, idx) => {
    const p = (item.productId || {}) as Record<string, unknown>;
    const code = typeof p.barcode === 'string' ? p.barcode : '—';
    const name = typeof p.name === 'string' ? p.name : '—';
    const lineTotal = item.quantity * item.price;
    body.push([
      String(idx + 1),
      code,
      name,
      formatRs(item.price),
      String(item.quantity),
      formatRs(lineTotal),
    ]);
  });

  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2,
      textColor: [31, 41, 55],
      valign: 'middle',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [31, 41, 55],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 26, halign: 'center' },
      2: { cellWidth: 68 },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 36, halign: 'right' },
    },
    margin: { left: M, right: M, bottom: 20 },
    tableLineColor: [180, 180, 180],
    tableLineWidth: 0.2,
    showHead: 'everyPage',
    didDrawPage: (data) => {
      const d = data.doc;
      const ph = d.internal.pageSize.getHeight();
      d.setFont('helvetica', 'normal');
      d.setFontSize(7.5);
      d.setTextColor(120, 120, 120);
      d.text(`${COMPANY_NAME}  |  ${COMPANY_CONTACT}`, PAGE_W / 2, ph - 8, { align: 'center' });
    },
  });

  const withTable = doc as unknown as { lastAutoTable?: { finalY: number } };
  const finalY = withTable.lastAutoTable?.finalY ?? y + 20;
  y = finalY + 6;

  // ── TOTALS (template: bordered stack, square corners; Net Balance = black bar) ─
  const totalPrice =
    order.totalPrice ?? products.reduce((s, it) => s + it.quantity * it.price, 0);
  const discount = order.discount ?? 0;
  const grandTotal = order.grandTotal ?? totalPrice - discount;

  const totalsBlockW = 80;
  const totalsLeftX = M + INNER_W - totalsBlockW;
  const totalsRightX = M + INNER_W;
  const rowH = 6.5;
  const totalsStartY = y;
  const blockH = 4 * rowH;

  doc.setDrawColor(...PDF_BORDER_GRAY);
  doc.setLineWidth(0.3);
  // Row dividers (between all four logical rows; top/bottom come from outer stroke)
  for (let i = 1; i <= 3; i += 1) {
    const ly = totalsStartY + i * rowH;
    doc.line(totalsLeftX, ly, totalsRightX, ly);
  }

  const netY = totalsStartY + 3 * rowH;
  doc.setFillColor(0, 0, 0);
  doc.rect(totalsLeftX, netY, totalsBlockW, rowH, 'F');

  doc.setDrawColor(...PDF_BORDER_GRAY);
  doc.setLineWidth(0.3);
  doc.rect(totalsLeftX, totalsStartY, totalsBlockW, blockH, 'S');

  const textRows: { label: string; value: string; net: boolean }[] = [
    { label: 'Total:', value: formatRs(totalPrice), net: false },
    { label: 'Discount:', value: formatRs(discount), net: false },
    { label: 'Adjustment:', value: formatRs(0), net: false },
    { label: 'Net Balance:', value: formatRs(grandTotal), net: true },
  ];
  textRows.forEach((row, i) => {
    const rowY = totalsStartY + i * rowH;
    const textY = rowY + rowH - 2;
    if (row.net) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(31, 41, 55);
    }
    doc.text(row.label, totalsLeftX + 4, textY);
    doc.text(row.value, totalsRightX - 3, textY, { align: 'right' });
  });

  y = totalsStartY + blockH + 7;

  // ── TERMS & CONDITIONS (rich HTML via html2canvas — matches order detail) ─
  const rawTerms = order.termsAndConditions?.trim();
  if (rawTerms) {
    y = await drawInvoiceTermsRichBlock(doc, rawTerms, y);
  }

  // ── SIGNATURES (template: black line, bold title, gray subtitle, generous gap) ─
  const third = INNER_W / 3;
  const sigs: [string, string][] = [
    ['Prepared By', bookedByName(order)],
    ['Booked By', bookedByName(order)],
    ['Approved By', approvedByName(order)],
  ];

  const sigGapAfterTerms = rawTerms ? 6 : 4;
  const sigY = y + sigGapAfterTerms;
  sigs.forEach(([label, sub], i) => {
    const sx = M + i * third + third / 2;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.35);
    doc.line(sx - 26, sigY, sx + 26, sigY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TERMS_TITLE_FONT_PT);
    doc.setTextColor(0, 0, 0);
    doc.text(label, sx, sigY + 5.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(102, 102, 102);
    doc.text(sub, sx, sigY + 10.5, { align: 'center' });
  });

  // ── FOOTER ─────────────────────────────────────────────────────────────
  const ph = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text(`${COMPANY_NAME}  |  ${COMPANY_CONTACT}`, PAGE_W / 2, ph - 8, { align: 'center' });

  return doc.output('blob');
}

export async function printOrderInvoice(order: Order): Promise<void> {
  const blob = await buildOrderInvoicePdfBlob(order);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  const triggerPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      // ignore
    }
  };
  win.addEventListener('load', triggerPrint, { once: true });
  setTimeout(triggerPrint, 900);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
