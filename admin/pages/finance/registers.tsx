import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import FinanceNav from '../../components/Finance/FinanceNav';
import TrailPanel from '../../components/Finance/TrailPanel';
import TrailAmount from '../../components/Finance/TrailAmount';
import TrailLink from '../../components/Finance/TrailLink';
import { useTrail } from '../../hooks/useTrail';
import { can } from '../../utils/permissions';
import {
  registerService,
  sourceTypeLabel,
  ReversalRegister,
  WriteOffRegister,
} from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * What was undone, and what was given up on.
 *
 * Every reversal and every rider shortfall written off, in one place. These are the ways money
 * leaves the books without a sale or a payment behind it, so they are what a finance manager reviews
 * first. Each list shows only to someone holding its own view permission — those two cells existed in
 * the matrix before this page did, and ticking them used to grant nothing at all.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('en-PK') : '—';
}

const RegistersPage: React.FC = () => {
  const canReversals = can(undefined, 'finance-reversal:view');
  const canWriteOffs = can(undefined, 'finance-writeoff:view');
  const { stack: trailStack, openTrail, pushTrail, goToTrail, closeTrail } = useTrail();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reversals, setReversals] = useState<ReversalRegister | null>(null);
  const [writeOffs, setWriteOffs] = useState<WriteOffRegister | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const window = { from: from || undefined, to: to || undefined };
    try {
      const [rev, wo] = await Promise.all([
        canReversals ? registerService.reversals(window) : Promise.resolve(null),
        canWriteOffs ? registerService.writeOffs(window) : Promise.resolve(null),
      ]);
      setReversals(rev);
      setWriteOffs(wo);
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: unknown } } })
        ?.response?.data?.message;
      toast.error(typeof message === 'string' && message ? message : 'Could not load the registers');
    } finally {
      setLoading(false);
    }
  }, [from, to, canReversals, canWriteOffs]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Reversals &amp; Write-offs</h1>
        </div>

        <FinanceNav />

        <div className={styles.filterRow}>
          <div className={formStyles.formGroup}>
            <label htmlFor="from">From</label>
            <input
              id="from"
              type="date"
              className={formStyles.input}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className={formStyles.formGroup}>
            <label htmlFor="to">To</label>
            <input
              id="to"
              type="date"
              className={formStyles.input}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <p className={styles.readonlyNote}>
          Dated by when it was undone or written off, not by the original document. Blank dates show
          everything, newest first, up to 500 rows.
        </p>

        {loading ? (
          <Loader />
        ) : (
          <>
            {reversals && (
              <div className={listStyles.listCard} style={{ marginBottom: '1.5rem' }}>
                <div className={listStyles.listCardBody}>
                  <h2 className={styles.panelTitle}>
                    Reversed entries · {reversals.count} · {money(reversals.total)}
                  </h2>
                  <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
                    The entry that was undone, with who undid it and why. Its reversal is the entry in
                    the last column; together they leave nothing on the accounts.
                  </p>
                  {reversals.truncated && (
                    <div className={`${styles.banner} ${styles.bannerInfo}`}>
                      Only the newest 500 are shown. Narrow the dates to see the rest.
                    </div>
                  )}
                  {reversals.rows.length === 0 ? (
                    <p className={styles.muted}>Nothing was reversed in these dates.</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className={styles.roleTable}>
                        <thead>
                          <tr>
                            <th>Reversed</th>
                            <th>Entry</th>
                            <th>What it was</th>
                            <th style={{ textAlign: 'right' }}>Amount</th>
                            <th>By</th>
                            <th>Why</th>
                            <th>Reversed by entry</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reversals.rows.map((row) => (
                            <tr key={row.entryId}>
                              <td>{when(row.reversedAt)}</td>
                              <td>
                                <TrailLink trail={{ kind: 'entry', entryId: row.entryId }} onOpen={openTrail}>
                                  <span className={styles.code}>{row.entryNo ?? 'view'}</span>
                                </TrailLink>
                                <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                                  dated {when(row.date)}
                                </div>
                              </td>
                              <td>
                                {row.narration || '—'}
                                <div style={{ fontSize: '0.76rem' }}>
                                  {row.document?.href ? (
                                    <Link href={row.document.href}>
                                      {sourceTypeLabel(row.sourceType)}
                                    </Link>
                                  ) : (
                                    <span className={styles.muted}>{sourceTypeLabel(row.sourceType)}</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <TrailAmount
                                  value={row.amount}
                                  trail={{ kind: 'entry', entryId: row.entryId }}
                                  onOpen={openTrail}
                                  format={money}
                                />
                              </td>
                              <td>{row.reversedBy ?? '—'}</td>
                              <td>{row.reason || '—'}</td>
                              <td>
                                {row.reversalEntryId ? (
                                  <TrailLink trail={{ kind: 'entry', entryId: row.reversalEntryId! }} onOpen={openTrail}>
                                    <span className={styles.code}>{row.reversalEntryNo ?? 'view'}</span>
                                  </TrailLink>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {writeOffs && (
              <div className={listStyles.listCard} style={{ marginBottom: '1.5rem' }}>
                <div className={listStyles.listCardBody}>
                  <h2 className={styles.panelTitle}>
                    Rider cash written off · {writeOffs.count} · {money(writeOffs.total)} standing
                  </h2>
                  <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
                    Every shortfall a rider was cleared of, from the settlements themselves — so one
                    written off while the accounts were switched off still appears. A voided write-off
                    put the money back on the rider; it is listed and left out of the total.
                  </p>
                  {writeOffs.unposted > 0 && (
                    <div className={`${styles.banner} ${styles.bannerInfo}`}>
                      <span className={styles.bannerTitle}>
                        {writeOffs.unposted} standing write-off{writeOffs.unposted === 1 ? ' is' : 's are'} not
                        in the accounts
                      </span>
                      They were made while posting of rider settlements was switched off, so no entry
                      records them. The rider balances already reflect them.
                    </div>
                  )}
                  {writeOffs.truncated && (
                    <div className={`${styles.banner} ${styles.bannerInfo}`}>
                      Only the newest 500 are shown. Narrow the dates to see the rest.
                    </div>
                  )}
                  {writeOffs.rows.length === 0 ? (
                    <p className={styles.muted}>Nothing was written off in these dates.</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className={styles.roleTable}>
                        <thead>
                          <tr>
                            <th>Written off</th>
                            <th>Rider</th>
                            <th>What</th>
                            <th style={{ textAlign: 'right' }}>Amount</th>
                            <th>By</th>
                            <th>Why</th>
                            <th>In the accounts</th>
                          </tr>
                        </thead>
                        <tbody>
                          {writeOffs.rows.map((row) => (
                            <tr key={row.settlementId}>
                              <td>{when(row.at)}</td>
                              <td>{row.rider}</td>
                              <td>{row.mode === 'cash' ? 'Cash' : 'Online'}</td>
                              <td style={{ textAlign: 'right' }}>
                                <TrailAmount
                                  value={row.amount}
                                  trail={row.entryId ? { kind: 'entry', entryId: row.entryId } : null}
                                  onOpen={openTrail}
                                  format={money}
                                  className={row.voided ? styles.muted : undefined}
                                />
                              </td>
                              <td>{row.by ?? '—'}</td>
                              <td>
                                {row.reason || '—'}
                                {row.voided && (
                                  <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                                    Voided{row.voidReason ? `: ${row.voidReason}` : ''}
                                  </div>
                                )}
                              </td>
                              <td>
                                {row.entryId ? (
                                  <TrailLink trail={{ kind: 'entry', entryId: row.entryId! }} onOpen={openTrail}>
                                    <span className={styles.code}>{row.entryNo ?? 'view'}</span>
                                  </TrailLink>
                                ) : (
                                  <span className={styles.muted}>{row.voided ? '—' : 'Not recorded'}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <TrailPanel stack={trailStack} onPush={pushTrail} onGoTo={goToTrail} onClose={closeTrail} />
    </Layout>
  );
};

export default function RegistersPageWrapper() {
  return (
    <ProtectedRoute
      allowIf={() => can(undefined, 'finance-reversal:view') || can(undefined, 'finance-writeoff:view')}
    >
      <RegistersPage />
    </ProtectedRoute>
  );
}
