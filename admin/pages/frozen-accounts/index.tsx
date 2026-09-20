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
import { formatRs } from '../../utils/formatCurrency';
import { can } from '../../utils/permissions';
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
  // The page opens on `account-freeze:view`; the money buttons need `:change`, the same
  // permission the unfreeze route enforces server-side.
  const canChange = can(undefined, 'account-freeze:change');

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
    if (
      !window.confirm(
        `Unfreeze ${name}? They can record work again immediately, and will not be` +
          ` auto-frozen again for the rest of today. If they are late again tomorrow,` +
          ` they are frozen again.`,
      )
    ) {
      return;
    }

    // Optional, so an admin in a hurry can just confirm; whatever they type is kept in
    // the activity log against the account.
    const note = window.prompt(`Reason for unfreezing ${name}? (optional)`) ?? undefined;

    setBusyId(row._id);
    try {
      await accountFreezeService.unfreeze(row._id, note?.trim() || undefined);
      toast.success(`${name} can work again — cleared for the rest of today`);
      load();
    } catch (err) {
      const ax = err as { response?: { data?: { message?: string } } };
      toast.error(ax.response?.data?.message || 'Failed to unfreeze account');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Changes what this rider is fined per late start.
   *
   * The same edit does two things, and the confirmation says so: it sets the rider's amount
   * for future late starts AND re-prices the fine raised today. An admin standing on this
   * screen is looking at today's fine — changing only the future one would leave the number
   * in front of them untouched, which is not what "change his fine" means to anybody.
   */
  const handleChangeFine = async (row: FrozenUser) => {
    const name = employeeDisplayLabel(row) || row.username;
    const entered = window.prompt(
      `Late-start fine for ${name}, in rupees.\n\n` +
        `Currently ${formatRs(row.fineAmount)}${row.hasCustomFineAmount ? ' (set for this rider)' : ' (company default)'}.` +
        `\nEnter 0 to freeze without fining, or leave blank to go back to the default.`,
      String(row.fineAmount),
    );
    if (entered === null) return;

    const trimmed = entered.trim();
    const amount = trimmed === '' ? null : Number(trimmed);
    if (amount !== null && (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0)) {
      toast.error('Enter a whole number of rupees, or leave it blank for the default');
      return;
    }

    setBusyId(row._id);
    try {
      const result = await accountFreezeService.setFineAmount(row._id, amount);
      toast.success(
        result.todayFineUpdated
          ? `${name}: fine set to ${formatRs(result.fineAmount)}, including today's`
          : `${name}: future late starts now cost ${formatRs(result.fineAmount)}`,
      );
      load();
    } catch (err) {
      const ax = err as { response?: { data?: { message?: string } } };
      toast.error(ax.response?.data?.message || 'Failed to update the fine');
    } finally {
      setBusyId(null);
    }
  };

  /** Cancels today's fine. Deliberately separate from unfreezing — two different decisions. */
  const handleWaive = async (row: FrozenUser) => {
    const fine = row.todayFine;
    if (!fine?._id) return;
    const name = employeeDisplayLabel(row) || row.username;
    if (
      !window.confirm(
        `Cancel the ${formatRs(fine.amount)} fine for ${name}? Their account stays frozen` +
          ` until you unfreeze it — this only cancels the money.`,
      )
    ) {
      return;
    }

    const note = window.prompt(`Reason for cancelling the fine? (optional)`) ?? undefined;

    setBusyId(row._id);
    try {
      await accountFreezeService.waiveFine(fine._id, note?.trim() || undefined);
      toast.success(`${name}: fine cancelled`);
      load();
    } catch (err) {
      const ax = err as { response?: { data?: { message?: string } } };
      toast.error(ax.response?.data?.message || 'Failed to cancel the fine');
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
          ? `${summary.frozen} account(s) frozen out of ${summary.evaluated} checked` +
              (summary.fined > 0 ? ` · ${formatRs(summary.finesTotal)} in fines` : '')
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
        exportValue: (row: unknown) =>
          (row as { address?: { city?: string } }).address?.city ?? '',
      },
      {
        key: 'frozenAt',
        title: 'Frozen',
        render: (value?: string) =>
          value ? format(new Date(value), 'MMM dd, yyyy · h:mm a') : '-',
      },
      { key: 'frozenReason', title: 'Reason' },
      {
        key: 'todayFine',
        title: "Today's fine",
        render: (_: unknown, row: FrozenUser) => {
          if (!row.todayFine) {
            // Frozen with no fine: this rider's amount is 0, or the freeze predates the rule.
            return <span style={{ color: '#6b7280' }}>—</span>;
          }
          const waived = row.todayFine.status === 'waived';
          return (
            <span
              style={{
                fontWeight: 600,
                color: waived ? '#6b7280' : '#b91c1c',
                textDecoration: waived ? 'line-through' : undefined,
              }}
              title={waived ? 'Cancelled by an admin' : row.todayFine.reason}
            >
              {formatRs(row.todayFine.amount)}
            </span>
          );
        },
        exportValue: (row: unknown) => String((row as FrozenUser).todayFine?.amount ?? 0),
      },
      {
        key: 'fineAmount',
        title: 'Fine per late start',
        render: (_: unknown, row: FrozenUser) => (
          <span>
            {formatRs(row.fineAmount)}
            {/* Worth marking: an admin looking at a row that reads 200 cannot otherwise tell
                whether it will follow a change to the company default or not. */}
            {row.hasCustomFineAmount && (
              <span style={{ marginLeft: '0.375rem', fontSize: '0.75rem', color: '#6b7280' }}>
                (custom)
              </span>
            )}
          </span>
        ),
        exportValue: (row: unknown) => String((row as FrozenUser).fineAmount),
      },
      {
        key: 'outstandingFines',
        title: 'Outstanding',
        render: (_: unknown, row: FrozenUser) =>
          row.outstandingFines > 0 ? (
            <span title={`${row.outstandingFineCount} fine(s) on record`}>
              {formatRs(row.outstandingFines)}
            </span>
          ) : (
            <span style={{ color: '#6b7280' }}>—</span>
          ),
        exportValue: (row: unknown) => String((row as FrozenUser).outstandingFines),
      },
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
            {canChange && (
              <button
                type="button"
                className={styles.filterSelect}
                style={{
                  cursor: busyId === row._id ? 'wait' : 'pointer',
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.8125rem',
                }}
                disabled={busyId === row._id}
                onClick={() => handleChangeFine(row)}
              >
                Change fine
              </button>
            )}
            {canChange && row.todayFine?.status === 'outstanding' && (
              <button
                type="button"
                className={styles.filterSelect}
                style={{
                  cursor: busyId === row._id ? 'wait' : 'pointer',
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.8125rem',
                  color: '#92400e',
                }}
                disabled={busyId === row._id}
                onClick={() => handleWaive(row)}
              >
                Cancel fine
              </button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId, router, canChange],
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
          unfreeze them here. Each freeze also raises a fine — change the amount for one
          rider with &ldquo;Change fine&rdquo;, or cancel a fine without lifting the freeze.
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
