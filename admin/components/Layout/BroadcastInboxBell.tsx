import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Bell } from '@phosphor-icons/react';
import { useBroadcastInbox } from '../../contexts/BroadcastInboxContext';
import styles from './BroadcastInboxBell.module.scss';

const BroadcastInboxBell: React.FC = () => {
  const { items, unreadCount, loading, openMessage } = useBroadcastInbox();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bellButton}
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Messages, ${unreadCount} unread` : 'Messages'}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={22} weight="duotone" aria-hidden />
        {unreadCount > 0 ? (
          <span className={styles.badge} aria-hidden>
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Message inbox">
          <div className={styles.panelHeader}>Messages</div>
          <div className={styles.panelScroll}>
            {loading ? (
              <div className={styles.panelLoading}>Loading…</div>
            ) : items.length === 0 ? (
              <div className={styles.panelEmpty}>No messages.</div>
            ) : (
              <ul className={styles.panelList}>
                {items.map((item) => (
                  <li key={item._id}>
                    <button
                      type="button"
                      className={`${styles.panelRow} ${!item.read ? styles.panelRowUnread : ''}`}
                      onClick={() => {
                        openMessage(item);
                        setOpen(false);
                      }}
                    >
                      <span className={styles.panelRowTitle}>{item.title}</span>
                      <span className={styles.panelRowMeta}>
                        {format(new Date(item.createdAt), 'MMM d, yyyy')}
                        {!item.read ? ' · New' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BroadcastInboxBell;
