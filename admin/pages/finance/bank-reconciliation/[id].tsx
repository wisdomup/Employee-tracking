import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  bankReconciliationService,
  BankReconciliationDetail,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import formStyles from '../../../styles/FormPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * The worksheet: every line on the account, waiting to be ticked off against the statement.
 *
 * The arithmetic sits at the top and is spelled out in words rather than left as four numbers to
 * be interpreted, because the whole job is understanding one figure — the difference — and what
 * would close it.
 *
 * Sign-off is disabled until that difference is nil. The server refuses it anyway; the button
 * being dead is so nobody spends ten minutes believing they are nearly finished.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function day(value: string): string {
  return new Date(value).toLocaleDateString('en-PK');
}

const WorksheetPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [rec, setRec] = useState<BankReconciliationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statementBalance, setStatementBalance] = useState('');

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const detail = await bankReconciliationService.get(id);
      setRec(detail);
      setStatementBalance(String(detail.statementClosingBalance));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this reconciliation');
      router.push('/finance/bank-reconciliation');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const editable = rec?.status === 'draft' && can(undefined, 'finance-bank-rec:edit');

  const setLines = async (lineIds: string[], cleared: boolean) => {
    if (typeof id !== 'string' || lineIds.length === 0) return;
    setBusy(true);
    try {
      setRec(await bankReconciliationService.setLines(id, lineIds, cleared));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not update the worksheet');
      load();
    } finally {
      setBusy(false);
    }
  };

  const saveStatementBalance = async () => {
    if (typeof id !== 'string') return;
    setBusy(true);
    try {
      setRec(
        await bankReconciliationService.update(id, {
          statementClosingBalance: Number(statementBalance),
        }),
      );
      toast.success('Statement balance updated');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not update the statement balance');
    } finally {
      setBusy(false);
    }
  };

  const signOff = async () => {
    if (typeof id !== 'string' || !rec) return;
    if (
      !window.confirm(
        `Sign off ${rec.ledgerName} as at ${day(rec.statementDate)}?\n\n`
          + `This records that the bank agreed. ${money(Math.abs(rec.unclearedTotal))} is carried `
          + 'forward as still in flight.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      setRec(await bankReconciliationService.complete(id));
      toast.success('Reconciliation signed off');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not sign this off');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (typeof id !== 'string') return;
    const reason = window.prompt('Why is this being reopened?');
    if (!reason?.trim()) return;

    setBusy(true);
    try {
      setRec(await bankReconciliationService.reopen(id, reason.trim()));
      toast.success('Reopened');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not reopen this');
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (typeof id !== 'string') return;
    if (!window.confirm('Discard this reconciliation? Nothing it recorded is kept.')) return;

    try {
      await bankReconciliationService.remove(id);
      toast.success('Discarded');
      router.push('/finance/bank-reconciliation');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not discard this');
    }
  };

  if (loading || !rec) {
    return (
      <Layout>
        <div className={listStyles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  const untickedIds = rec.lines.filter((l) => !l.cleared).map((l) => l.lineId);
  const tickedIds = rec.lines.filter((l) => l.cleared).map((l) => l.lineId);

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>
            {rec.ledgerName} — {day(rec.statementDate)}
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className={formStyles.cancelButton}
              onClick={() => router.push('/finance/bank-reconciliation')}
            >
              Back
            </button>
            {rec.status === 'completed' && can(undefined, 'finance-reversal:change') && (
              <button className={listStyles.deleteButton} disabled={busy} onClick={reopen}>
                Reopen
              </button>
            )}
            {rec.status === 'draft' && can(undefined, 'finance-bank-rec:delete') && (
              <button className={listStyles.deleteButton} onClick={discard}>
                Discard
              </button>
            )}
            {rec.status === 'draft' && can(undefined, 'finance-bank-rec:change') && (
              <button
                className={formStyles.submitButton}
                disabled={busy || !rec.balances}
                title={
                  rec.balances
                    ? undefined
                    : 'This cannot be signed off until the difference is nil.'
                }
                onClick={signOff}
              >
                Sign off
              </button>
            )}
          </div>
        </div>

        <FinanceNav />

        {rec.status === 'completed' && (
          <div className={`${styles.banner} ${styles.bannerOk}`}>
            <span className={styles.bannerTitle}>Signed off</span>
            The bank agreed on {day(rec.statementDate)}. These figures are frozen as they stood at
            that moment — they will not move if something is later back-dated into the period.
            {rec.reopenReason && ` Previously reopened: ${rec.reopenReason}`}
          </div>
        )}

        {rec.truncated && (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <span className={styles.bannerTitle}>Too many lines to show</span>
            This account has more movements before this date than one worksheet can carry.
            Reconcile an earlier statement first so the older ones stop being offered here.
          </div>
        )}

        {/* The arithmetic, spelled out. The whole job is understanding one figure. */}
        <div className={styles.totalsBar}>
          <div className={styles.totalsItem}>
            <span className={styles.totalsLabel}>Our books say</span>
            <span className={styles.totalsValue}>{money(rec.bookBalance)}</span>
          </div>
          <div className={styles.totalsItem}>
            <span className={styles.totalsLabel}>Not yet at the bank</span>
            <span className={styles.totalsValue}>{money(rec.unclearedTotal)}</span>
          </div>
          <div className={styles.totalsItem}>
            <span className={styles.totalsLabel}>So the bank should show</span>
            <span className={styles.totalsValue}>{money(rec.expectedStatementBalance)}</span>
          </div>
          <div className={styles.totalsItem}>
            <span className={styles.totalsLabel}>The bank actually shows</span>
            <span className={styles.totalsValue}>{money(rec.statementClosingBalance)}</span>
          </div>
          <div className={styles.totalsItem}>
            <span className={styles.totalsLabel}>Difference</span>
            <span
              className={`${styles.totalsValue} ${
                rec.balances ? styles.totalsBalanced : styles.totalsUnbalanced
              }`}
            >
              {money(rec.difference)}
            </span>
          </div>
          <div className={styles.totalsVerdict}>
            {rec.balances
              ? 'Everything is accounted for.'
              : rec.difference > 0
                ? 'The bank has money the books do not. Something on the statement has not been recorded yet.'
                : 'The books have money the bank does not. Either tick more lines, or something was recorded that never reached the bank.'}
          </div>
        </div>

        {editable && (
          <div className={styles.panel}>
            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="statementBalance">Closing balance the bank shows</label>
                <input
                  id="statementBalance"
                  type="number"
                  step="0.01"
                  className={formStyles.input}
                  value={statementBalance}
                  disabled={busy}
                  onChange={(e) => setStatementBalance(e.target.value)}
                />
                <p className={formStyles.hint}>Correct it here if it was typed in wrongly.</p>
              </div>
              <div className={formStyles.formGroup} style={{ justifyContent: 'flex-end' }}>
                <button
                  className={formStyles.cancelButton}
                  disabled={busy || Number(statementBalance) === rec.statementClosingBalance}
                  onClick={saveStatementBalance}
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                flexWrap: 'wrap',
                marginBottom: '0.75rem',
              }}
            >
              <h2 className={styles.panelTitle} style={{ margin: 0 }}>
                {rec.clearedCount} ticked, {rec.unclearedCount} still in flight
              </h2>
              {editable && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className={formStyles.cancelButton}
                    disabled={busy || untickedIds.length === 0}
                    onClick={() => setLines(untickedIds, true)}
                  >
                    Tick all
                  </button>
                  <button
                    className={formStyles.cancelButton}
                    disabled={busy || tickedIds.length === 0}
                    onClick={() => setLines(tickedIds, false)}
                  >
                    Untick all
                  </button>
                </div>
              )}
            </div>

            <p className={styles.readonlyNote}>
              Tick a line when it appears on the statement. Anything left unticked is treated as
              still in flight — money recorded here that the bank has not seen yet.
            </p>

            {rec.lines.length === 0 ? (
              <p className={styles.muted}>
                Nothing on this account up to {day(rec.statementDate)} that an earlier statement
                has not already accounted for.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.roleTable}>
                  <thead>
                    <tr>
                      <th style={{ width: '3rem' }}>On it</th>
                      <th>Date</th>
                      <th>Entry</th>
                      <th>What it was</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.lines.map((line) => (
                      <tr key={line.lineId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={line.cleared}
                            disabled={!editable || busy}
                            aria-label={`${line.narration} on the statement`}
                            onChange={(e) => setLines([line.lineId], e.target.checked)}
                          />
                        </td>
                        <td>{day(line.date)}</td>
                        <td>
                          <span className={styles.code}>
                            {line.entryNo ? `#${line.entryNo}` : '—'}
                          </span>
                        </td>
                        <td>
                          {line.narration || <span className={styles.muted}>No description</span>}
                          {line.referenceNo && (
                            <span className={styles.muted}> · {line.referenceNo}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span
                            className={`${styles.amount} ${
                              line.effect < 0 ? styles.amountNegative : ''
                            }`}
                          >
                            {money(line.effect)}
                          </span>
                        </td>
                      </tr>
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

export default function WorksheetPageWrapper() {
  return (
    <ProtectedRoute permission="finance-bank-rec:view">
      <WorksheetPage />
    </ProtectedRoute>
  );
}
