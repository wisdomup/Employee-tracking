import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowUUpLeft,
  Bell,
  BookOpen,
  CalendarCheck,
  ChartBar,
  ClipboardText,
  Fingerprint,
  MapPin,
  Package,
  PresentationChart,
  ShoppingCart,
  Signpost,
  SquaresFour,
  Storefront,
  Tag,
  Trash,
  TrendUp,
  UserCircle,
  Users,
} from '@phosphor-icons/react';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
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
  /** If true, only admin sees this item regardless of permissions. */
  adminOnly?: boolean;
}

const ALL_MENU_ITEMS: MenuItem[] = [
  { path: '/dashboard', label: 'Dashboard', Icon: SquaresFour },
  { path: '/profile', label: 'Profile', Icon: UserCircle },
  { path: '/employees', label: 'Employees', Icon: Users, adminOnly: true },
  { path: '/clients', label: 'Clients', Icon: Storefront, permission: 'dealers:view' },
  { path: '/routes', label: 'Routes', Icon: Signpost, adminOnly: true },
  { path: '/tasks', label: 'Tasks', Icon: ClipboardText, permission: 'tasks:view' },
  { path: '/activity-logs', label: 'Activity Logs', Icon: TrendUp, permission: 'activity-logs:view' },
  { path: '/categories', label: 'Categories', Icon: Tag, adminOnly: true },
  { path: '/catalogs', label: 'Catalogs', Icon: BookOpen, permission: 'catalogs:view' },
  { path: '/products', label: 'Products', Icon: Package, permission: 'products:view' },
  { path: '/orders', label: 'Orders', Icon: ShoppingCart, permission: 'orders:view' },
  { path: '/approvals', label: 'Approvals', Icon: CalendarCheck, permission: 'approvals:view' },
  { path: '/attendance', label: 'Attendance', Icon: Fingerprint },
  { path: '/visits', label: 'Visits', Icon: MapPin, permission: 'visits:view' },
  { path: '/returns', label: 'Returns', Icon: ArrowUUpLeft, permission: 'returns:view' },
  { path: '/reports', label: 'Reports', Icon: PresentationChart, adminOnly: true },
  { path: '/stock-reports', label: 'Stock Reports', Icon: ChartBar, adminOnly: true },
  { path: '/trash', label: 'Trash', Icon: Trash, adminOnly: true },
  { path: '/broadcast-notifications', label: 'Notifications', Icon: Bell, adminOnly: true },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, isCollapsedView }) => {
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.role;

  const menuItems = ALL_MENU_ITEMS.filter((item) => {
    if (role === 'admin') return true;
    if (item.adminOnly) return false;
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
