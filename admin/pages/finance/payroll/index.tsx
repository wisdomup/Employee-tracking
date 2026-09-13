import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { money } from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import { payrollService, PayrollRun } from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import formStyles from '../../../styles/FormPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Payroll, month by month.
 *
 * Starting a month and posting it are different acts by different people, so a month waiting to be
 * posted is called out at the top — a prepared run nobody posts is wages nobody gets paid.
 */

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const PayrollPage: React.FC = () => {
  const router = useRouter();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [owed, setOwed] = useState<{ userId: string; name: string; owed: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState(lastMonth());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, balances] = await Promise.all([
        payrollService.listRuns(status === 'all' ? undefined : status),
        payrollService.advanceBalances().catch(() => []),
      ]);
      setRuns(list);
      setOwed(balances);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the payroll runs');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const start = async () => {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      toast.error('Choose a month');
      return;
    }
    setBusy(true);
    try {
      const run = await payrollService.createRun(period);
      toast.success(`${run.periodLabel} started — ${run.employeeCount} people`);
      router.push(`/finance/payroll/${run.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not start this month');
    } finally {
      setBusy(false);
    }
  };

  const waiting = runs.filter((r) => r.status === 'draft');
  const unpaid = runs.filter((r) => r.status === 'posted' && r.outstanding > 0.005);
  const totalOwedToStaff = unpaid.reduce((s, r) => s + r.outstanding, 0);
  const totalAdvances = owed.reduce((s, r) => s + r.owed, 0);

  const columns = [
    { key: 'periodLabel', title: 'Month' },
    {
      key: 'employeeCount',
      title: 'People',
      render: (v: number) => <span className={styles.amount}>{v}</span>,
    },
    {
      key: 'totals',
      title: 'Wage bill',
      render: (v: PayrollRun['totals']) => (
        <span className={styles.amount}>
          {money(v.gross)}
          {v.advanceRecovery > 0 && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              less {money(v.advanceRecovery)} recovered
            </div>
          )}
        </span>
      ),
    },
    {
      key: 'outstanding',
      title: 'Still to pay',
      render: (v: number, row: PayrollRun) => {
        if (row.status !== 'posted') return <span className={styles.amount}>—</span>;
        return (
          <span className={`${styles.amount} ${v > 0.005 ? styles.amountNegative : ''}`}>
            {v > 0.005 ? money(v) : 'Paid'}
            {row.paidAmount > 0 && v > 0.005 && (
              <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                {money(row.paidAmount)} of {money(row.totals.net)} paid
              </div>
            )}
          </span>
        );
      },
    },
    {
      key: 'status',
      title: 'Status',
      render: (v: PayrollRun['status']) => (
        <span
          className={`${styles.status} ${
            v === 'posted'
              ? styles.status_posted
              : v === 'cancelled'
                ? styles.status_void
                : styles.status_draft
          }`}
        >
          {v === 'posted' ? 'Posted' : v === 'cancelled' ? 'Cancelled' : 'Being prepared'}
        </span>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Payroll</h1>
          {can(undefined, 'finance-payroll:view') && (
            <button
              className={listStyles.addButton}
              style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
              onClick={() => router.push('/finance/payroll/advances')}
            >
              Staff Advances
            </button>
          )}
        </div>

        <FinanceNav />

        {waiting.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>
              {waiting.map((r) => r.periodLabel).join(', ')}{' '}
              {waiting.length === 1 ? 'is' : 'are'} prepared and not posted
            </span>
            {can(undefined, 'finance-payroll:change')
              ? 'Check the figures and post the month. Nothing is owed to staff in the books until you do.'
              : 'Somebody allowed to post payroll needs to check and post it.'}
          </div>
        )}

        {unpaid.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <span className={styles.bannerTitle}>
              {money(totalOwedToStaff)} of wages is posted and not yet paid
            </span>
            {unpaid.map((r) => r.periodLabel).join(', ')}. Record each payment as the money actually
            goes out.
          </div>
        )}

        <div className={styles.settingsGrid}>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Months recorded</span>
            <span className={styles.settingValue}>{runs.length}</span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Wages owed to staff</span>
            <span className={styles.settingValue}>{money(totalOwedToStaff)}</span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Advances staff owe back</span>
            <span className={styles.settingValue}>{money(totalAdvances)}</span>
          </div>
        </div>

        {can(undefined, 'finance-payroll:add') && (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Start a month</h2>
            <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
              Every active employee with a salary, bonus or allowance recorded is brought in, with
              their figures ready to correct. Nothing reaches the accounts until it is posted.
            </p>
            <div className={styles.filterRow}>
              <input
                type="month"
                className={listStyles.searchSelect}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-label="Month"
              />
              <button
                type="button"
                className={formStyles.submitButton}
                onClick={start}
                disabled={busy}
              >
                {busy ? 'Starting…' : 'Start This Month'}
              </button>
            </div>
          </div>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <select
                className={listStyles.searchSelect}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status"
              >
                <option value="all">Every month</option>
                <option value="draft">Being prepared</option>
                <option value="posted">Posted</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <Table
              columns={columns}
              data={runs}
              loading={loading}
              onRowClick={(row: PayrollRun) => router.push(`/finance/payroll/${row.id}`)}
              exportFileName="payroll-runs"
              exportPdfTitle="Payroll"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function PayrollPageWrapper() {
  return (
    <ProtectedRoute permission="finance-payroll:view">
      <PayrollPage />
    </ProtectedRoute>
  );
}
