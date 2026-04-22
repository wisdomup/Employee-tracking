import sanitizeHtml from 'sanitize-html';

/** TipTap may emit `<span style="font-weight: bold">`; without `style` on span, bold disappears after save. */
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'blockquote', 'span'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['class', 'style'],
    p: ['class', 'style'],
    li: ['class', 'style'],
  },
  allowedStyles: {
    '*': {
      'text-decoration': [/^(underline|none|line-through)$/i],
    },
    span: {
      'font-weight': [/^(bold|normal|bolder|lighter|[1-9]00)$/i],
      'font-style': [/^(italic|normal)$/i],
    },
    p: {
      'font-weight': [/^(bold|normal|bolder|lighter|[1-9]00)$/i],
      'font-style': [/^(italic|normal)$/i],
    },
    li: {
      'font-weight': [/^(bold|normal|bolder|lighter|[1-9]00)$/i],
      'font-style': [/^(italic|normal)$/i],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
};

/** Returns sanitized HTML or `undefined` when empty / not a string. */
export function sanitizeOrderTermsHtml(raw: unknown): string | undefined {
  if (raw == null || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const clean = sanitizeHtml(trimmed, SANITIZE_OPTS).trim();
  if (!clean) return undefined;
  return clean;
}
