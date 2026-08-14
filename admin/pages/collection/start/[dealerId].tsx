import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import StatusBadge from '../../../components/UI/StatusBadge';
import ClientLocationMap from '../../../components/Collection/ClientLocationMap';
import DeliverySplitModal from '../../../components/Collection/DeliverySplitModal';
import RiderBalanceChip from '../../../components/Collection/RiderBalanceChip';
import {
  collectionService,
  RiderOrderGroup,
  RiderOrder,
  RiderBalance,
} from '../../../services/collectionService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatRs } from '../../../utils/formatCurrency';
import styles from '../../../styles/ListPage.module.scss';

/**
 * Spec §§2-4 — one client: their location on an embedded map, then Packed and Delivered.
 *
 * A page rather than a modal on purpose: it is deep-linkable and the Android back button works.
 * A modal traps a rider on a phone.
 */

const StartDeliveryPage: React.FC = () => {
  const router = useRouter();
  const dealerId = typeof router.query.dealerId === 'string' ? router.query.dealerId : '';

  const [group, setGroup] = useState<RiderOrderGroup | null>(null);
  const [balance, setBalance] = useState<RiderBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<RiderOrder | null>(null);
  const [deliverBusy, setDeliverBusy] = useState(false);

  const load = useCallback(async () => {
    if (!dealerId) return;
    setLoading(true);
    try {
      const [data, bal] = await Promise.all([
        collectionService.getMyOrders(),
        collectionService.getMyBalance(),
      ]);
      setGroup(data.groups.find((g) => g.dealer._id === dealerId) ?? null);
      setBalance(bal);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load this client'));
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePacked = async (order: RiderOrder) => {
    setBusyOrderId(order._id);
    try {
      await collectionService.markPacked(order._id);
      toast.success('Marked packed');
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to mark packed'));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleDeliver = async (split: {
    cash: number;
    online: number;
    credit: number;
    note?: string;
  }) => {
    if (!deliverOrder) return;
    setDeliverBusy(true);
    try {
      const result = await collectionService.deliver(deliverOrder._id, split);
      setBalance(result.balance);
      toast.success('Delivery and collection recorded');
      setDeliverOrder(null);
      await load();
    } catch (error) {
      // The modal deliberately stays open — the rider must not have to retype the split.
      toast.error(getApiErrorMessage(error, 'Failed to save the collection'));
    } finally {
      setDeliverBusy(false);
    }
  };

  if (loading && !group) {
    return (
      <Layout>
        <div className={styles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  if (!group) {
    return (
      <Layout>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1>Client not found</h1>
          </div>
          <div className={styles.listCard}>
            <div className={styles.listCardBody}>
              <p style={{ color: '#6b7280' }}>
                This client has no orders assigned to you right now.
              </p>
              <Link href="/collection" style={{ color: 'var(--admin-primary)' }}>
                ← Back to my deliveries
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const shopName = group.dealer.shopName || group.dealer.name;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <Link
              href="/collection"
              style={{ fontSize: '0.875rem', color: 'var(--admin-primary)', textDecoration: 'none' }}
            >
              ← My deliveries
            </Link>
            <h1 style={{ marginTop: '0.35rem' }}>{shopName}</h1>
          </div>
        </div>

        <div className={styles.listCard} style={{ marginBottom: '1rem' }}>
          <div className={styles.listCardBody}>
            <ClientLocationMap dealer={group.dealer} />
            <div style={{ marginTop: '0.875rem', fontSize: '0.875rem', color: '#6b7280' }}>
              {group.dealer.address?.street && <div>{group.dealer.address.street}</div>}
              {group.dealer.address?.city && <div>{group.dealer.address.city}</div>}
              {group.dealer.phone && (
                <div style={{ marginTop: '0.35rem' }}>
                  <a href={`tel:${group.dealer.phone}`} style={{ color: 'var(--admin-primary)' }}>
                    {group.dealer.phone}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <RiderBalanceChip balance={balance} variant="compact" />
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#111827' }}>
              Orders ({group.orders.length}) · {formatRs(group.totalAmount)}
            </h2>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {group.orders.map((order) => {
                const busy = busyOrderId === order._id;
                return (
                  <div
                    key={order._id}
                    style={{
                      padding: '0.875rem',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, color: '#111827' }}>
                          {order.invoiceNumber
                            ? `#${order.invoiceNumber}`
                            : order._id.slice(-8).toUpperCase()}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
                          {order.productCount} item{order.productCount !== 1 ? 's' : ''} ·{' '}
                          {formatRs(order.grandTotal)}
                        </div>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>

                    {order.collection && (
                      <div
                        style={{
                          marginTop: '0.625rem',
                          padding: '0.5rem 0.75rem',
                          borderRadius: 8,
                          background: '#f9fafb',
                          fontSize: '0.8125rem',
                          color: '#374151',
                        }}
                      >
                        Collected — Cash {formatRs(order.collection.cash)} · Online{' '}
                        {formatRs(order.collection.online)} · Credit{' '}
                        {formatRs(order.collection.credit)}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      {order.status === 'approved' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handlePacked(order)}
                          style={{
                            flex: 1,
                            padding: '0.625rem',
                            borderRadius: 8,
                            border: '1px solid var(--admin-primary, #2563eb)',
                            background: '#fff',
                            color: 'var(--admin-primary, #2563eb)',
                            fontWeight: 600,
                            fontSize: '0.875rem',
                            cursor: busy ? 'wait' : 'pointer',
                          }}
                        >
                          {busy ? 'Saving…' : 'Mark packed'}
                        </button>
                      )}
                      {(order.status === 'packed' || order.status === 'dispatched') && (
                        <button
                          type="button"
                          onClick={() => setDeliverOrder(order)}
                          style={{
                            flex: 1,
                            padding: '0.625rem',
                            borderRadius: 8,
                            border: 'none',
                            background: '#059669',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: '0.875rem',
                            cursor: 'pointer',
                          }}
                        >
                          Delivered — record collection
                        </button>
                      )}
                      {order.status === 'delivered' && (
                        <span style={{ fontSize: '0.8125rem', color: '#047857', fontWeight: 600 }}>
                          ✓ Delivered
                          {order.deliveredAt
                            ? ` at ${new Date(order.deliveredAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <DeliverySplitModal
        open={!!deliverOrder}
        order={deliverOrder}
        shopName={shopName}
        busy={deliverBusy}
        onClose={() => {
          if (!deliverBusy) setDeliverOrder(null);
        }}
        onSubmit={handleDeliver}
      />
    </Layout>
  );
};

export default function StartDeliveryPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['delivery_man']}>
      <StartDeliveryPage />
    </ProtectedRoute>
  );
}
