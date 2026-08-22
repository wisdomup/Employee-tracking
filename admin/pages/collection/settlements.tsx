import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import Table from '../../components/UI/Table';
import SearchableSelect from '../../components/UI/SearchableSelect';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import CollectionModuleNav from '../../components/Collection/CollectionModuleNav';
import RiderBalanceChip from '../../components/Collection/RiderBalanceChip';
import CollectionTotalsRow from '../../components/Collection/CollectionTotalsRow';
import RiderSelect from '../../components/Collection/RiderSelect';
import SettlementSubmitModal from '../../components/Collection/SettlementSubmitModal';
import {
  collectionService,
  RiderBalance,
  SettlementRow,
  RiderSummary,
} from '../../services/collectionService';
import { useAuth } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs } from '../../utils/formatCurrency';
import styles from '../../styles/ListPage.module.scss';

/**
 * Spec §6 — settlement, branching on role.
 *
 * Rider: two buttons and their own history. Admin: the pending cash queue with a Mark Received
 * action, which is the step that actually reduces a rider's balance.
 */

const SettlementsPage: React.FC = () => {
  const { user } = useAuth();
  const isRider = user?.role === 'delivery_man';

  const [balance, setBalance] = useState<RiderBalance | null>(null);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [totals, setTotals] = useState({
    pendingCash: 0,
    pendingOnline: 0,
    receivedCash: 0,
    receivedOnline: 0,
  });
  const [riders, setRiders] = useState<RiderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [submitMode, setSubmitMode] = useState<'cash' | 'online' | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);

  // Admin filters
  const [riderFilter, setRiderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, bal] = await Promise.all([
        collectionService.getSettlements({
          riderId: isRider ? undefined : riderFilter || undefined,
          status: (statusFilter || undefined) as 'pending' | 'received' | undefined,
          mode: (modeFilter || undefined) as 'cash' | 'online' | undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
        isRider ? collectionService.getMyBalance() : Promise.resolve(null),
      ]);
      setRows(list.rows);
      setTotals(list.totals);
      if (bal) setBalance(bal);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load settlements'));
    } finally {
      setLoading(false);
    }
  }, [isRider, riderFilter, statusFilter, modeFilter, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isRider) collectionService.getRiders().then(setRiders).catch(() => {});
  }, [isRider]);

  const handleSubmit = async (body: {
    mode: 'cash' | 'online';
    amount: number;
    note?: string;
    screenshotUrl?: string;
  }) => {
    setSubmitBusy(true);
    try {
      const result = await collectionService.submitSettlement(body);
      setBalance(result.balance);
      toast.success(
        body.mode === 'cash'
          ? 'Recorded. Waiting for the office to confirm.'
          : 'Online transfer settled.',
      );
      setSubmitMode(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to submit the settlement'));
    } finally {
      setSubmitBusy(false);
    }
  };

  const handleReceive = async (row: SettlementRow) => {
    if (
      !window.confirm(
        `Confirm you received ${formatRs(row.amount)} in cash from ${row.rider}? This reduces their balance.`,
      )
    ) {
      return;
    }
    setReceivingId(row._id);
    try {
      await collectionService.receiveSettlement(row._id);
      toast.success('Marked received');
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to mark received'));
    } finally {
      setReceivingId(null);
    }
  };

  const columns = [
    {
      key: 'submittedAt',
      title: 'Submitted',
      render: (v: string) => (v ? format(new Date(v), 'dd MMM, HH:mm') : '-'),
    },
    ...(isRider ? [] : [{ key: 'rider', title: 'Rider' }, { key: 'city', title: 'City' }]),
    { key: 'mode', title: 'Mode', render: (v: string) => (v === 'cash' ? 'Cash' : 'Online') },
    {
      key: 'amount',
      title: 'Amount',
      render: (v: number) => formatRs(v),
      total: 'sum' as const,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'status',
      title: 'Status',
      render: (v: string, row: SettlementRow) => (
        <span style={{ color: v === 'received' ? '#047857' : '#b45309', fontWeight: 600 }}>
          {v === 'received' ? (row.autoReceived ? 'Received (auto)' : 'Received') : 'Pending'}
        </span>
      ),
    },
    {
      key: 'screenshotUrl',
      title: 'Proof',
      omitFromExport: true,
      render: (v: string) =>
        v ? (
          <a href={v} target="_blank" rel="noreferrer" style={{ color: 'var(--admin-primary)' }}>
            View
          </a>
        ) : (
          '-'
        ),
    },
    ...(isRider
      ? []
      : [
          {
            key: 'actions',
            title: 'Actions',
            omitFromExport: true,
            render: (_: unknown, row: SettlementRow) =>
              row.mode === 'cash' && row.status === 'pending' ? (
                <button
                  className={styles.approveButton}
                  disabled={receivingId === row._id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReceive(row);
                  }}
                >
                  {receivingId === row._id ? 'Saving…' : 'Mark Received'}
                </button>
              ) : (
                '-'
              ),
          },
        ]),
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Settlements</h1>
        </div>

        <CollectionModuleNav active="settlements" />

        {isRider ? (
          <>
            <div style={{ margin: '1rem 0' }}>
              <RiderBalanceChip balance={balance} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSubmitMode('cash')}
                style={{
                  flex: '1 1 200px',
                  padding: '0.875rem',
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--admin-primary, #2563eb)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  cursor: 'pointer',
                }}
              >
                Pay cash to company
              </button>
              <button
                type="button"
                onClick={() => setSubmitMode('online')}
                style={{
                  flex: '1 1 200px',
                  padding: '0.875rem',
                  borderRadius: 10,
                  border: '1px solid var(--admin-primary, #2563eb)',
                  background: '#fff',
                  color: 'var(--admin-primary, #2563eb)',
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  cursor: 'pointer',
                }}
              >
                Submit online transfer
              </button>
            </div>
          </>
        ) : (
          <div style={{ margin: '1rem 0' }}>
            <CollectionTotalsRow
              tiles={[
                {
                  label: 'Cash awaiting receipt',
                  value: formatRs(totals.pendingCash),
                  tone: 'credit',
                  hint: 'Riders are holding this',
                },
                { label: 'Cash received', value: formatRs(totals.receivedCash), tone: 'cash' },
                { label: 'Online settled', value: formatRs(totals.receivedOnline), tone: 'online' },
                { label: 'Online pending', value: formatRs(totals.pendingOnline) },
              ]}
            />
          </div>
        )}

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            {!isRider && (
              <div className={styles.searchBar}>
                <RiderSelect
                  riders={riders}
                  value={riderFilter}
                  onChange={setRiderFilter}
                  className={styles.searchSelect}
                  showBalance
                />
                <SearchableSelect
                  name="statusFilter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={styles.searchSelect}
                  style={{ maxWidth: 170 }}
                  placeholder="All Statuses"
                  options={[
                    { value: '', label: 'All Statuses' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'received', label: 'Received' },
                  ]}
                />
                <SearchableSelect
                  name="modeFilter"
                  value={modeFilter}
                  onChange={(e) => setModeFilter(e.target.value)}
                  className={styles.searchSelect}
                  style={{ maxWidth: 150 }}
                  placeholder="All Modes"
                  options={[
                    { value: '', label: 'All Modes' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'online', label: 'Online' },
                  ]}
                />
                <DatePickerFilter value={fromDate} onChange={setFromDate} placeholder="From" title="From" />
                <DatePickerFilter value={toDate} onChange={setToDate} placeholder="To" title="To" />
              </div>
            )}

            <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#111827' }}>
              {isRider ? 'My settlements' : 'Settlement entries'}
            </h2>

            {loading ? (
              <Loader />
            ) : (
              <Table
                columns={columns}
                data={rows}
                showGrandTotal
                noDataText="No settlements in this period."
                exportFileName="settlements"
                exportPdfTitle="Settlements"
              />
            )}

            {isRider && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                Entries cannot be edited once submitted. Ask an admin to correct a mistake.
              </p>
            )}
          </div>
        </div>
      </div>

      <SettlementSubmitModal
        open={submitMode !== null}
        mode={submitMode ?? 'cash'}
        balance={balance}
        busy={submitBusy}
        onClose={() => {
          if (!submitBusy) setSubmitMode(null);
        }}
        onSubmit={handleSubmit}
      />
    </Layout>
  );
};

export default function SettlementsPageWrapper() {
  return (
    <ProtectedRoute permission="collections:view">
      <SettlementsPage />
    </ProtectedRoute>
  );
}
