import React, { useEffect } from 'react';
import { format } from 'date-fns';
import { InboxBroadcastItem } from '../../services/broadcastNotificationService';
import styles from '../../styles/Dashboard.module.scss';

function scheduleHint(item: InboxBroadcastItem) {
  const parts: string[] = [];
  if (item.startAt) parts.push(`From ${format(new Date(item.startAt), 'MMM d, yyyy')}`);
  if (item.endAt) parts.push(`until ${format(new Date(item.endAt), 'MMM d, yyyy')}`);
  return parts.length ? parts.join(' · ') : null;
}

interface BroadcastMessageModalProps {
  item: InboxBroadcastItem | null;
  onClose: () => void;
  onMarkRead: () => void;
  marking: boolean;
}

const BroadcastMessageModal: React.FC<BroadcastMessageModalProps> = ({
  item,
  onClose,
  onMarkRead,
  marking,
}) => {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const hint = scheduleHint(item);

  return (
    <div className={styles.inboxModalOverlay} role="presentation" onClick={onClose}>
      <div
        className={styles.inboxModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="broadcast-inbox-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="broadcast-inbox-modal-title" className={styles.inboxModalTitle}>
          {item.title}
        </h3>
        {hint ? <div className={styles.inboxModalMeta}>{hint}</div> : null}
        {item.description ? (
          <div className={styles.inboxModalBody}>{item.description}</div>
        ) : (
          <p className={styles.inboxModalBodyMuted}>No additional details.</p>
        )}
        <div className={styles.inboxModalActions}>
          {!item.read && (
            <button
              type="button"
              className={styles.inboxPrimaryBtn}
              disabled={marking}
              onClick={onMarkRead}
            >
              {marking ? 'Saving…' : 'Mark as read'}
            </button>
          )}
          <button type="button" className={styles.inboxSecondaryBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default BroadcastMessageModal;
