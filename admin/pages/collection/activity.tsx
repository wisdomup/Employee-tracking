import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import StatusBadge from '../../components/UI/StatusBadge';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import CollectionModuleNav from '../../components/Collection/CollectionModuleNav';
import CollectionTotalsRow from '../../components/Collection/CollectionTotalsRow';
import RiderSelect from '../../components/Collection/RiderSelect';
import {
  collectionService,
  ActivityResponse,
  RiderSummary,
} from '../../services/collectionService';
import { useAuth } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs } from '../../utils/formatCurrency';
import styles from '../../styles/ListPage.module.scss';

/**
 * Spec §9 — the live activity view, per rider or all riders.
 *
 * Roster-driven on the server, so a rider who has done nothing today still appears at zero:
 * "All Riders" has to mean all riders, or the view quietly stops being a supervision tool.
 *
 * Auto-refreshes every 30s. The interval is cleaned up on unmount and paused while the tab is
 * hidden, so a screen left open overnight is not hammering the API.
 */

const REFRESH_MS = 30_000;
const time = (v: string | null) => (v ? format(new Date(v), 'HH:mm') : '—');

const ActivityPage: React.FC = () => {
  const { user } = useAuth();
  const isRider = user?.role === 'delivery_man';

  const [data, setData] = useState<ActivityResponse | null>(null);
  const [riders, setRiders] = useState<RiderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [riderFilter, setRiderFilter] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      try {
        const result = await collectionService.getActivity({
          riderId: isRider ? undefined : riderFilter || undefined,
          date: date || undefined,
        });
        setData(result);
        setLastUpdated(new Date());
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Failed to load today's activity"));
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [isRider, riderFilter, date],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isRider) collectionService.getRiders().then(setRiders).catch(() => {});
  }, [isRider]);

  useEffect(() => {
    const id = setInterval(() => {
      // Don't poll a tab nobody is looking at.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load(false);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Today&apos;s Activity</h1>
          <button className={styles.addButton} onClick={() => load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <CollectionModuleNav active="activity" />

        <div className={styles.listCard} style={{ marginTop: '1rem' }}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              {!isRider && (
                <RiderSelect
                  riders={riders}
                  value={riderFilter}
                  onChange={setRiderFilter}
                  className={styles.searchSelect}
                  showBalance
                />
              )}
              <DatePickerFilter value={date} onChange={setDate} placeholder="Date" title="Date" />
            </div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#9ca3af' }}>
              Auto-refreshes every 30 seconds
              {lastUpdated ? ` · last updated ${format(lastUpdated, 'HH:mm:ss')}` : ''}
              {data ? ` · ${data.timezone}` : ''}
            </p>
          </div>
        </div>

        {data && (
          <div style={{ marginTop: '1rem' }}>
            <CollectionTotalsRow
              tiles={[
                { label: 'Assigned', value: String(data.totals.assigned) },
                { label: 'Packed', value: String(data.totals.packed) },
                { label: 'Delivered', value: String(data.totals.delivered), tone: 'cash' },
                { label: 'Still to do', value: String(data.totals.pending), tone: 'credit' },
              ]}
            />
            <CollectionTotalsRow
              tiles={[
                { label: "Today's collection", value: formatRs(data.totals.total) },
                { label: 'Cash', value: formatRs(data.totals.cash), tone: 'cash' },
                { label: 'Online', value: formatRs(data.totals.online), tone: 'online' },
                { label: 'Credit', value: formatRs(data.totals.credit), tone: 'credit' },
                {
                  label: 'Cash in hand',
                  value: formatRs(data.totals.cashInHand),
                  hint: 'All riders, all time',
                },
              ]}
            />
          </div>
        )}

        {loading && !data ? (
          <Loader />
        ) : (
          data?.riders.map((block) => (
            <div key={block.rider.id} className={styles.listCard} style={{ marginBottom: '1rem' }}>
              <div className={styles.listCardBody}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: '1.0625rem', color: '#111827' }}>
                    {block.rider.name}
                    <span style={{ fontWeight: 400, fontSize: '0.875rem', color: '#6b7280' }}>
                      {' '}
                      · {block.rider.city}
                    </span>
                    {!block.rider.isActive && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#b91c1c' }}>
                        (inactive)
                      </span>
                    )}
                  </h2>
                  <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Cash in hand{' '}
                    <strong style={{ color: block.cashInHand > 0 ? '#b45309' : '#111827' }}>
                      {formatRs(block.cashInHand)}
                    </strong>
                  </span>
                </div>

                <p style={{ margin: '0.5rem 0 0.875rem', fontSize: '0.875rem', color: '#374151' }}>
                  {block.counts.assigned} assigned · {block.counts.packed} packed ·{' '}
                  {block.counts.delivered} delivered · {block.counts.pending} still to do
                  {' — '}
                  Cash {formatRs(block.collection.cash)} · Online {formatRs(block.collection.online)}{' '}
                  · Credit {formatRs(block.collection.credit)}
                </p>

                {block.timeline.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.875rem', color: '#9ca3af' }}>
                    No orders assigned.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    {block.timeline.map((entry) => (
                      <div
                        key={entry.orderId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                          padding: '0.5rem 0.75rem',
                          borderRadius: 8,
                          background: '#f9fafb',
                          fontSize: '0.8125rem',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ color: '#111827' }}>
                            {entry.invoiceNumber ? `#${entry.invoiceNumber}` : entry.orderId.slice(-6).toUpperCase()}
                          </strong>{' '}
                          <span style={{ color: '#374151' }}>{entry.shop}</span>
                          <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                            assigned {time(entry.assignedAt)} · packed {time(entry.packedAt)} ·
                            delivered {time(entry.deliveredAt)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          {entry.cash !== null && (
                            <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                              C {formatRs(entry.cash)} · O {formatRs(entry.online!)} · Cr{' '}
                              {formatRs(entry.credit!)}
                            </span>
                          )}
                          <strong style={{ color: '#111827' }}>{formatRs(entry.amount)}</strong>
                          <StatusBadge status={entry.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {block.recoveries.length > 0 && (
                  <div style={{ marginTop: '0.875rem' }}>
                    <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.875rem', color: '#374151' }}>
                      Credit recovered today
                    </h3>
                    <div style={{ display: 'grid', gap: '0.3rem' }}>
                      {block.recoveries.map((r) => (
                        <div
                          key={r._id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '0.4rem 0.75rem',
                            borderRadius: 8,
                            background: '#fffbeb',
                            fontSize: '0.8125rem',
                            color: '#92400e',
                          }}
                        >
                          <span>
                            {r.shop} · {r.mode === 'cash' ? 'Cash' : 'Online'} ·{' '}
                            {time(r.collectedAt)}
                          </span>
                          <strong>{formatRs(r.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
};

export default function ActivityPageWrapper() {
  return (
    <ProtectedRoute report="collection.activity">
      <ActivityPage />
    </ProtectedRoute>
  );
}
