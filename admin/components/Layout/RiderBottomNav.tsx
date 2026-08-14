import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { House, Truck, HandCoins, Wallet } from '@phosphor-icons/react';
import { useAuth } from '../../contexts/AuthContext';
import styles from './OrderTakerBottomNav.module.scss';

/**
 * Mobile bottom bar for the delivery boy, mirroring OrderTakerBottomNav.
 *
 * A rider works from a phone all day, so the four things they do — see the round, recover old
 * credit, hand money in — are one tap away rather than behind the hamburger.
 */
const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Home',
    Icon: House,
    isActive: (pathname: string) => pathname === '/dashboard',
  },
  {
    href: '/collection',
    label: 'Deliveries',
    Icon: Truck,
    // Exact-ish match: the sibling entries below own their own sub-paths.
    isActive: (pathname: string) =>
      pathname === '/collection' || pathname.startsWith('/collection/start'),
  },
  {
    href: '/collection/recovery',
    label: 'Recovery',
    Icon: HandCoins,
    isActive: (pathname: string) => pathname.startsWith('/collection/recovery'),
  },
  {
    href: '/collection/settlements',
    label: 'Settle',
    Icon: Wallet,
    isActive: (pathname: string) => pathname.startsWith('/collection/settlements'),
  },
] as const;

const RiderBottomNav: React.FC = () => {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = router.pathname;

  if (user?.role !== 'delivery_man') {
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
            <Icon className={styles.icon} size={24} weight={active ? 'fill' : 'regular'} aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export default RiderBottomNav;
