import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { money } from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import {
  expenseCategoryService,
  financeService,
  ExpenseCategory,
  Ledger,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import formStyles from '../../../styles/FormPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Expense categories — which is to say, the approval policy.
 *
 * Each row says in plain words what happens to spending in that category, because the numbers
 * alone ("approval above 10,000") do not tell somebody reading the page that everything under
 * that figure reaches the accounts with nobody else looking.
 */

interface FormState {
  id?: string;
  name: string;
  ledgerId: string;
  requiresApproval: boolean;
  approvalAbove: string;
  requiresReceipt: boolean;
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  ledgerId: '',
  requiresApproval: false,
  approvalAbove: '',
  requiresReceipt: false,
  notes: '',
};

function policyWords(c: Pick<ExpenseCategory, 'requiresApproval' | 'approvalAbove'>): string {
  if (c.requiresApproval) return 'Every expense waits for approval';
  if (c.approvalAbove !== null) return `Straight through up to ${money(c.approvalAbove)}; above that, waits`;
  return 'Always straight through — nobody else looks';
}

const CategoriesPage: React.FC = () => {
  const router = useRouter();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCategories(await expenseCategoryService.list(status));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the categories');
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    financeService
      .getLedgers({ accountType: 'expense', status: 'active' })
      .then((all) => setLedgers(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  const canEdit = can(undefined, 'finance-expense-categories:edit');
  const canAdd = can(undefined, 'finance-expense-categories:add');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (form.name.trim().length < 2) {
      toast.error('Give the category a name');
      return;
    }
    if (!form.ledgerId) {
      toast.error('Choose the expense account it posts to');
      return;
    }

    const payload = {
      name: form.name.trim(),
      ledgerId: form.ledgerId,
      requiresApproval: form.requiresApproval,
      // A category that always waits has no limit to speak of; sending one would only confuse
      // whoever reads it later.
      approvalAbove: form.requiresApproval || form.approvalAbove.trim() === ''
        ? null
        : Number(form.approvalAbove),
      requiresReceipt: form.requiresReceipt,
      notes: form.notes.trim(),
    };

    setBusy(true);
    try {
      if (form.id) {
        await expenseCategoryService.update(form.id, payload);
        toast.success(`${payload.name} saved`);
      } else {
        await expenseCategoryService.create(payload);
        toast.success(`${payload.name} created`);
      }
      setForm(null);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this category');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: ExpenseCategory) => {
    if (
      c.isActive
      && !window.confirm(
        `Retire "${c.name}"?\n\nIt will no longer be offered for new spending. Expenses already `
          + 'recorded in it keep it, and any waiting for approval can still be approved.',
      )
    ) {
      return;
    }
    try {
      await expenseCategoryService.update(c.id, { isActive: !c.isActive });
      toast.success(c.isActive ? `${c.name} retired` : `${c.name} back in use`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not change this category');
    }
  };

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Expense Categories &amp; Limits</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className={listStyles.addButton}
              style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
              onClick={() => router.push('/finance/expenses')}
            >
              &larr; Expenses
            </button>
            {canAdd && (
              <button className={listStyles.addButton} onClick={() => setForm({ ...EMPTY })}>
                + New Category
              </button>
            )}
          </div>
        </div>

        <FinanceNav />

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>These settings are the approval policy</span>
          Anything a category lets straight through reaches the accounts with nobody else looking.
          Raising a limit is a decision about how much can be spent unchecked — which is why
          changing these is kept apart from approving expenses.
        </div>

        {form && (
          <form className={styles.panel} onSubmit={save}>
            <h2 className={styles.panelTitle}>{form.id ? `Edit ${form.name}` : 'New category'}</h2>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="name">Name *</label>
                <input
                  id="name"
                  className={formStyles.input}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={busy}
                />
              </div>
              <div className={formStyles.formGroup}>
                <label htmlFor="ledgerId">Posts to *</label>
                <select
                  id="ledgerId"
                  className={formStyles.select}
                  value={form.ledgerId}
                  onChange={(e) => setForm({ ...form, ledgerId: e.target.value })}
                  disabled={busy}
                >
                  <option value="">Choose an expense account…</option>
                  {ledgers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
                </select>
                {form.id && (
                  <p className={formStyles.hint}>
                    Changing this moves only future spending. Expenses already posted stay where
                    they are.
                  </p>
                )}
              </div>
            </div>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={form.requiresApproval}
                    onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })}
                    disabled={busy}
                  />
                  Every expense waits for approval
                </label>
              </div>
              <div className={formStyles.formGroup}>
                <label htmlFor="approvalAbove">Otherwise, approval above</label>
                <input
                  id="approvalAbove"
                  type="number"
                  min="0"
                  step="0.01"
                  className={formStyles.input}
                  value={form.requiresApproval ? '' : form.approvalAbove}
                  onChange={(e) => setForm({ ...form, approvalAbove: e.target.value })}
                  disabled={busy || form.requiresApproval}
                  placeholder="No limit"
                />
                <p className={formStyles.hint}>
                  Leave blank and nothing in this category ever waits.
                </p>
              </div>
              <div className={formStyles.formGroup}>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={form.requiresReceipt}
                    onChange={(e) => setForm({ ...form, requiresReceipt: e.target.checked })}
                    disabled={busy}
                  />
                  A receipt must be attached
                </label>
              </div>
            </div>

            <div className={formStyles.formGroup}>
              <label htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                className={formStyles.textarea}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                disabled={busy}
                maxLength={500}
              />
            </div>

            <p className={styles.readonlyNote}>
              In words: {policyWords({
                requiresApproval: form.requiresApproval,
                approvalAbove: form.approvalAbove.trim() === '' ? null : Number(form.approvalAbove),
              })}.
            </p>

            <div className={formStyles.formActions}>
              <button type="button" className={formStyles.cancelButton} onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={formStyles.submitButton} disabled={busy}>
                {busy ? 'Saving…' : 'Save Category'}
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
                onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'all')}
                aria-label="Status"
              >
                <option value="active">In use</option>
                <option value="inactive">Retired</option>
                <option value="all">All</option>
              </select>
            </div>

            <table className={styles.roleTable}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Posts to</th>
                  <th>What happens to spending</th>
                  <th>Receipt</th>
                  <th style={{ textAlign: 'right' }}>Expenses</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{c.name}</div>
                      {!c.isActive && <span className={styles.flag}>Retired</span>}
                      {c.notes && (
                        <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                          {c.notes}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={styles.code}>{c.ledgerCode}</span> {c.ledgerName}
                    </td>
                    <td>{policyWords(c)}</td>
                    <td>{c.requiresReceipt ? 'Required' : '—'}</td>
                    <td className={styles.amount}>{c.expenseCount || '—'}</td>
                    <td>
                      {canEdit && (
                        <div className={listStyles.actions}>
                          <button
                            className={listStyles.editButton}
                            onClick={() =>
                              setForm({
                                id: c.id,
                                name: c.name,
                                ledgerId: c.ledgerId,
                                requiresApproval: c.requiresApproval,
                                approvalAbove: c.approvalAbove === null ? '' : String(c.approvalAbove),
                                requiresReceipt: c.requiresReceipt,
                                notes: c.notes ?? '',
                              })
                            }
                          >
                            Edit
                          </button>
                          <button className={listStyles.approveButton} onClick={() => toggleActive(c)}>
                            {c.isActive ? 'Retire' : 'Use again'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.muted}>
                      No categories here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ExpenseCategoriesPageWrapper() {
  return (
    <ProtectedRoute permission="finance-expense-categories:view">
      <CategoriesPage />
    </ProtectedRoute>
  );
}
