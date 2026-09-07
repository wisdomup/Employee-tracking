import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import FinanceNav from '../../components/Finance/FinanceNav';
import { can } from '../../utils/permissions';
import {
  journalService,
  FinancialPeriod,
  CloseCheck,
  PeriodStatus,
} from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * Which accounting months accept work, and what it takes to close one.
 *
 * The close checks are shown before the button rather than after a refusal. "Cannot close" with
 * no reason is the kind of message people work around instead of acting on.
 */

const STATUS_HELP: Record<PeriodStatus, string> = {
  open: 'Accepting entries.',
  closed: 'Signed off. New entries are refused; a correction can still be posted into it.',
  locked: 'Sealed. Nothing can be posted or corrected, not even a reversal.',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(period: string): string {
  const [year, month] = period.split('-');
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

const PeriodsPage: React.FC = () => {
  const [periods, setPeriods] = useState<FinancialPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checksFor, setChecksFor] = useState<string | null>(null);
  const [checks, setChecks] = useState<CloseCheck[]>([]);
  const [newPeriod, setNewPeriod] = useState('');
  const [newYear, setNewYear] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPeriods(await journalService.listPeriods());
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the accounting months');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showChecks = async (period: string) => {
    setChecksFor(period);
    setChecks([]);
    try {
      const data = await journalService.periodChecks(period);
      setChecks(data.checks);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not run the checks');
    }
  };

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setChecksFor(null);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (period: string) => {
    const reason = window.prompt(
      `Reopening ${monthLabel(period)} lets entries change after it was signed off.\n\n`
        + 'Why is it being reopened?',
    );
    if (!reason?.trim()) return;
    await act(() => journalService.reopenPeriod(period, reason.trim()), `${period} reopened`);
  };

  const canChange = can(undefined, 'finance-period:change');

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Accounting Months</h1>
        </div>

        <FinanceNav />

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>A month must be opened before anything can be posted into it</span>
          A month with no record here refuses entries. That is deliberate: a mistyped year is
          turned away rather than quietly filed in a year nobody looks at again.
        </div>

        {canChange && (
          <div className={formStyles.form} style={{ marginBottom: '1.25rem' }}>
            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="newYear">Open a whole financial year</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    id="newYear"
                    type="text"
                    className={formStyles.input}
                    value={newYear}
                    disabled={busy}
                    onChange={(e) => setNewYear(e.target.value)}
                    placeholder="2026-27"
                  />
                  <button
                    type="button"
                    className={formStyles.submitButton}
                    disabled={busy || !newYear.trim()}
                    onClick={() =>
                      act(
                        () => journalService.openFiscalYear(newYear.trim()),
                        `${newYear.trim()} opened`,
                      ).then(() => setNewYear(''))
                    }
                  >
                    Open Year
                  </button>
                </div>
                <p className={formStyles.hint}>
                  Opens all twelve months at once. The financial year runs July to June.
                </p>
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="newPeriod">Or open a single month</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    id="newPeriod"
                    type="month"
                    className={formStyles.input}
                    value={newPeriod}
                    disabled={busy}
                    onChange={(e) => setNewPeriod(e.target.value)}
                  />
                  <button
                    type="button"
                    className={formStyles.cancelButton}
                    disabled={busy || !newPeriod}
                    onClick={() =>
                      act(() => journalService.openPeriod(newPeriod), `${newPeriod} opened`)
                        .then(() => setNewPeriod(''))
                    }
                  >
                    Open Month
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            {loading ? (
              <Loader />
            ) : periods.length === 0 ? (
              <p className={styles.muted}>
                No months are open yet. Open a financial year above to start posting.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.roleTable}>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Financial year</th>
                      <th>Status</th>
                      <th>What that means</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((period) => (
                      <React.Fragment key={period._id}>
                        <tr>
                          <td style={{ fontWeight: 600 }}>{monthLabel(period.period)}</td>
                          <td className={styles.muted}>{period.fiscalYear}</td>
                          <td>
                            <span
                              className={`${styles.status} ${styles[`status_${period.status}`]}`}
                            >
                              {period.status}
                            </span>
                          </td>
                          <td className={styles.muted}>
                            {STATUS_HELP[period.status]}
                            {period.reopenReason && (
                              <>
                                {' '}
                                <em>Reopened: {period.reopenReason}</em>
                              </>
                            )}
                          </td>
                          <td>
                            <div className={listStyles.actions}>
                              {period.status === 'open' && (
                                <button
                                  className={listStyles.editButton}
                                  onClick={() => showChecks(period.period)}
                                >
                                  Close…
                                </button>
                              )}
                              {period.status === 'closed' && canChange && (
                                <button
                                  className={listStyles.approveButton}
                                  onClick={() => reopen(period.period)}
                                >
                                  Reopen
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {checksFor === period.period && (
                          <tr>
                            <td colSpan={5}>
                              <div className={styles.panel}>
                                <h3 className={styles.panelTitle}>
                                  Before {monthLabel(period.period)} can close
                                </h3>
                                {checks.length === 0 ? (
                                  <Loader />
                                ) : (
                                  <>
                                    <ul className={styles.checkList}>
                                      {checks.map((check) => (
                                        <li key={check.name} className={styles.checkItem}>
                                          <span
                                            className={`${styles.checkMark} ${
                                              check.ok ? styles.checkPass : styles.checkFail
                                            }`}
                                            aria-hidden="true"
                                          >
                                            {check.ok ? '✓' : '!'}
                                          </span>
                                          <span>
                                            <span className={styles.checkName}>{check.name}</span>
                                            <span className={styles.checkDetail}>
                                              {check.detail}
                                            </span>
                                          </span>
                                        </li>
                                      ))}
                                    </ul>

                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: '0.5rem',
                                        marginTop: '1rem',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <button
                                        className={formStyles.cancelButton}
                                        onClick={() => setChecksFor(null)}
                                      >
                                        Cancel
                                      </button>
                                      {canChange && (
                                        <button
                                          className={formStyles.submitButton}
                                          disabled={busy || checks.some((c) => !c.ok)}
                                          onClick={() =>
                                            act(
                                              () => journalService.closePeriod(period.period),
                                              `${monthLabel(period.period)} closed`,
                                            )
                                          }
                                        >
                                          Close {monthLabel(period.period)}
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function PeriodsPageWrapper() {
  return (
    <ProtectedRoute permission="finance-period:view">
      <PeriodsPage />
    </ProtectedRoute>
  );
}
