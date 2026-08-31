/**
 * WhatsApp deep links for client phone numbers.
 *
 * Numbers are stored the way staff type them — local Pakistani format
 * (`03219102787`), sometimes with spaces/dashes, sometimes a literal `-`
 * placeholder. wa.me needs a bare international number, so normalise here and
 * let callers hide the button when normalisation fails.
 */

/** Default greeting; editable per user on the clients list. */
export const DEFAULT_WHATSAPP_GREETING =
  'Assalam-o-Alaikum {name}, LightSpeed Go se rabta kiya ja raha hai.';

/** Placeholders `renderWhatsAppMessage` substitutes, shown as a hint in the UI. */
export const WHATSAPP_MESSAGE_PLACEHOLDERS = ['{name}', '{shop}'] as const;

export interface WhatsAppMessageVars {
  name?: string;
  shop?: string;
}

/**
 * Convert a stored phone number to wa.me form (`923219102787`), or `null` when
 * it cannot be dialled — empty, the `-` placeholder, too short, or a format we
 * would have to guess at.
 */
export function toWhatsAppNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '-') return null;

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // 0092… international dial-out prefix
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith('92')) {
    // already country-coded
  } else if (digits.startsWith('0')) {
    // local format: drop the trunk 0, prepend the country code
    digits = `92${digits.replace(/^0+/, '')}`;
  } else if (digits.length === 10 && digits.startsWith('3')) {
    // mobile typed without the trunk 0
    digits = `92${digits}`;
  } else {
    // Foreign or unrecognised — guessing a country code would open the wrong chat.
    return null;
  }

  // 92 + 9–11 digits covers PK mobiles (92 3XX XXXXXXX) and landlines.
  // Truncated entries like `0300` fall out here.
  return /^92\d{9,11}$/.test(digits) ? digits : null;
}

/** Fill `{name}` / `{shop}` in a greeting template. Unknown values collapse to ''. */
export function renderWhatsAppMessage(
  template: string,
  vars: WhatsAppMessageVars = {},
): string {
  return template
    .replace(/\{name\}/g, vars.name?.trim() ?? '')
    .replace(/\{shop\}/g, vars.shop?.trim() ?? '')
    // A missing name leaves "Assalam-o-Alaikum , ..." — tidy the seams.
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

/** `https://wa.me/<number>?text=<message>`, or `null` for an undiallable number. */
export function buildWhatsAppUrl(
  phone?: string | null,
  message?: string,
  vars?: WhatsAppMessageVars,
): string | null {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  const text = renderWhatsAppMessage(message ?? '', vars);
  return text
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${number}`;
}
