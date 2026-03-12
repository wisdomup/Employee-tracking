import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import styles from './Sidebar.module.scss';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsedView: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, isCollapsedView }) => {
  const router = useRouter();

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/employees', label: 'Employees', icon: '👥' },
    { path: '/dealers', label: 'Dealers', icon: '🏪' },
    { path: '/routes', label: 'Routes', icon: '🛣️' },
    { path: '/tasks', label: 'Tasks', icon: '📋' },
    { path: '/activity-logs', label: 'Activity Logs', icon: '📈' },
    { path: '/categories', label: 'Categories', icon: '🏷️' },
    { path: '/catalogs', label: 'Catalogs', icon: '📄' },
    { path: '/products', label: 'Products', icon: '📦' },
    { path: '/orders', label: 'Orders', icon: '🛒' },
    { path: '/leaves', label: 'Leaves', icon: '🗓️' },
    { path: '/visits', label: 'Visits', icon: '📍' },
    { path: '/returns', label: 'Returns', icon: '↩️' },
    { path: '/broadcast-notifications', label: 'Notifications', icon: '🔔' },
  ];

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
