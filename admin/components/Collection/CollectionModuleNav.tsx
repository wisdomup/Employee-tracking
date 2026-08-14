import React from 'react';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import styles from '../../styles/StockReports.module.scss';

/**
 * In-module navigation for the collection section.
 *
 * The sidebar carries ONE `/collection` entry — its `isActive` check is `pathname.startsWith`,
 * so a second `/collection*` sibling would light up on every page in the module. Sub-navigation
 * therefore lives here as a tab strip, reusing the tab styles from the stock-reports page.
 * Same pattern as WarehouseModuleNav.
 */
export type CollectionNavKey =
  | 'home'
  | 'recovery'
  | 'settlements'
  | 'report'
  | 'activity'
  | 'day-end';

interface NavLinkDef {
  key: CollectionNavKey;
  label: string;
  href: string;
  /** Permission key; admin passes everything. */
  permission: string;
}

const LINKS: NavLinkDef[] = [
  { key: 'home', label: 'Deliveries', href: '/collection', permission: 'collection:view' },
  { key: 'recovery', label: 'Credit Recovery', href: '/collection/recovery', permission: 'collection:recover' },
  { key: 'settlements', label: 'Settlements', href: '/collection/settlements', permission: 'collection:settle' },
  { key: 'activity', label: "Today's Activity", href: '/collection/activity', permission: 'collection:activity' },
  { key: 'day-end', label: 'Day-end Summary', href: '/collection/day-end', permission: 'collection:day-end' },
  { key: 'report', label: 'Collection Report', href: '/collection/report', permission: 'collection:report' },
];

const CollectionModuleNav: React.FC<{ active: CollectionNavKey }> = ({ active }) => {
  const { user } = useAuth();
  // Riders reach Deliveries / Recovery / Settlements; the reporting keys are in no permission
  // Set at all, so `can()` resolves them to admin-only.
  const links = LINKS.filter((l) => can(user?.role, l.permission));

  return (
    <div className={styles.tabs} role="navigation" aria-label="Collection sections">
      {links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className={`${styles.tab} ${active === link.key ? styles.activeTab : ''}`}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
};

export default CollectionModuleNav;
