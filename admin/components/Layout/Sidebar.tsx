import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowUUpLeft,
  Bell,
  BookOpen,
  CalendarCheck,
  ChartBar,
  ChartLineUp,
  ClipboardText,
  Fingerprint,
  HandCoins,
  MapPin,
  MapPinArea,
  Package,
  PresentationChart,
  ShoppingCart,
  Signpost,
  Snowflake,
  SquaresFour,
  Storefront,
  Tag,
  Trash,
  TrendUp,
  UserCircle,
  ShieldCheck,
  Users,
  Warehouse,
  WarningCircle,
} from '@phosphor-icons/react';
import { useAuth } from '../../contexts/AuthContext';
import { can, canViewAnyReportOn, isAdmin } from '../../utils/permissions';
import styles from './Sidebar.module.scss';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsedView: boolean;
}

type MenuIcon = React.ComponentType<{
  className?: string;
  size?: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
  'aria-hidden'?: boolean;
}>;

interface MenuItem {
  path: string;
  label: string;
  Icon: MenuIcon;
  /** Permission key checked via can(). If undefined the item is always visible. */
  permission?: string;
  /**
   * Show when the user may open ANY report whose id starts with this prefix.
   *
   * Report screens are gated one report at a time, so "can they see the Reports page" really
   * means "have they been ticked for at least one report on it" — which a single permission
   * key cannot express.
   */
  reportPrefix?: string;
  /**
   * Structurally the super-admin's, and NOT a matrix cell — editing the permission matrix is
   * the obvious case. Prefer `permission` for anything else: a flag here is a rule the admin
   * cannot change from the UI, which is the drift this module exists to remove.
   */
  adminOnly?: boolean;
}

const ALL_MENU_ITEMS: MenuItem[] = [
  { path: '/dashboard', label: 'Dashboard', Icon: SquaresFour },
  { path: '/profile', label: 'Profile', Icon: UserCircle },
  { path: '/employees', label: 'Employees', Icon: Users, permission: 'employees:view' },
  { path: '/clients', label: 'Clients', Icon: Storefront, permission: 'dealers:view' },
  { path: '/routes', label: 'Routes', Icon: Signpost, permission: 'routes:view' },
  { path: '/tasks', label: 'Tasks', Icon: ClipboardText, permission: 'tasks:view' },
  { path: '/activity-logs', label: 'Activity Logs', Icon: TrendUp, permission: 'activity-logs:view' },
  { path: '/categories', label: 'Categories', Icon: Tag, permission: 'categories:view' },
  { path: '/catalogs', label: 'Catalogs', Icon: BookOpen, permission: 'catalogs:view' },
  { path: '/products', label: 'Products', Icon: Package, permission: 'products:view' },
  // One entry for the whole warehouse module; `isActive` uses startsWith, so every nested
  // /warehouse/** page keeps it lit. Adding a sibling /warehouse* entry would break that.
  { path: '/warehouse', label: 'Warehouse', Icon: Warehouse, permission: 'warehouse:view' },
  { path: '/orders', label: 'Orders', Icon: ShoppingCart, permission: 'orders:view' },
  { path: '/approvals', label: 'Approvals', Icon: CalendarCheck, permission: 'approvals:view' },
  { path: '/attendance', label: 'Attendance', Icon: Fingerprint, permission: 'attendance:view' },
  { path: '/visits', label: 'Visits', Icon: MapPin, permission: 'visits:view' },
  { path: '/returns', label: 'Returns', Icon: ArrowUUpLeft, permission: 'returns:view' },
  // Everyone gets this: riders see their own scorecard, managers their team, admin all.
  { path: '/analytics', label: 'Performance', Icon: ChartLineUp, reportPrefix: 'analytics.' },
  { path: '/flags', label: 'Flags', Icon: WarningCircle, permission: 'performance-flags:view' },
  // The unfreeze queue. Admin-only: lifting a late-start freeze is the admin's call alone.
  { path: '/frozen-accounts', label: 'Frozen Accounts', Icon: Snowflake, permission: 'account-freeze:view' },
  // Admin + sales managers only — an oversight view, not something riders need.
  { path: '/region-sales', label: 'Region Sales', Icon: MapPinArea, reportPrefix: 'region-sales.' },
  // One entry for the whole collection module, same constraint as /warehouse above: `isActive`
  // uses startsWith, so a sibling /collection* entry would break the highlighting. Sub-pages
  // are reached through CollectionModuleNav instead.
  { path: '/collection', label: 'Collection', Icon: HandCoins, permission: 'collection:view' },
  { path: '/reports', label: 'Reports', Icon: PresentationChart, reportPrefix: 'reports.' },
  { path: '/stock-reports', label: 'Stock Reports', Icon: ChartBar, reportPrefix: 'stock-reports.' },
  { path: '/trash', label: 'Trash', Icon: Trash, permission: 'trash:view' },
  { path: '/broadcast-notifications', label: 'Notifications', Icon: Bell, permission: 'broadcast-notifications:view' },
  // Editing the matrix is deliberately not a matrix cell — see `adminOnly` above.
  { path: '/settings/permissions', label: 'Roles & Permissions', Icon: ShieldCheck, adminOnly: true },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, isCollapsedView }) => {
  const router = useRouter();
  const { user, access, accessLoading } = useAuth();
  const role = user?.role;

  // Grants arrive from /permissions/me after mount. Filtering against an empty set in the
  // meantime renders a near-empty menu for a paint — including for admins, who would watch
  // the whole panel appear a beat late. Show nothing until the answer is in.
  const grantsPending = accessLoading || access === null;

  const menuItems = grantsPending ? [] : ALL_MENU_ITEMS.filter((item) => {
    // `isAdmin()` rather than `role === 'admin'`: a user can hold admin as a secondary role,
    // and testing only the primary would hide the whole panel from them.
    if (isAdmin()) return true;
    if (item.adminOnly) return false;
    if (item.reportPrefix) return canViewAnyReportOn(item.reportPrefix);
    if (item.permission) return can(role, item.permission);
    return true;
  });

  const isActive = (path: string) => router.pathname.startsWith(path);

  const handleNavClick = () => {
    if (isCollapsedView) onClose();
  };

  return (
    <>
      {isCollapsedView && (
        <button
          type="button"
          className={`${styles.overlay} ${isOpen ? styles.overlayVisible : ''}`}
          aria-label="Close menu"
          onClick={onClose}
          tabIndex={isOpen ? 0 : -1}
        />
      )}
      <aside
        className={`${styles.sidebar} ${isCollapsedView ? styles.sidebarCollapsed : ''} ${isCollapsedView && isOpen ? styles.sidebarOpen : ''}`}
      >
        <div className={styles.logo}>
          <img src="/logo.jpeg" alt="GPS Task Tracker" className={styles.logoImage} />
        </div>

        <nav className={styles.nav}>
          {menuItems.map((item) => {
            const active = isActive(item.path);
            const { Icon } = item;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`${styles.navItem} ${active ? styles.active : ''}`}
                onClick={handleNavClick}
              >
                <Icon
                  className={styles.icon}
                  size={22}
                  weight={active ? 'fill' : 'regular'}
                  aria-hidden
                />
                <span className={styles.label}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
