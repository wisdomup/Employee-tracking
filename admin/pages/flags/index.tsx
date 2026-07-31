import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import SearchableSelect from '../../components/UI/SearchableSelect';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import { useAuth } from '../../contexts/AuthContext';
import { ALL_ROLES, can } from '../../utils/permissions';
import { employeeDisplayLabel } from '../../utils/employeeDisplayLabel';
import {
  performanceFlagService,
  PerformanceFlag,
  PerformanceFlagType,
} from '../../services/analyticsService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/Reports.module.scss';

const TYPE_LABEL: Record<PerformanceFlagType, string> = {
  low_visit_completion: 'Low visit completion',
  overstay: 'Overstay',
};

/**
 * The admin "needs review" feed: riders who dropped below the visit-completion pass
 * mark or stayed too long at a shop. Scoped server-side — a sales manager sees only
 * their own team, a rider only their own flags.
 */
const FlagsPage: React.FC = () => {
  const router = useRouter();
  const { user } = useAuth();
  const canResolve = user?.role === 'admin' || can(user?.role, 'targets:manage');

  const [flags, setFlags] = useState<PerformanceFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'' | PerformanceFlagType>('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await performanceFlagService.getFlags({
        type: typeFilter || undefined,
        resolved: statusFilter === 'all' ? undefined : statusFilter === 'resolved',
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setFlags(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load flags');
      setFlags([]);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const handleResolve = async (id: string) => {
    try {
      await performanceFlagService.resolveFlag(id);
      toast.success('Flag marked as reviewed');
      load();
    } catch {
      toast.error('Failed to resolve flag');
    }
  };

  const openCount = useMemo(() => flags.filter((f) => !f.resolved).length, [flags]);

  const columns = useMemo(
    () => [
      {
        key: 'employeeId',
        title: 'Employee',
        render: (value: PerformanceFlag['employeeId']) => (
          <span style={{ fontWeight: 600 }}>{employeeDisplayLabel(value) || '-'}</span>
        ),
      },
      {
        key: 'type',
        title: 'Reason',
        render: (value: PerformanceFlagType) => (
          <span
            style={{
              display: 'inline-block',
              padding: '0.125rem 0.5rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: value === 'overstay' ? '#fef3c7' : '#fee2e2',
              color: value === 'overstay' ? '#92400e' : '#b91c1c',
            }}
          >
            {TYPE_LABEL[value] ?? value}
          </span>
        ),
      },
      {
        key: 'flagDate',
        title: 'Date',
        render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
      },
      { key: 'message', title: 'Detail' },
      {
        key: 'value',
        title: 'Measured / Limit',
        render: (_: unknown, row: PerformanceFlag) =>
          row.value == null ? '-' : `${row.value} / ${row.threshold ?? '-'}`,
      },
      {
        key: 'resolved',
        title: 'Status',
        render: (value: boolean, row: PerformanceFlag) =>
          value ? (
            <span style={{ color: '#065f46' }}>
              Reviewed
              {row.resolvedAt ? ` · ${format(new Date(row.resolvedAt), 'MMM dd')}` : ''}
            </span>
          ) : (
            <span style={{ color: '#b91c1c', fontWeight: 600 }}>Open</span>
          ),
      },
      {
        key: '_actions',
        title: 'Actions',
        render: (_: unknown, row: PerformanceFlag) => (
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            {row.visitId && (
              <button
                type="button"
                className={styles.filterSelect}
                style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                onClick={() => router.push(`/visits/${row.visitId}`)}
              >
                View visit
              </button>
            )}
            {canResolve && !row.resolved && (
              <button
                type="button"
                className={styles.filterSelect}
                style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                onClick={() => handleResolve(row._id)}
              >
                Mark reviewed
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canResolve, router],
  );

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Performance Flags</h1>
        </div>

        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
          Riders who finished a day below the visit-completion pass mark, or who stayed
          longer than allowed at a shop.
          {openCount > 0 && (
            <strong style={{ color: '#b91c1c' }}> {openCount} open.</strong>
          )}
        </p>

        <div className={styles.filters}>
          <SearchableSelect
            name="typeFilter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as '' | PerformanceFlagType)}
            className={styles.filterSelect}
            placeholder="All reasons"
            options={[
              { value: '', label: 'All reasons' },
              { value: 'low_visit_completion', label: 'Low visit completion' },
              { value: 'overstay', label: 'Overstay' },
            ]}
          />
          <SearchableSelect
            name="statusFilter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'open' | 'resolved' | 'all')}
            className={styles.filterSelect}
            placeholder="Open only"
            options={[
              { value: 'open', label: 'Open only' },
              { value: 'resolved', label: 'Reviewed only' },
              { value: 'all', label: 'All' },
            ]}
          />
          <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="From" />
          <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="To" />
        </div>

        <div className={styles.section}>
          <div className={styles.tableWrap}>
            <Table
              columns={columns}
              data={flags}
              loading={loading}
              exportFileName="performance-flags"
              exportPdfTitle="Performance Flags"
            />
          </div>
          {!loading && flags.length === 0 && (
            <div className={styles.emptyState}>No flags for the selected filters.</div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default function FlagsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <FlagsPage />
    </ProtectedRoute>
  );
}
