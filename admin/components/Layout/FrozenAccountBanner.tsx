import React, { useEffect, useState } from 'react';
import { Snowflake } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { accountFreezeService, FreezeStatus } from '../../services/accountFreezeService';
import styles from './FrozenAccountBanner.module.scss';

/** Same number the login page offers for "Contact admin". */
const CONTACT_ADMIN_WHATSAPP_URL = 'https://wa.me/923279800153';

/**
 * Tells a frozen rider why every action is being refused, and who to talk to.
 *
 * Rendered above the page content on every screen, because the freeze applies everywhere —
 * putting it only on the visits page would leave a rider who lands on Orders staring at
 * unexplained 403s.
 *
 * The state is re-fetched from the server on mount rather than read from the stored user:
 * a rider is typically frozen *during* a session they are already signed into, so the
 * copy in localStorage is exactly the thing that is out of date. The stored value is used
 * as the initial paint so the banner does not flicker in for someone who was already
 * frozen when they signed in.
 */
const FrozenAccountBanner: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<FreezeStatus | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    accountFreezeService
      .getMyStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      // A failed status check must never blank the page. Worst case the banner is missing
      // and the rider still gets the server's refusal message on the action they attempt.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  const frozen = status ? status.isFrozen : user?.isFrozen === true;
  if (!isAuthenticated || !frozen) return null;

  const reason =
    status?.frozenReason ||
    user?.frozenReason ||
    'Your account is frozen. Please contact the admin to have it unfrozen.';
  const frozenAt = status?.frozenAt ?? user?.frozenAt ?? null;

  return (
    <div className={styles.banner} role="alert">
      <Snowflake size={22} weight="fill" className={styles.icon} aria-hidden />
      <div className={styles.body}>
        <p className={styles.title}>Your account is frozen</p>
        <p className={styles.reason}>{reason}</p>
        {frozenAt && (
          <p className={styles.meta}>
            Frozen on {format(new Date(frozenAt), 'MMM dd, yyyy')} at{' '}
            {format(new Date(frozenAt), 'h:mm a')}. You can still view your work, but you
            cannot record anything until an admin unfreezes your account.
          </p>
        )}
        <a
          href={CONTACT_ADMIN_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.contactLink}
        >
          Contact admin
        </a>
      </div>
    </div>
  );
};

export default FrozenAccountBanner;
