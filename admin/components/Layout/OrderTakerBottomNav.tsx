import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { House, ShoppingCart, Storefront, Package } from '@phosphor-icons/react';
import { useAuth } from '../../contexts/AuthContext';
import styles from './OrderTakerBottomNav.module.scss';

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    Icon: House,
    isActive: (pathname: string) => pathname === '/dashboard',
  },
  {
    href: '/orders',
    label: 'Orders',
    Icon: ShoppingCart,
    isActive: (pathname: string) => pathname.startsWith('/orders'),
  },
  {
    href: '/clients',
    label: 'Clients',
    Icon: Storefront,
    isActive: (pathname: string) => pathname.startsWith('/clients'),
  },
  {
    href: '/products',
    label: 'Products',
    Icon: Package,
    isActive: (pathname: string) => pathname.startsWith('/products'),
  },
] as const;

const OrderTakerBottomNav: React.FC = () => {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = router.pathname;

  if (user?.role !== 'order_taker') {
    return null;
  }

  return (
    <nav className={styles.nav} aria-label="Quick navigation">
      {NAV_ITEMS.map(({ href, label, Icon, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={`${styles.link} ${active ? styles.linkActive : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon
              className={styles.icon}
              size={24}
              weight={active ? 'fill' : 'regular'}
              aria-hidden
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export default OrderTakerBottomNav;
