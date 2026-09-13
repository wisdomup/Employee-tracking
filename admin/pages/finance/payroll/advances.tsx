import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { money } from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import {
  financeService,
  payrollService,
  Ledger,
  StaffAdvance,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import formStyles from '../../../styles/FormPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Advances to staff.
 *
 * An advance is money the employee owes back, not a cost, so the screen leads with what each person
 * still owes rather than with a list of documents — that balance is what the next payroll run takes
 * from, and it is the figure somebody is actually asking about.
 */

interface FormState {
  userId: string;
  advanceDate: string;
  amount: string;
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: string;
  reference: string;
  reason: string;
}

const EMPTY: FormState = {
  userId: '',
  advanceDate: new Date().toISOString().slice(0, 10),
  amount: '',
  method: 'cash',
  paidFromLedgerId: '',
  reference: '',
  reason: '',
};

const AdvancesPage: React.FC = () => {
  const router = useRouter();
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [balances, setBalances] = useState<{ userId: string; name: string; owed: number }[]>([]);
  const [employees, setEmployees] = useState<
    { id: string; name: string; role?: string; salary: number; owed: number }[]
  >([]);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [status, setStatus] = useState('all');
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, owed] = await Promise.all([
        payrollService.listAdvances({ status: status === 'all' ? undefined : status }),
        payrollService.advanceBalances().catch(() => []),
      ]);
      setAdvances(list);
      setBalances(owed);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the advances');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    payrollService.employees().then(setEmployees).catch(() => undefined);
    financeService
      .getLedgers({ isCashEquivalent: true, status: 'active' })
      .then((all) => setAccounts(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  const act = async (work: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(success);
      await load();
      payrollService.employees().then(setEmployees).catch(() => undefined);
    } catch (error: any) {
      toast.error(error.response?.data?.message || failure);
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.userId) {
      toast.error('Choose who the advance is for');
      return;
    }
    if (Number(form.amount) <= 0) {
      toast.error('Enter how much is being advanced');
      return;
    }
    if (!form.paidFromLedgerId) {
      toast.error('Choose the account the money comes out of');
      return;
    }

    await act(
      () =>
        payrollService.createAdvance({
          userId: form.userId,
          advanceDate: form.advanceDate,
          amount: Number(form.amount),
          method: form.method,
          paidFromLedgerId: form.paidFromLedgerId,
          reference: form.reference.trim() || undefined,
          reason: form.reason.trim() || undefined,
        }),
      'Advance prepared — release it when the money is handed over',
      'Could not prepare this advance',
    );
    setForm(null);
  };

  const release = (advance: StaffAdvance) => {
    const employee = employees.find((e) => e.id === advance.userId);
    if (
      !window.confirm(
        `Hand over ${money(advance.amount)} to ${advance.name}?\n\n`
          + `${advance.method === 'cash' ? 'In cash' : 'By bank transfer'}\n`
          + `${employee && employee.owed > 0.005 ? `They already owe ${money(employee.owed)}\n` : ''}`
          + '\nIt is recorded as money they owe back, and comes off their pay when a month is run.',
      )
    ) {
      return;
    }
    act(
      () => payrollService.postAdvance(advance.id),
      `Advance to ${advance.name} recorded`,
      'Could not record this advance',
    );
  };

  const cancel = (advance: StaffAdvance) => {
    const reason = window.prompt(
      `Cancel ${advance.reference} and reverse it?\n\nSay why — it stays on the record.`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say why it is being cancelled');
      return;
    }
    act(
      () => payrollService.cancelAdvance(advance.id, reason.trim()),
      `${advance.reference} cancelled and reversed`,
      'Could not cancel this advance',
    );
  };

  const discard = (advance: StaffAdvance) => {
    if (!window.confirm('Delete this advance? It has never reached the accounts.')) return;
    act(() => payrollService.removeAdvance(advance.id), 'Advance deleted', 'Could not delete this advance');
  };

  const totalOwed = balances.reduce((s, b) => s + b.owed, 0);

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Staff Advances</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className={listStyles.addButton}
              style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
              onClick={() => router.push('/finance/payroll')}
            >
              &larr; Payroll
            </button>
            {can(undefined, 'finance-payroll:add') && (
              <button className={listStyles.addButton} onClick={() => setForm({ ...EMPTY })}>
                + New Advance
              </button>
            )}
          </div>
        </div>

        <FinanceNav />

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>An advance is a debt, not a cost</span>
          It is recorded as money the employee owes back, and becomes wages only when a payroll run
          takes it off their pay. Nothing appears in the wage bill on the day it is handed over.
        </div>

        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>Who owes what</h2>
          {balances.length === 0 ? (
            <p className={styles.readonlyNote} style={{ margin: 0 }}>
              Nobody owes an advance at the moment.
            </p>
          ) : (
            <table className={styles.roleTable}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ textAlign: 'right' }}>Still owes</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.userId}>
                    <td>{b.name}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={styles.amount}>{money(b.owed)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={styles.reportTotals}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={styles.amount}>{money(totalOwed)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {form && (
          <form className={styles.panel} onSubmit={save}>
            <h2 className={styles.panelTitle}>New advance</h2>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="userId">Who it is for *</label>
                <select
                  id="userId"
                  className={formStyles.select}
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value })}
                  disabled={busy}
                >
                  <option value="">Choose an employee…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.owed > 0.005 ? ` — already owes ${money(e.owed)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className={formStyles.formGroup}>
                <label htmlFor="advanceDate">Date *</label>
                <input
                  id="advanceDate"
                  type="date"
                  className={formStyles.input}
                  value={form.advanceDate}
                  onChange={(e) => setForm({ ...form, advanceDate: e.target.value })}
                  disabled={busy}
                />
              </div>
              <div className={formStyles.formGroup}>
                <label htmlFor="amount">Amount *</label>
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  className={formStyles.input}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  disabled={busy}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="method">How *</label>
                <select
                  id="method"
                  className={formStyles.select}
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value as FormState['method'] })}
                  disabled={busy}
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </div>
              <div className={formStyles.formGroup}>
                <label htmlFor="paidFromLedgerId">Paid from *</label>
                <select
                  id="paidFromLedgerId"
                  className={formStyles.select}
                  value={form.paidFromLedgerId}
                  onChange={(e) => setForm({ ...form, paidFromLedgerId: e.target.value })}
                  disabled={busy}
                >
                  <option value="">Choose an account…</option>
                  {accounts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={formStyles.formGroup}>
                <label htmlFor="reference">Reference</label>
                <input
                  id="reference"
                  type="text"
                  className={formStyles.input}
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  disabled={busy}
                />
              </div>
            </div>

            <div className={formStyles.formGroup}>
              <label htmlFor="reason">What it is for</label>
              <input
                id="reason"
                type="text"
                className={formStyles.input}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                disabled={busy}
                placeholder="e.g. School fees"
              />
            </div>

            <div className={formStyles.formActions}>
              <button
                type="button"
                className={formStyles.cancelButton}
                onClick={() => setForm(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className={formStyles.submitButton} disabled={busy}>
                {busy ? 'Saving…' : 'Prepare Advance'}
              </button>
            </div>
          </form>
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
                <option value="all">Every advance</option>
                <option value="draft">Not handed over yet</option>
                <option value="posted">Handed over</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {loading ? (
              <p className={styles.muted}>Loading…</p>
            ) : (
              <table className={styles.roleTable}>
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>What for</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {advances.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className={styles.code}>{a.reference}</span>
                      </td>
                      <td>
                        {a.name}
                        {a.employeeBalance > 0.005 && (
                          <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                            owes {money(a.employeeBalance)} in total
                          </div>
                        )}
                      </td>
                      <td>{new Date(a.advanceDate).toLocaleDateString('en-PK')}</td>
                      <td className={styles.muted}>{a.reason || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={styles.amount}>{money(a.amount)}</span>
                        <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                          {a.method === 'cash' ? 'Cash' : 'Bank transfer'}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`${styles.status} ${
                            a.status === 'posted'
                              ? styles.status_posted
                              : a.status === 'cancelled'
                                ? styles.status_void
                                : styles.status_draft
                          }`}
                        >
                          {a.status === 'posted'
                            ? 'Handed over'
                            : a.status === 'cancelled'
                              ? 'Cancelled'
                              : 'Prepared'}
                        </span>
                      </td>
                      <td>
                        <div className={listStyles.actions}>
                          {a.status === 'draft' && can(undefined, 'finance-payroll:change') && (
                            <button
                              className={listStyles.approveButton}
                              disabled={busy}
                              onClick={() => release(a)}
                            >
                              Hand Over
                            </button>
                          )}
                          {a.status === 'draft' && can(undefined, 'finance-payroll:delete') && (
                            <button
                              className={listStyles.deleteButton}
                              disabled={busy}
                              onClick={() => discard(a)}
                            >
                              Delete
                            </button>
                          )}
                          {a.status === 'posted' && can(undefined, 'finance-reversal:change') && (
                            <button
                              className={listStyles.deleteButton}
                              disabled={busy}
                              onClick={() => cancel(a)}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {advances.length === 0 && (
                    <tr>
                      <td colSpan={7} className={styles.muted}>
                        No advances here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function AdvancesPageWrapper() {
  return (
    <ProtectedRoute permission="finance-payroll:view">
      <AdvancesPage />
    </ProtectedRoute>
  );
}
