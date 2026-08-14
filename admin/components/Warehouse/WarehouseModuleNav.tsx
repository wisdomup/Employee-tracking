import React from 'react';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import styles from '../../styles/StockReports.module.scss';

/**
 * In-module navigation for the warehouse section.
 *
 * The sidebar carries ONE `/warehouse` entry — its `isActive` check is `pathname.startsWith`, so a
 * second `/warehouse*` sibling would light up on every warehouse page. Sub-navigation therefore
 * lives here as a tab strip, reusing the tab styles from the stock-reports page.
 */
export type WarehouseNavKey =
  | 'home'
  | 'warehouses'
  | 'stock-matrix'
  | 'opening-stock'
  | 'stock-in'
  | 'transfers'
  | 'damage'
  | 'stock-count'
  | 'reports';

interface NavLinkDef {
  key: WarehouseNavKey;
  label: string;
  href: string;
  /** Permission key; admin passes everything. */
  permission: string;
}

const LINKS: NavLinkDef[] = [
  { key: 'home', label: 'Overview', href: '/warehouse', permission: 'warehouse:view' },
  // Live stock across every warehouse. Day-to-day, so it sits near the front — unlike Opening
  // Stock, which is one-time setup and stays last.
  { key: 'stock-matrix', label: 'Stock Matrix', href: '/warehouse/stock-matrix', permission: 'warehouse:view' },
  { key: 'warehouses', label: 'Warehouses', href: '/warehouse/warehouses', permission: 'warehouses:view' },
  { key: 'stock-in', label: 'Stock In', href: '/warehouse/stock-in', permission: 'stock-in:view' },
  { key: 'transfers', label: 'Transfers', href: '/warehouse/transfers', permission: 'transfers:view' },
  { key: 'damage', label: 'Damage / Claim', href: '/warehouse/damage', permission: 'damage:view' },
  { key: 'stock-count', label: 'Stock Count', href: '/warehouse/stock-count', permission: 'stock-count:view' },
  { key: 'reports', label: 'Reports', href: '/warehouse/reports', permission: 'warehouse-reports:view' },
  // Admin-only, and last: it is a one-time setup screen, not day-to-day work.
  { key: 'opening-stock', label: 'Opening Stock', href: '/warehouse/opening-stock', permission: 'opening-stock:manage' },
];

const WarehouseModuleNav: React.FC<{ active: WarehouseNavKey }> = ({ active }) => {
  const { user } = useAuth();
  const links = LINKS.filter((l) => can(user?.role, l.permission));

  return (
    <div className={styles.tabs} role="navigation" aria-label="Warehouse sections">
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

export default WarehouseModuleNav;
