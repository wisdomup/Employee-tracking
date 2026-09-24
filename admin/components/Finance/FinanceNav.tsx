import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { visibleFinanceTabs } from '../../utils/financeAccess';
import styles from '../../styles/Finance.module.scss';

/**
 * Tabs across the finance module.
 *
 * The sidebar carries one entry for the whole module, matching `/warehouse` and `/collection`,
 * because its nav highlighting matches on `startsWith` and sibling entries would break it. This
 * is how the sub-screens are reached instead.
 *
 * Each tab is hidden when its permission is absent rather than shown and refused. A tab that
 * 403s teaches people to distrust the whole nav. Which tabs exist, and what opens each, lives in
 * `utils/financeAccess.ts` — shared with the sidebar and the landing page, so the three can never
 * disagree about whether someone has a way in.
 */
const FinanceNav: React.FC = () => {
  const router = useRouter();
  const visible = visibleFinanceTabs();

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
