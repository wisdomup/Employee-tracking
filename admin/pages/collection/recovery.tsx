import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import SearchableSelect from '../../components/UI/SearchableSelect';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import CollectionModuleNav from '../../components/Collection/CollectionModuleNav';
import RiderBalanceChip from '../../components/Collection/RiderBalanceChip';
import CollectionTotalsRow from '../../components/Collection/CollectionTotalsRow';
import RiderSelect from '../../components/Collection/RiderSelect';
import Table from '../../components/UI/Table';
import {
  collectionService,
  RiderBalance,
  RecoveryRow,
  DealerOutstanding,
  RiderSummary,
} from '../../services/collectionService';
import { clientService, Client, formatClientSelectLabel } from '../../services/clientService';
import { useAuth } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs } from '../../utils/formatCurrency';
import styles from '../../styles/ListPage.module.scss';

/**
 * Spec §5 — recovery of old pending credit. Not a new sale.
 *
 * The party is picked from the rider's own (city-scoped) client list rather than typed free-form,
 * because the spec's own rule "the customer's pending credit reduces by the same amount" is not
 * computable against a typed name. The outstanding figure is fetched on selection and shown
 * prominently — it is the number the rider is working against.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;

const RecoveryPage: React.FC = () => {
  const { user } = useAuth();
  const isRider = user?.role === 'delivery_man';

  const [clients, setClients] = useState<Client[]>([]);
  const [riders, setRiders] = useState<RiderSummary[]>([]);
  const [balance, setBalance] = useState<RiderBalance | null>(null);
  const [rows, setRows] = useState<RecoveryRow[]>([]);
  const [totals, setTotals] = useState({ cash: 0, online: 0, total: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ dealerId: '', amount: '', mode: 'cash' as 'cash' | 'online', note: '' });
  const [outstanding, setOutstanding] = useState<DealerOutstanding | null>(null);
  const [outstandingLoading, setOutstandingLoading] = useState(false);

  // Admin filters
  const [riderFilter, setRiderFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await collectionService.getRecoveries({
        riderId: isRider ? undefined : riderFilter || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      setRows(data.rows);
      setTotals(data.totals);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load recovery entries'));
    } finally {
      setLoading(false);
    }
  }, [isRider, riderFilter, fromDate, toDate]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (isRider) {
      clientService.getClients().then(setClients).catch(() => {});
      collectionService.getMyBalance().then(setBalance).catch(() => {});
    } else {
      collectionService.getRiders().then(setRiders).catch(() => {});
    }
  }, [isRider]);

  // Fetch the client's outstanding as soon as one is picked — it caps the entry.
  useEffect(() => {
    if (!form.dealerId) {
      setOutstanding(null);
      return;
    }
    let cancelled = false;
    setOutstandingLoading(true);
    collectionService
      .getDealerOutstanding(form.dealerId)
      .then((data) => {
        if (!cancelled) setOutstanding(data);
      })
      .catch(() => {
        if (!cancelled) setOutstanding(null);
      })
      .finally(() => {
        if (!cancelled) setOutstandingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.dealerId]);

  const amount = Number.parseFloat(form.amount);
  const validAmount = Number.isFinite(amount) && amount > 0;
  const cap = outstanding?.outstanding ?? 0;
  const overCap = validAmount && amount - cap >= 0.005;
  const canSave = Boolean(form.dealerId) && validAmount && !overCap && cap > 0 && !saving;
  const after = validAmount && !overCap ? round2(cap - amount) : cap;

  const handleSubmit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const result = await collectionService.createRecovery({
        dealerId: form.dealerId,
        amount,
        mode: form.mode,
        ...(form.note ? { note: form.note } : {}),
      });
      setBalance(result.balance);
      setOutstanding(result.dealerOutstanding);
      toast.success(`Recovered ${formatRs(amount)}`);
      setForm({ dealerId: '', amount: '', mode: 'cash', note: '' });
      await loadList();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to save the recovery'));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: 'collectedAt',
      title: 'Date/Time',
      render: (v: string) => (v ? format(new Date(v), 'dd MMM, HH:mm') : '-'),
    },
    { key: 'shop', title: 'Party' },
    ...(isRider ? [] : [{ key: 'rider', title: 'Rider' }, { key: 'city', title: 'City' }]),
    {
      key: 'mode',
      title: 'Mode',
      render: (v: string) => (v === 'cash' ? 'Cash' : 'Online'),
    },
    {
      key: 'amount',
      title: 'Amount',
      render: (v: number) => formatRs(v),
      total: 'sum' as const,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'note',
      title: 'Note',
      render: (v: string | null) => v || '-',
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Credit Recovery</h1>
        </div>

        <CollectionModuleNav active="recovery" />

        {isRider && (
          <>
            <div style={{ margin: '1rem 0' }}>
              <RiderBalanceChip balance={balance} />
            </div>

            <div className={styles.listCard} style={{ marginBottom: '1rem' }}>
              <div className={styles.listCardBody}>
                <h2 style={{ margin: '0 0 0.25rem', fontSize: '1rem', color: '#111827' }}>
                  New recovery
                </h2>
                <p style={{ margin: '0 0 1rem', fontSize: '0.8125rem', color: '#6b7280' }}>
                  Money collected against credit given earlier. This is not a new sale.
                </p>

                <label
                  htmlFor="recovery-party"
                  style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
                >
                  Party
                </label>
                <SearchableSelect
                  name="recovery-party"
                  value={form.dealerId}
                  onChange={(e) => setForm((p) => ({ ...p, dealerId: e.target.value }))}
                  placeholder="Search your clients…"
                  options={[
                    { value: '', label: 'Select a client' },
                    ...clients.map((c) => ({ value: c._id, label: formatClientSelectLabel(c) })),
                  ]}
                />

                {form.dealerId && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.75rem 1rem',
                      borderRadius: 10,
                      background: cap > 0 ? '#fffbeb' : '#f9fafb',
                      border: `1px solid ${cap > 0 ? '#fcd34d' : '#e5e7eb'}`,
                    }}
                  >
                    {outstandingLoading ? (
                      <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Checking…</span>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: '0.8125rem', color: '#6b7280', fontWeight: 600 }}>
                            Outstanding
                          </span>
                          <strong style={{ fontSize: '1.25rem', color: cap > 0 ? '#b45309' : '#111827' }}>
                            {formatRs(cap)}
                          </strong>
                        </div>
                        {cap <= 0 && (
                          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#6b7280' }}>
                            This client has no pending credit.
                          </p>
                        )}
                        {validAmount && !overCap && cap > 0 && (
                          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#374151' }}>
                            After this entry: <strong>{formatRs(after)}</strong>
                          </p>
                        )}
                        {overCap && (
                          <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#b91c1c' }}>
                            That is more than this client owes.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '0.875rem' }}>
                  <label
                    htmlFor="recovery-amount"
                    style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
                  >
                    Amount received
                  </label>
                  <input
                    id="recovery-amount"
                    type="text"
                    inputMode="decimal"
                    value={form.amount}
                    disabled={saving}
                    placeholder="0"
                    onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.625rem 0.75rem',
                      borderRadius: 8,
                      border: `1px solid ${overCap ? '#fca5a5' : '#d1d5db'}`,
                      fontSize: '1rem',
                    }}
                  />
                </div>

                <div style={{ marginTop: '0.875rem' }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}>
                    Mode
                  </span>
                  {/* Two large buttons rather than a dropdown — it is a binary choice on a phone. */}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {(['cash', 'online'] as const).map((mode) => {
                      const active = form.mode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={saving}
                          onClick={() => setForm((p) => ({ ...p, mode }))}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            borderRadius: 8,
                            border: `1px solid ${active ? 'var(--admin-primary, #2563eb)' : '#d1d5db'}`,
                            background: active ? 'var(--admin-primary, #2563eb)' : '#fff',
                            color: active ? '#fff' : '#374151',
                            fontWeight: 600,
                            fontSize: '0.9375rem',
                            cursor: 'pointer',
                          }}
                        >
                          {mode === 'cash' ? 'Cash' : 'Online'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginTop: '0.875rem' }}>
                  <label
                    htmlFor="recovery-note"
                    style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
                  >
                    Note <span style={{ fontWeight: 400, color: '#9ca3af' }}>· optional</span>
                  </label>
                  <textarea
                    id="recovery-note"
                    value={form.note}
                    disabled={saving}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      fontSize: '0.875rem',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>

                <button
                  type="button"
                  disabled={!canSave}
                  onClick={handleSubmit}
                  style={{
                    marginTop: '1rem',
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: 8,
                    border: 'none',
                    background: canSave ? '#059669' : '#9ca3af',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '0.9375rem',
                    cursor: canSave ? 'pointer' : 'not-allowed',
                  }}
                >
                  {saving ? 'Saving…' : 'Save recovery'}
                </button>
              </div>
            </div>
          </>
        )}

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#111827' }}>
              {isRider ? 'My recent recoveries' : 'Recovery entries'}
            </h2>

            {!isRider && (
              <div className={styles.searchBar}>
                <RiderSelect
                  riders={riders}
                  value={riderFilter}
                  onChange={setRiderFilter}
                  className={styles.searchSelect}
                />
                <DatePickerFilter value={fromDate} onChange={setFromDate} placeholder="From" title="From" />
                <DatePickerFilter value={toDate} onChange={setToDate} placeholder="To" title="To" />
              </div>
            )}

            <CollectionTotalsRow
              tiles={[
                { label: 'Recovered', value: formatRs(totals.total), hint: `${totals.count} entries` },
                { label: 'Cash', value: formatRs(totals.cash), tone: 'cash' },
                { label: 'Online', value: formatRs(totals.online), tone: 'online' },
              ]}
            />

            {loading ? (
              <Loader />
            ) : (
              <Table
                columns={columns}
                data={rows}
                showGrandTotal
                noDataText="No recovery entries in this period."
                exportFileName="credit-recovery"
                exportPdfTitle="Credit Recovery"
              />
            )}

            {isRider && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                Entries cannot be edited once saved. Ask an admin to correct a mistake.
              </p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function RecoveryPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'delivery_man']}>
      <RecoveryPage />
    </ProtectedRoute>
  );
}
