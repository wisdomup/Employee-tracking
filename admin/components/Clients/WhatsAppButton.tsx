import React from 'react';
import { WhatsappLogo } from '@phosphor-icons/react';
import {
  buildWhatsAppUrl,
  type WhatsAppMessageVars,
} from '../../utils/whatsapp';

interface WhatsAppButtonProps {
  /** Client phone as stored (local format, `-`, or empty). */
  phone?: string | null;
  /** Greeting template; `{name}` / `{shop}` are substituted. */
  message?: string;
  /** Values for the template placeholders. */
  vars?: WhatsAppMessageVars;
  /** Render a disabled stub instead of nothing when the number is unusable. */
  showWhenUnavailable?: boolean;
  className?: string;
}

const ICON_SIZE = 18;

/**
 * Opens a WhatsApp chat with a client, pre-filled with the greeting.
 *
 * Renders nothing when the number is missing or unusable — an enabled button
 * that opens the wrong chat is worse than no button.
 */
const WhatsAppButton: React.FC<WhatsAppButtonProps> = ({
  phone,
  message,
  vars,
  showWhenUnavailable = false,
  className,
}) => {
  const href = buildWhatsAppUrl(phone, message, vars);

  if (!href) {
    if (!showWhenUnavailable) return null;
    return (
      <span
        title="No WhatsApp number on file for this client"
        aria-label="WhatsApp unavailable"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: '#d1d5db',
          cursor: 'not-allowed',
        }}
        className={className}
      >
        <WhatsappLogo size={ICON_SIZE} weight="fill" aria-hidden />
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Message ${vars?.name?.trim() || 'this client'} on WhatsApp`}
      aria-label="Open WhatsApp chat"
      onClick={(e) => e.stopPropagation()}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.875rem',
        height: '1.875rem',
        borderRadius: '0.375rem',
        background: '#dcfce7',
        color: '#15803d',
        transition: 'background-color 0.2s',
      }}
    >
      <WhatsappLogo size={ICON_SIZE} weight="fill" aria-hidden />
    </a>
  );
};

export default WhatsAppButton;
