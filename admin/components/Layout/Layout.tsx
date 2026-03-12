import React, { ReactNode, useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import styles from './Layout.module.scss';

// Sidebar is collapsed (hamburger menu) at 900px and below (tablet + mobile)
const SIDEBAR_COLLAPSED_BREAKPOINT = 900;

interface LayoutProps {
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsedView, setIsCollapsedView] = useState(false);

  useEffect(() => {
    const checkView = () => setIsCollapsedView(window.innerWidth <= SIDEBAR_COLLAPSED_BREAKPOINT);
    checkView();
    window.addEventListener('resize', checkView);
    return () => window.removeEventListener('resize', checkView);
  }, []);

  useEffect(() => {
    if (!isCollapsedView) setSidebarOpen(false);
  }, [isCollapsedView]);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className={styles.layout}>
      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        isCollapsedView={isCollapsedView}
      />
      <div className={styles.mainContent}>
        <Header onMenuClick={toggleSidebar} showMenuButton={isCollapsedView} />
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
};

export default Layout;
