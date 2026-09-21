import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Snowflake, X } from '@phosphor-icons/react';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import { accountFreezeService, FineOverview } from '../../services/accountFreezeService';
import { formatRs } from '../../utils/formatCurrency';
import styles from './FreezeFinesAdminBanner.module.scss';

/**
 * The admin's half of the freeze banner: who is locked out right now, and what today's late
 * starts have cost.
 *
 * The rider is told on their own screen the moment they are frozen; without this the admin
 * learns about it only by opening Frozen Accounts, which is the one screen nobody opens on a
 * day they do not already suspect a problem. A freeze is somebody unable to work — it should
 * find the admin, not wait to be found.
 *
 * Rendered on the dashboard only, and only for people who can act on it. On every screen it
 * became wallpaper: frozen accounts stay frozen until somebody lifts them, so it never went
 * away and nobody read it.
 *
 * Dismissible. Closing it hides it until something CHANGES — another rider frozen, another
 * fine raised, or a new day — so dismissing it never hides a fresh freeze.
 */

const DISMISS_KEY = 'freeze-fines-banner-dismissed';

/** What the banner is currently saying. A different value means there is news to show. */
function signatureOf(overview: FineOverview): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${today}|${overview.frozenCount}|${overview.finedToday}`;
}

/** Browser storage can be blocked (private window, cleared site data); never let that throw. */
function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(value: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, value);
  } catch {
    // Storage unavailable: the banner simply comes back on the next visit.
  }
}
const FreezeFinesAdminBanner: React.FC = () => {
  const { isAuthenticated, accessLoading } = useAuth();
  const [overview, setOverview] = useState<FineOverview | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    // Waiting on `accessLoading` matters: permissions arrive after the first paint, so
    // deciding before they land hides the banner from an admin on every hard refresh.
    if (!isAuthenticated || accessLoading) return;
    if (!can(undefined, 'account-freeze:view')) return;

    let cancelled = false;
    accountFreezeService
      .getFineOverview()
      .then((next) => {
        if (cancelled) return;
        setOverview(next);
        setDismissed(readDismissed());
      })
      // A failed count must never blank the page; the queue screen is still there.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, accessLoading]);

  // Nothing frozen and nothing charged today is the normal state — no banner for it.
  if (!overview || (overview.frozenCount === 0 && overview.finedToday === 0)) return null;
  if (dismissed === signatureOf(overview)) return null;

  const dismiss = () => {
    const signature = signatureOf(overview);
    writeDismissed(signature);
    setDismissed(signature);
  };

  return (
    <div className={styles.banner} role="status">
      <Snowflake size={22} weight="fill" className={styles.icon} aria-hidden />
      <div className={styles.body}>
        <p className={styles.title}>
          {overview.frozenCount > 0
            ? `${overview.frozenCount} account${overview.frozenCount === 1 ? '' : 's'} frozen`
            : 'Late starts today'}
        </p>
        <p className={styles.reason}>
          {overview.finedToday > 0 ? (
            <>
              {overview.finedToday} late-start fine
              {overview.finedToday === 1 ? '' : 's'} raised today, worth{' '}
              <strong>{formatRs(overview.finesTodayTotal)}</strong>.
            </>
          ) : (
            <>No fines raised today.</>
          )}{' '}
          {overview.outstandingTotal > 0 && (
            /* Still to recover, not a fine count: part of a fine can already have come off
               pay, so counting rows here would contradict the rupees beside it. */
            <>{formatRs(overview.outstandingTotal)} still to recover from pay.</>
          )}
        </p>
        {overview.recoveredTotal > 0 && (
          <p className={styles.meta}>
            {formatRs(overview.recoveredTotal)} has been recovered through payroll so far.
          </p>
        )}
        <p className={styles.meta}>
          The standard fine is {formatRs(overview.defaultFineAmount)} per late start. You can
          set a different amount for an individual rider, waive a fine, or unfreeze an account
          from Frozen Accounts.
        </p>
        <Link href="/frozen-accounts" className={styles.link}>
          Open Frozen Accounts
        </Link>
      </div>
      <button type="button" className={styles.close} onClick={dismiss} aria-label="Dismiss">
        <X size={18} weight="bold" aria-hidden />
      </button>
    </div>
  );
};

export default FreezeFinesAdminBanner;
