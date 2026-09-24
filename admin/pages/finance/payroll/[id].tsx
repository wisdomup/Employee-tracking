import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { money } from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import {
  financeService,
  payrollService,
  Ledger,
  PayrollLineInput,
  PayrollRunDetail,
} from '../../../services/financeService';
import formStyles from '../../../styles/FormPage.module.scss';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';
import PostedEntries from '../../../components/Finance/PostedEntries';

/**
 * One month's payroll.
 *
 * While it is being prepared every figure is editable, with what each person still owes in advances
 * shown beside the recovery box — the cap is enforced by the server, but somebody typing should be
 * able to see it before they are refused.
 *
 * Once posted the run is read-only and the screen becomes about paying it, which happens in
 * whatever instalments the money actually leaves in.
 */

type Edits = Record<
  string,
  { salary: string; bonus: string; allowance: string; advanceRecovery: string; fineRecovery: string }
>;

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function editsFrom(run: PayrollRunDetail): Edits {
  return Object.fromEntries(
    run.lines.map((l) => [
      l.userId,
      {
        salary: String(l.salary),
        bonus: String(l.bonus),
        allowance: String(l.allowance),
        advanceRecovery: String(l.advanceRecovery),
        fineRecovery: String(l.fineRecovery),
      },
    ]),
  );
}

const PayrollRunPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [run, setRun] = useState<PayrollRunDetail | null>(null);
  const [edits, setEdits] = useState<Edits>({});
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Paying the month.
  const [payOn, setPayOn] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank_transfer'>('cash');
  const [payFrom, setPayFrom] = useState('');
  const [payReference, setPayReference] = useState('');

  const apply = (next: PayrollRunDetail) => {
    setRun(next);
    setEdits(editsFrom(next));
    setPayAmount(next.outstanding > 0.005 ? String(next.outstanding) : '');
  };

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      apply(await payrollService.getRun(id));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this payroll run');
      router.push('/finance/payroll');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    financeService
      .getLedgers({ isCashEquivalent: true, status: 'active' })
      .then((all) => setAccounts(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  if (loading || !run || typeof id !== 'string') {
    return (
      <Layout>
        <div className={formStyles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  const isDraft = run.status === 'draft';

  // Recomputed as you type, so the totals at the bottom are the ones you are about to post.
  const live = run.lines.map((l) => {
    const e = edits[l.userId]
      ?? { salary: '0', bonus: '0', allowance: '0', advanceRecovery: '0', fineRecovery: '0' };
    const gross = num(e.salary) + num(e.bonus) + num(e.allowance);
    return {
      ...l,
      ...e,
      grossLive: gross,
      netLive: gross - num(e.advanceRecovery) - num(e.fineRecovery),
    };
  });
  const totals = live.reduce(
    (acc, l) => ({
      gross: acc.gross + l.grossLive,
      recovery: acc.recovery + num(l.advanceRecovery),
      fines: acc.fines + num(l.fineRecovery),
      net: acc.net + l.netLive,
    }),
    { gross: 0, recovery: 0, fines: 0, net: 0 },
  );

  const perform = async (work: () => Promise<PayrollRunDetail>, success: string, failure: string) => {
    setBusy(true);
    try {
      apply(await work());
      toast.success(success);
    } catch (error: any) {
      toast.error(error.response?.data?.message || failure);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const lines: PayrollLineInput[] = run.lines.map((l) => ({
      userId: l.userId,
      salary: num(edits[l.userId].salary),
      bonus: num(edits[l.userId].bonus),
      allowance: num(edits[l.userId].allowance),
      advanceRecovery: num(edits[l.userId].advanceRecovery),
      fineRecovery: num(edits[l.userId].fineRecovery),
    }));
    perform(() => payrollService.updateRun(id, { lines }), 'Payroll saved', 'Could not save this payroll run');
  };

  const post = () => {
    if (
      !window.confirm(
        `Post ${run.periodLabel}?\n\n`
          + `${run.employeeCount} people\n`
          + `Wage bill: ${money(run.totals.gross)}\n`
          + `Advances recovered: ${money(run.totals.advanceRecovery)}\n`
          + `Late-start fines recovered: ${money(run.totals.fineRecovery)}\n`

          + `To be paid to staff: ${money(run.totals.net)}\n\n`
          + 'This records what is owed. It pays nobody — payments are recorded afterwards.',
      )
    ) {
      return;
    }
    perform(() => payrollService.postRun(id), `${run.periodLabel} posted`, 'Could not post this payroll run');
  };

  const pay = () => {
    const amount = num(payAmount);
    if (amount <= 0) {
      toast.error('Enter how much was paid');
      return;
    }
    if (!payFrom) {
      toast.error('Choose the account the wages came out of');
      return;
    }
    perform(
      () =>
        payrollService.payRun(id, {
          paidOn: payOn,
          amount,
          method: payMethod,
          paidFromLedgerId: payFrom,
          reference: payReference.trim() || undefined,
        }),
      `${money(amount)} recorded as paid`,
      'Could not record this payment',
    );
  };

  const cancel = () => {
    const reason = window.prompt(
      `Cancel ${run.periodLabel} and reverse the wage bill?\n\nSay why — it stays on the record.`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say why it is being cancelled');
      return;
    }
    perform(
      () => payrollService.cancelRun(id, reason.trim()),
      `${run.periodLabel} cancelled and reversed`,
      'Could not cancel this payroll run',
    );
  };

  const discard = async () => {
    if (!window.confirm('Delete this month? It has never reached the accounts.')) return;
    setBusy(true);
    try {
      await payrollService.removeRun(id);
      toast.success('Payroll run deleted');
      router.push('/finance/payroll');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this payroll run');
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className={formStyles.container}>
        <div className={formStyles.header}>
          <h1>Payroll · {run.periodLabel}</h1>
          <button className={formStyles.backButton} onClick={() => router.push('/finance/payroll')}>
            &larr; Back
          </button>
        </div>

        <FinanceNav />

        {isDraft && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>Being prepared</span>
            Correct anybody&apos;s figures, and say how much of each advance comes back this month.
            Nothing is owed to staff in the books until this is posted.
          </div>
        )}

        {run.status === 'posted' && (
          <div
            className={`${styles.banner} ${run.outstanding > 0.005 ? styles.bannerBad : styles.bannerOk}`}
          >
            <span className={styles.bannerTitle}>
              {run.outstanding > 0.005
                ? `${money(run.outstanding)} of these wages is still to pay`
                : 'Posted and paid in full'}
            </span>
            {money(run.totals.net)} was owed to {run.employeeCount} people for {run.periodLabel}.{' '}
            {run.accrualEntryId && (
              <Link href={`/finance/journal/${run.accrualEntryId}`}>See the entry it wrote</Link>
            )}
          </div>
        )}

        {run.status === 'cancelled' && (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <span className={styles.bannerTitle}>Cancelled</span>
            {run.cancelReason || 'No reason was recorded.'} The wage bill has been reversed.
          </div>
        )}

        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Who is paid what</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.roleTable}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ textAlign: 'right' }}>Salary</th>
                  <th style={{ textAlign: 'right' }}>Bonus</th>
                  <th style={{ textAlign: 'right' }}>Allowance</th>
                  <th style={{ textAlign: 'right' }}>Advance back</th>
                  <th style={{ textAlign: 'right' }}>Fines back</th>
                  <th style={{ textAlign: 'right' }}>Takes home</th>
                </tr>
              </thead>
              <tbody>
                {live.map((l) => (
                  <tr key={l.userId}>
                    <td>
                      {l.name}
                      {l.advanceBalance > 0.005 && (
                        <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                          owes {money(l.advanceBalance)} in advances
                        </div>
                      )}
                      {l.fineBalance > 0.005 && (
                        <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                          owes {money(l.fineBalance)} in late-start fines
                        </div>
                      )}
                    </td>
                    {(['salary', 'bonus', 'allowance', 'advanceRecovery', 'fineRecovery'] as const).map((field) => (
                      <td key={field} style={{ textAlign: 'right', width: '8rem' }}>
                        {isDraft && can(undefined, 'finance-payroll:edit') ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className={formStyles.input}
                            value={edits[l.userId][field]}
                            disabled={busy}
                            onChange={(e) =>
                              setEdits({
                                ...edits,
                                [l.userId]: { ...edits[l.userId], [field]: e.target.value },
                              })
                            }
                          />
                        ) : (
                          <span className={styles.amount}>{money(num(edits[l.userId][field]))}</span>
                        )}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right' }}>
                      <span className={styles.amount} style={{ fontWeight: 600 }}>
                        {money(l.netLive)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={styles.reportTotals}>
                  <td>Total</td>
                  <td colSpan={3} style={{ textAlign: 'right' }}>
                    <span className={styles.amount}>{money(totals.gross)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={styles.amount}>{money(totals.recovery)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={styles.amount}>{money(totals.fines)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={styles.amount}>{money(totals.net)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {isDraft && (
            <div className={formStyles.formActions}>
              {can(undefined, 'finance-payroll:delete') && (
                <button type="button" className={formStyles.cancelButton} onClick={discard} disabled={busy}>
                  Delete
                </button>
              )}
              {can(undefined, 'finance-payroll:edit') && (
                <button type="button" className={formStyles.cancelButton} onClick={save} disabled={busy}>
                  Save
                </button>
              )}
              {can(undefined, 'finance-payroll:change') && (
                <button type="button" className={formStyles.submitButton} onClick={post} disabled={busy}>
                  {busy ? 'Working…' : `Post ${run.periodLabel} · ${money(run.totals.net)}`}
                </button>
              )}
            </div>
          )}
        </div>

        {run.status === 'posted' && (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Wages paid</h2>
            {run.payments.length === 0 ? (
              <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
                Nothing has been handed over yet.
              </p>
            ) : (
              <table className={styles.roleTable}>
                <thead>
                  <tr>
                    <th>Paid on</th>
                    <th>How</th>
                    <th>Reference</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {run.payments.map((p) => (
                    <tr key={p.journalEntryId}>
                      <td>{new Date(p.paidOn).toLocaleDateString('en-PK')}</td>
                      <td>{p.method === 'cash' ? 'Cash' : 'Bank transfer'}</td>
                      <td className={styles.muted}>{p.reference || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={styles.amount}>{money(p.amount)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {run.outstanding > 0.005 && can(undefined, 'finance-payroll:change') && (
              <>
                <p className={styles.readonlyNote}>
                  Record what actually went out, when it went out. {money(run.outstanding)} is left.
                </p>
                <div className={styles.filterRow}>
                  <input
                    type="date"
                    className={listStyles.searchSelect}
                    value={payOn}
                    onChange={(e) => setPayOn(e.target.value)}
                    aria-label="Paid on"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={listStyles.searchInput}
                    style={{ maxWidth: '10rem' }}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    aria-label="Amount"
                  />
                  <select
                    className={listStyles.searchSelect}
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as 'cash' | 'bank_transfer')}
                    aria-label="How"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                  <select
                    className={listStyles.searchSelect}
                    value={payFrom}
                    onChange={(e) => setPayFrom(e.target.value)}
                    aria-label="Paid from"
                  >
                    <option value="">Paid from…</option>
                    {accounts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} · {l.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className={listStyles.searchInput}
                    style={{ maxWidth: '12rem' }}
                    placeholder="Reference"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                  />
                  <button
                    type="button"
                    className={formStyles.submitButton}
                    onClick={pay}
                    disabled={busy}
                  >
                    Record Payment
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {run.status === 'posted'
          && run.payments.length === 0
          && can(undefined, 'finance-reversal:change') && (
          <div className={formStyles.formActions}>
            <button
              type="button"
              className={formStyles.cancelButton}
              onClick={cancel}
              disabled={busy}
              style={{ color: '#b91c1c' }}
            >
              Cancel &amp; Reverse This Month
            </button>
          </div>
        )}

        {run.status === 'posted' && run.payments.length > 0 && (
          <p className={styles.readonlyNote}>
            This month cannot be cancelled now that wages have been paid against it — those payments
            would be left against a month nobody was owed for.
          </p>
        )}
      </div>

      {/* Renders nothing until this document has actually posted something, so it does not
          sit empty while automatic posting is still being switched on event by event. */}
      {typeof id === 'string' && (
        <PostedEntries sourceId={id} title="What this payroll run did to the accounts" />
      )}
    </Layout>
  );
};

export default function PayrollRunPageWrapper() {
  return (
    <ProtectedRoute permission="finance-payroll:view">
      <PayrollRunPage />
    </ProtectedRoute>
  );
}
