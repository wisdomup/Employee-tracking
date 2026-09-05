import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import FinanceNav from '../../components/Finance/FinanceNav';
import { canViewReport } from '../../utils/permissions';
import { financeService, journalService, Ledger } from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * The three reports the posting engine makes possible.
 *
 * One page with tabs rather than three routes, matching the Stock Reports and Warehouse Reports
 * precedent — and each tab is hidden unless its own report permission is held, because reports
 * are granted one at a time.
 */

type Tab = 'trial-balance' | 'day-book' | 'ledger-statement';

const TABS: { id: Tab; label: string; reportId: string }[] = [
  { id: 'trial-balance', label: 'Trial Balance', reportId: 'finance.trial-balance' },
  { id: 'day-book', label: 'Day Book', reportId: 'finance.day-book' },
  { id: 'ledger-statement', label: 'Account Statement', reportId: 'finance.ledger-statement' },
];

function money(value: number): string {
  if (!value) return '—';
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const FinanceReportsPage: React.FC = () => {
  const visibleTabs = TABS.filter((t) => canViewReport(t.reportId));
  const [tab, setTab] = useState<Tab>(visibleTabs[0]?.id ?? 'trial-balance');

  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState(today());
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [ledgerId, setLedgerId] = useState('');

  const [trial, setTrial] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [statement, setStatement] = useState<any>(null);

  useEffect(() => {
    if (tab !== 'ledger-statement' || ledgers.length > 0) return;
    financeService
      .getLedgers({ status: 'all' })
      .then(setLedgers)
      .catch(() => toast.error('Could not load the accounts'));
  }, [tab, ledgers.length]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'trial-balance') setTrial(await journalService.trialBalance(asOf));
      else if (tab === 'day-book') setBook(await journalService.dayBook(from, to));
      else if (ledgerId) setStatement(await journalService.ledgerStatement(ledgerId, { from, to }));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not run this report');
    } finally {
      setLoading(false);
    }
  }, [tab, asOf, from, to, ledgerId]);

  useEffect(() => {
    if (tab === 'ledger-statement' && !ledgerId) return;
    run();
  }, [run, tab, ledgerId]);

  if (visibleTabs.length === 0) {
    return (
      <Layout>
        <div className={listStyles.container}>
          <FinanceNav />
          <p className={styles.muted}>No finance reports have been enabled for your account.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Finance Reports</h1>
        </div>

        <FinanceNav />

        <div className={styles.tabBar}>
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.filterRow}>
          {tab === 'trial-balance' && (
            <>
              <label className={styles.settingLabel} htmlFor="asOf">
                Balances as at
              </label>
              <input
                id="asOf"
                type="date"
                className={listStyles.searchSelect}
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </>
          )}

          {tab === 'ledger-statement' && (
            <select
              className={listStyles.searchSelect}
              value={ledgerId}
              onChange={(e) => setLedgerId(e.target.value)}
              aria-label="Account"
            >
              <option value="">Choose an account…</option>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          )}

          {tab !== 'trial-balance' && (
            <>
              <input
                type="date"
                className={listStyles.searchSelect}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From"
              />
              <input
                type="date"
                className={listStyles.searchSelect}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To"
              />
            </>
          )}

          <button type="button" className={formStyles.cancelButton} onClick={run}>
            Refresh
          </button>
        </div>

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            {loading && <Loader />}

            {/* --- Trial balance --- */}
            {!loading && tab === 'trial-balance' && trial && (
              <>
                <div
                  className={`${styles.banner} ${trial.balanced ? styles.bannerOk : styles.bannerBad}`}
                >
                  <span className={styles.bannerTitle}>
                    {trial.balanced
                      ? 'The books balance'
                      : `The books are out by ${money(Math.abs(trial.difference))}`}
                  </span>
                  {trial.balanced
                    ? 'Every entry has an equal and opposite side. This is the check that proves the '
                      + 'ledger is internally consistent.'
                    : 'This should not be possible through normal use. Contact your developer before '
                      + 'relying on any other figure.'}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Account</th>
                        <th>Group</th>
                        <th style={{ textAlign: 'right' }}>Debit</th>
                        <th style={{ textAlign: 'right' }}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trial.rows.map((row: any) => (
                        <tr key={row.ledgerId}>
                          <td>
                            <span className={styles.code}>{row.code}</span>
                          </td>
                          <td>{row.name}</td>
                          <td className={styles.muted}>{row.groupName}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.closingDebit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.closingCredit)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={styles.reportTotals}>
                        <td colSpan={3}>Totals</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{money(trial.totalDebit)}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{money(trial.totalCredit)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}

            {/* --- Day book --- */}
            {!loading && tab === 'day-book' && book && (
              <div style={{ overflowX: 'auto' }}>
                {book.entries.length === 0 ? (
                  <p className={styles.muted}>Nothing was posted in this range.</p>
                ) : (
                  book.entries.map((entry: any) => (
                    <div key={entry.id} className={styles.panel} style={{ marginBottom: '0.75rem' }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.75rem',
                          alignItems: 'baseline',
                          flexWrap: 'wrap',
                          marginBottom: '0.5rem',
                        }}
                      >
                        <span className={styles.code}>#{entry.entryNo ?? '—'}</span>
                        <strong>{entry.narration || '—'}</strong>
                        <span className={styles.muted}>
                          {new Date(entry.date).toLocaleDateString()}
                        </span>
                        <span className={`${styles.status} ${styles[`status_${entry.status}`]}`}>
                          {entry.status}
                        </span>
                      </div>
                      <table className={styles.roleTable}>
                        <tbody>
                          {entry.lines.map((line: any, i: number) => (
                            <tr key={i}>
                              <td>
                                <span className={styles.code}>{line.ledgerCode}</span>{' '}
                                {line.ledgerName}
                              </td>
                              <td style={{ textAlign: 'right', width: '9rem' }}>
                                <span className={styles.amount}>{money(line.debit)}</span>
                              </td>
                              <td style={{ textAlign: 'right', width: '9rem' }}>
                                <span className={styles.amount}>{money(line.credit)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* --- Account statement --- */}
            {!loading && tab === 'ledger-statement' && !ledgerId && (
              <p className={styles.muted}>Choose an account to see its statement.</p>
            )}

            {!loading && tab === 'ledger-statement' && ledgerId && statement && (
              <>
                <div className={styles.settingsGrid}>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Account</span>
                    <span className={styles.settingValue}>
                      {statement.ledger.code} · {statement.ledger.name}
                    </span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Opening</span>
                    <span className={styles.settingValue}>{money(statement.opening)}</span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Closing</span>
                    <span className={styles.settingValue}>{money(statement.closing)}</span>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>#</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Debit</th>
                        <th style={{ textAlign: 'right' }}>Credit</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.rows.map((row: any, i: number) => (
                        <tr key={i}>
                          <td>{new Date(row.date).toLocaleDateString()}</td>
                          <td>
                            <span className={styles.code}>{row.entryNo ?? '—'}</span>
                          </td>
                          <td>{row.narration || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.debit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.credit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span
                              className={`${styles.amount} ${
                                row.runningBalance < 0 ? styles.amountNegative : ''
                              }`}
                            >
                              {row.runningBalance.toLocaleString('en-PK', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function FinanceReportsPageWrapper() {
  return (
    <ProtectedRoute reportPrefix="finance.">
      <FinanceReportsPage />
    </ProtectedRoute>
  );
}
