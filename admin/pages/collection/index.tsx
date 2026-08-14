import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import StatusBadge from '../../components/UI/StatusBadge';
import CollectionModuleNav from '../../components/Collection/CollectionModuleNav';
import RiderBalanceChip from '../../components/Collection/RiderBalanceChip';
import CollectionTotalsRow from '../../components/Collection/CollectionTotalsRow';
import {
  collectionService,
  RiderOrdersResponse,
  RiderBalance,
} from '../../services/collectionService';
import { useAuth } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs } from '../../utils/formatCurrency';
import styles from '../../styles/ListPage.module.scss';

/**
 * Spec §§1-2 — the rider's home screen: admin-approved orders only, grouped client-wise, with a
 * "Start" that opens the client's location on an in-app map.
 *
 * Admins land on an overview instead; the module's reporting screens are reached through the
 * tab strip.
 */

const CollectionHome: React.FC = () => {
  const { user } = useAuth();
  const isRider = user?.role === 'delivery_man';

  const [data, setData] = useState<RiderOrdersResponse | null>(null);
  const [balance, setBalance] = useState<RiderBalance | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isRider) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [orders, bal] = await Promise.all([
        collectionService.getMyOrders(),
        collectionService.getMyBalance(),
      ]);
      setData(orders);
      setBalance(bal);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load your deliveries'));
    } finally {
      setLoading(false);
    }
  }, [isRider]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isRider) {
    return (
      <Layout>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1>Collection</h1>
          </div>
          <CollectionModuleNav active="home" />
          <div className={styles.listCard}>
            <div className={styles.listCardBody}>
              <p style={{ color: '#6b7280' }}>
                Pick a section above. The <strong>Collection Report</strong> lists every delivery
                entry-wise, <strong>Today&apos;s Activity</strong> is the live view per rider, and{' '}
                <strong>Settlements</strong> is where cash handovers are confirmed.
              </p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>My Deliveries</h1>
          <button className={styles.addButton} onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <CollectionModuleNav active="home" />

        <div style={{ margin: '1rem 0' }}>
          <RiderBalanceChip balance={balance} />
        </div>

        {loading && !data ? (
          <Loader />
        ) : (
          <>
            {data && (
              <CollectionTotalsRow
                tiles={[
                  { label: 'Assigned', value: String(data.counts.assigned) },
                  { label: 'Packed', value: String(data.counts.packed) },
                  { label: 'Delivered', value: String(data.counts.delivered), tone: 'cash' },
                  { label: 'Still to do', value: String(data.counts.pending), tone: 'credit' },
                ]}
              />
            )}

            {data && data.groups.length === 0 && (
              <div className={styles.listCard}>
                <div className={styles.listCardBody}>
                  <p style={{ color: '#6b7280', margin: 0 }}>
                    Nothing assigned to you right now. Orders appear here once an admin approves and
                    assigns them.
                  </p>
                </div>
              </div>
            )}

            {data?.groups.map((group) => {
              const openCount = group.orders.filter((o) => o.status !== 'delivered').length;
              return (
                <div key={group.dealer._id} className={styles.listCard} style={{ marginBottom: '1rem' }}>
                  <div className={styles.listCardBody}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '1rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <h2 style={{ margin: 0, fontSize: '1.0625rem', color: '#111827' }}>
                          {group.dealer.shopName || group.dealer.name}
                        </h2>
                        {group.dealer.shopName && group.dealer.name !== group.dealer.shopName && (
                          <p style={{ margin: '0.15rem 0 0', fontSize: '0.8125rem', color: '#6b7280' }}>
                            {group.dealer.name}
                          </p>
                        )}
                        <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#6b7280' }}>
                          {group.orders.length} order{group.orders.length !== 1 ? 's' : ''} ·{' '}
                          {formatRs(group.totalAmount)}
                          {!group.dealer.hasLocation && ' · no pin saved'}
                        </p>
                      </div>
                      <Link
                        href={`/collection/start/${group.dealer._id}`}
                        style={{
                          padding: '0.5rem 1.25rem',
                          borderRadius: 8,
                          background: openCount > 0 ? 'var(--admin-primary, #2563eb)' : '#6b7280',
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                          textDecoration: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {openCount > 0 ? 'Start' : 'View'}
                      </Link>
                    </div>

                    <div style={{ marginTop: '0.875rem', display: 'grid', gap: '0.5rem' }}>
                      {group.orders.map((order) => (
                        <div
                          key={order._id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.625rem 0.75rem',
                            borderRadius: 8,
                            background: '#f9fafb',
                            border: '1px solid #f3f4f6',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 600 }}>
                              {order.invoiceNumber
                                ? `#${order.invoiceNumber}`
                                : order._id.slice(-8).toUpperCase()}
                              <span style={{ fontWeight: 400, color: '#6b7280' }}>
                                {' '}
                                · {order.productCount} item{order.productCount !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {order.collection && (
                              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem' }}>
                                Cash {formatRs(order.collection.cash)} · Online{' '}
                                {formatRs(order.collection.online)} · Credit{' '}
                                {formatRs(order.collection.credit)}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>
                              {formatRs(order.grandTotal)}
                            </span>
                            <StatusBadge status={order.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </Layout>
  );
};

export default function CollectionHomeWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'delivery_man']}>
      <CollectionHome />
    </ProtectedRoute>
  );
}
