import React, { useEffect, useState } from 'react';
import styles from '../../styles/Modal.module.scss';

/**
 * "Give a reason" confirmation dialog.
 *
 * The spec is explicit that mistakes are never deleted — they are cancelled with a reason and the
 * stock reversed. That makes a required-reason prompt the standard destructive action across the
 * module (cancel a receipt, reject a transfer, reject a damage claim, resolve a mismatch), which is
 * why it is a component rather than eight copies of the same overlay.
 */
interface ReasonModalProps {
  open: boolean;
  title: string;
  /** Sentence explaining what will happen to the stock. Worth being explicit. */
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Set false for prompts where a note is genuinely optional. Default true. */
  required?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}

/**
 * The gate is a separate component from the body so that closing UNMOUNTS the body. The draft
 * reason then resets for free, without an effect that writes state on open (which triggers a
 * cascading render and is what `react-hooks/set-state-in-effect` warns about).
 */
const ReasonModal: React.FC<ReasonModalProps> = ({ open, ...rest }) =>
  open ? <ReasonModalBody {...rest} /> : null;

const ReasonModalBody: React.FC<Omit<ReasonModalProps, 'open'>> = ({
  title,
  description,
  label = 'Reason',
  placeholder = 'Why is this being done?',
  confirmLabel = 'Confirm',
  required = true,
  busy = false,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  // The API enforces a 3-character minimum; matching it here avoids a pointless round trip.
  const tooShort = required && reason.trim().length < 3;

  const handleConfirm = async () => {
    setTouched(true);
    if (tooShort) return;
    await onConfirm(reason.trim());
  };

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className={styles.modalContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.modalHeader}>
          <h2>{title}</h2>
        </div>

        {description && (
          <p style={{ margin: '0 0 16px', color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>
            {description}
          </p>
        )}

        <div className={styles.formGroup}>
          <label htmlFor="reason-modal-input">
            {label}
            {required ? ' *' : ''}
          </label>
          <textarea
            id="reason-modal-input"
            rows={3}
            value={reason}
            placeholder={placeholder}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          {touched && tooShort && (
            <span style={{ color: '#b91c1c', fontSize: 12 }}>
              Please give a reason of at least 3 characters — it is recorded on the document.
            </span>
          )}
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.cancelButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.submitButton}
            onClick={handleConfirm}
            disabled={busy || tooShort}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReasonModal;
