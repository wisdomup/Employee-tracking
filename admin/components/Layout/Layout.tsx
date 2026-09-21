import React, { ReactNode, useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import OrderTakerBottomNav from './OrderTakerBottomNav';
import RiderBottomNav from './RiderBottomNav';
import FrozenAccountBanner from './FrozenAccountBanner';
import RoleFallbackBanner from './RoleFallbackBanner';
import { useAuth } from '../../contexts/AuthContext';
import { BroadcastInboxProvider } from '../../contexts/BroadcastInboxContext';
import styles from './Layout.module.scss';

// Sidebar is collapsed (hamburger menu) at 900px and below (tablet + mobile)
const SIDEBAR_COLLAPSED_BREAKPOINT = 900;

interface LayoutProps {
  children: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user } = useAuth();
  const showOrderTakerBottomNav = user?.role === 'order_taker';
  const showRiderBottomNav = user?.role === 'delivery_man';
  // Either bar occupies the same strip, so the content padding is shared.
  const hasBottomNav = showOrderTakerBottomNav || showRiderBottomNav;
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
      <BroadcastInboxProvider>
        <div className={styles.mainContent}>
          <Header onMenuClick={toggleSidebar} showMenuButton={isCollapsedView} />
          <main
            className={`${styles.content} ${hasBottomNav ? styles.contentWithBottomNav : ''}`}
          >
            {/* Above the page content on every screen — the freeze applies everywhere,
                so a rider must not have to find the right page to learn about it. */}
            <FrozenAccountBanner />
            {children}
          </main>
          <OrderTakerBottomNav />
          <RiderBottomNav />
        </div>
      </BroadcastInboxProvider>
    </div>
  );
};

export default Layout;
