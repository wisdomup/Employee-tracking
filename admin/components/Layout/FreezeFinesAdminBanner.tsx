import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Snowflake } from '@phosphor-icons/react';
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
 * Rendered on every screen for the same reason the rider's banner is, and only for people who
 * can actually act on it: the link leads to the unfreeze queue, so an admin who cannot open
 * that page is shown nothing.
 */
const FreezeFinesAdminBanner: React.FC = () => {
  const { isAuthenticated, accessLoading } = useAuth();
  const [overview, setOverview] = useState<FineOverview | null>(null);

  useEffect(() => {
    // Waiting on `accessLoading` matters: permissions arrive after the first paint, so
    // deciding before they land hides the banner from an admin on every hard refresh.
    if (!isAuthenticated || accessLoading) return;
    if (!can(undefined, 'account-freeze:view')) return;

    let cancelled = false;
    accountFreezeService
      .getFineOverview()
      .then((next) => {
        if (!cancelled) setOverview(next);
      })
      // A failed count must never blank the page; the queue screen is still there.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, accessLoading]);

  // Nothing frozen and nothing charged today is the normal state — no banner for it.
  if (!overview || (overview.frozenCount === 0 && overview.finedToday === 0)) return null;

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
    </div>
  );
};

export default FreezeFinesAdminBanner;
