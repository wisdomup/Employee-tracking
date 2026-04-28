const DEFAULT_INVOICE_TERMS_LINES = [
  'Return or exchange is allowed within 7 days of purchase with original invoice only.',
  'Any damaged or defective goods will be handled as per company claim policy only.',
  'Sold goods will not be accepted without original bill.',
];

export const DEFAULT_INVOICE_TERMS_HTML = `<ol>${DEFAULT_INVOICE_TERMS_LINES.map((line) => `<li>${line}</li>`).join('')}</ol>`;

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isInvoiceTermsEmpty(value?: string | null): boolean {
  if (!value) return true;
  return stripHtml(value) === '';
}

export function withDefaultInvoiceTerms(value?: string | null): string {
  return isInvoiceTermsEmpty(value) ? DEFAULT_INVOICE_TERMS_HTML : value!;
}
