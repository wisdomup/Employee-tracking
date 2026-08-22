import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { employeeDisplayLabel } from '../../utils/employeeDisplayLabel';
import {
  accountFreezeService,
  FrozenUser,
} from '../../services/accountFreezeService';
import styles from '../../styles/Reports.module.scss';

/**
 * The admin's unfreeze queue: riders locked out for not reaching their first shop by the
 * daily deadline. This is the only place a freeze can be lifted, and the rider is told to
 * come here (via "Contact admin") by the banner on their own screen.
 */
const FrozenAccountsPage: React.FC = () => {
  const router = useRouter();
  const [users, setUsers] = useState<FrozenUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await accountFreezeService.getFrozenUsers());
    } catch {
      toast.error('Failed to load frozen accounts');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnfreeze = async (row: FrozenUser) => {
    const name = employeeDisplayLabel(row) || row.username;
    if (!window.confirm(`Unfreeze ${name}? They will be able to record work again immediately.`)) {
      return;
    }

    // Optional, so an admin in a hurry can just confirm; whatever they type is kept in
    // the activity log against the account.
    const note = window.prompt(`Reason for unfreezing ${name}? (optional)`) ?? undefined;

    setBusyId(row._id);
    try {
      await accountFreezeService.unfreeze(row._id, note?.trim() || undefined);
      toast.success(`${name} can work again`);
      load();
    } catch (err) {
      const ax = err as { response?: { data?: { message?: string } } };
      toast.error(ax.response?.data?.message || 'Failed to unfreeze account');
    } finally {
      setBusyId(null);
    }
  };

  const handleSweep = async () => {
    setSweeping(true);
    try {
      const summary = await accountFreezeService.runSweep();
      toast.success(
        summary.frozen > 0
          ? `${summary.frozen} account(s) frozen out of ${summary.evaluated} checked`
          : `No new late starters out of ${summary.evaluated} checked`,
      );
      load();
    } catch {
      toast.error('Failed to run the check');
    } finally {
      setSweeping(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'fullName',
        title: 'Rider',
        render: (_: unknown, row: FrozenUser) => (
          <span style={{ fontWeight: 600 }}>{employeeDisplayLabel(row) || '-'}</span>
        ),
      },
      { key: 'username', title: 'Username' },
      { key: 'phone', title: 'Phone' },
      {
        key: 'address',
        title: 'City',
        render: (value: unknown) => (value as { city?: string })?.city || '-',
      },
      {
        key: 'frozenAt',
        title: 'Frozen',
        render: (value?: string) =>
          value ? format(new Date(value), 'MMM dd, yyyy · h:mm a') : '-',
      },
      { key: 'frozenReason', title: 'Reason' },
      {
        key: 'frozenBy',
        title: 'Frozen by',
        // Absent means the daily rule caught them rather than an admin acting by hand.
        render: (value: FrozenUser['frozenBy']) =>
          value ? employeeDisplayLabel(value) || 'Admin' : 'System (late start)',
      },
      {
        key: '_actions',
        title: 'Actions',
        render: (_: unknown, row: FrozenUser) => (
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={styles.filterSelect}
              style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
              onClick={() => router.push(`/employees/${row._id}`)}
            >
              View
            </button>
            <button
              type="button"
              className={styles.filterSelect}
              style={{
                cursor: busyId === row._id ? 'wait' : 'pointer',
                padding: '0.25rem 0.5rem',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#065f46',
              }}
              disabled={busyId === row._id}
              onClick={() => handleUnfreeze(row)}
            >
              {busyId === row._id ? 'Unfreezing…' : 'Unfreeze'}
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId, router],
  );

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Frozen Accounts</h1>
          <button
            type="button"
            className={styles.filterSelect}
            style={{ cursor: sweeping ? 'wait' : 'pointer' }}
            disabled={sweeping}
            onClick={handleSweep}
          >
            {sweeping ? 'Checking…' : 'Run late-start check now'}
          </button>
        </div>

        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
          Riders who did not reach their first shop by the daily deadline. A frozen rider
          can still sign in and see their day, but cannot record any work until you
          unfreeze them here.
          {users.length > 0 && (
            <strong style={{ color: '#b91c1c' }}> {users.length} frozen.</strong>
          )}
        </p>

        <div className={styles.section}>
          <div className={styles.tableWrap}>
            <Table
              columns={columns}
              data={users}
              loading={loading}
              exportFileName="frozen-accounts"
              exportPdfTitle="Frozen Accounts"
            />
          </div>
          {!loading && users.length === 0 && (
            <div className={styles.emptyState}>
              No frozen accounts — everyone started on time.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default function FrozenAccountsPageWrapper() {
  return (
    <ProtectedRoute permission="account-freeze:view">
      <FrozenAccountsPage />
    </ProtectedRoute>
  );
}
