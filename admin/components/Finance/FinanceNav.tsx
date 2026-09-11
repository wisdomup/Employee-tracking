import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { can, canViewAnyReportOn, canViewReport } from '../../utils/permissions';
import styles from '../../styles/Finance.module.scss';

/**
 * Tabs across the finance module.
 *
 * The sidebar carries one entry for the whole module, matching `/warehouse` and `/collection`,
 * because its nav highlighting matches on `startsWith` and sibling entries would break it. This
 * is how the sub-screens are reached instead.
 *
 * Each tab is hidden when its permission is absent rather than shown and refused. A tab that
 * 403s teaches people to distrust the whole nav.
 */
const TABS: {
  href: string;
  label: string;
  permission?: string;
  reportPrefix?: string;
  /** Show when the user may open ANY of these. Use where a prefix would match too much. */
  reportIds?: string[];
}[] = [
  { href: '/finance/journal', label: 'Journal', permission: 'finance-journal:view' },
  { href: '/finance/health', label: 'Health', reportPrefix: 'finance.health' },
  // Health has its own tab and its own page, so it must NOT also satisfy the Reports tab —
  // a user granted only the health check would otherwise see a Reports tab that opens on an
  // empty state, which reads as something being broken rather than as not being granted.
  { href: '/finance/reports', label: 'Reports', reportIds: ['finance.trial-balance', 'finance.ledger-statement', 'finance.day-book'] },
  { href: '/finance/chart', label: 'Chart of Accounts', permission: 'finance-coa:view' },
  { href: '/finance/vendors', label: 'Suppliers', permission: 'finance-vendors:view' },
  { href: '/finance/bills', label: 'Bills', permission: 'finance-bills:view' },
  { href: '/finance/payments', label: 'Payments', permission: 'finance-payments:view' },
  { href: '/finance/periods', label: 'Periods', permission: 'finance-period:view' },
  { href: '/finance/settings', label: 'Settings', permission: 'finance-coa:view' },
];

const FinanceNav: React.FC = () => {
  const router = useRouter();

  const visible = TABS.filter((tab) => {
    if (tab.reportIds) return tab.reportIds.some((id) => canViewReport(id));
    if (tab.reportPrefix) return canViewAnyReportOn(tab.reportPrefix);
    return tab.permission ? can(undefined, tab.permission) : true;
  });

  if (visible.length <= 1) return null;

  return (
    <nav className={styles.moduleNav} aria-label="Finance sections">
      {visible.map((tab) => {
        const active = router.pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.moduleNavLink} ${active ? styles.moduleNavLinkActive : ''}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};

export default FinanceNav;
