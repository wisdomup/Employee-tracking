import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import styles from './Sidebar.module.scss';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsedView: boolean;
}

interface MenuItem {
  path: string;
  label: string;
  icon: string;
  /** Permission key checked via can(). If undefined the item is always visible. */
  permission?: string;
  /** If true, only admin sees this item regardless of permissions. */
  adminOnly?: boolean;
}

const ALL_MENU_ITEMS: MenuItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/employees', label: 'Employees', icon: '👥', adminOnly: true },
  { path: '/clients', label: 'Clients', icon: '🏪', permission: 'dealers:view' },
  { path: '/routes', label: 'Routes', icon: '🛣️', adminOnly: true },
  { path: '/tasks', label: 'Tasks', icon: '📋', permission: 'tasks:view' },
  { path: '/activity-logs', label: 'Activity Logs', icon: '📈', permission: 'activity-logs:view' },
  { path: '/categories', label: 'Categories', icon: '🏷️', adminOnly: true },
  { path: '/catalogs', label: 'Catalogs', icon: '📄', permission: 'catalogs:view' },
  { path: '/products', label: 'Products', icon: '📦', permission: 'products:view' },
  { path: '/orders', label: 'Orders', icon: '🛒', permission: 'orders:view' },
  { path: '/leaves', label: 'Approvals', icon: '🗓️', permission: 'leaves:view' },
  { path: '/visits', label: 'Visits', icon: '📍', permission: 'visits:view' },
  { path: '/returns', label: 'Returns', icon: '↩️', permission: 'returns:view' },
  { path: '/reports', label: 'Reports', icon: '📉', adminOnly: true },
  { path: '/trash', label: 'Trash', icon: '🗑️', adminOnly: true },
  { path: '/broadcast-notifications', label: 'Notifications', icon: '🔔', adminOnly: true },
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
          <h2>GPS Task Tracker</h2>
        </div>

        <nav className={styles.nav}>
          {menuItems.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={`${styles.navItem} ${isActive(item.path) ? styles.active : ''}`}
              onClick={handleNavClick}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span className={styles.label}>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
