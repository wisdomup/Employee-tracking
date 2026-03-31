import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { authService } from '../../services/authService';
import styles from './Header.module.scss';

interface HeaderProps {
  onMenuClick: () => void;
  showMenuButton: boolean;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick, showMenuButton }) => {
  const router = useRouter();
  const [showDropdown, setShowDropdown] = useState(false);
  const user = authService.getUser();

  const handleLogout = () => {
    authService.logout();
    router.push('/login');
  };

  const handleChangePassword = () => {
    setShowDropdown(false);
    router.push('/change-password');
  };

  const title = user?.role === 'admin' ? 'Admin Panel' : 'Order Taker Panel';

  return (
    <header className={styles.header}>
      <div className={styles.content}>
        {showMenuButton && (
          <button
            type="button"
            className={styles.menuButton}
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <svg className={styles.menuIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        <h1 className={styles.title}>{title}</h1>

        <div className={styles.userSection}>
          <button
            className={styles.userButton}
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <span className={styles.userName}>{user?.username}</span>
            <span className={styles.userIcon}>👤</span>
          </button>

          {showDropdown && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownItem}>
                <strong>{user?.username}</strong>
                <span className={styles.role}>{user?.role}</span>
              </div>
              <button className={styles.changePasswordButton} onClick={handleChangePassword}>
                🔑 Change Password
              </button>
              <button className={styles.logoutButton} onClick={handleLogout}>
                🚪 Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
