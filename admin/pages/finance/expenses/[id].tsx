import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import ExpenseForm, {
  ExpenseFormValues,
  expenseToPayload,
} from '../../../components/Finance/ExpenseForm';
import { money } from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import {
  expenseCategoryService,
  expenseService,
  financeService,
  vendorService,
  Expense,
  ExpenseCategory,
  EXPENSE_STATUS_LABELS,
  Ledger,
  PAYMENT_METHOD_LABELS,
  Vendor,
} from '../../../services/financeService';
import { warehouseService, Warehouse } from '../../../services/warehouseService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

/**
 * One expense, through its whole life: corrected while it is a draft or has been sent back,
 * approved or sent back while it waits, and read-only once posted.
 */

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
  : '';

function expenseToForm(expense: Expense): ExpenseFormValues {
  return {
    categoryId: expense.categoryId,
    expenseDate: expense.expenseDate.slice(0, 10),
    description: expense.description,
    amount: String(expense.amount),
    taxAmount: expense.taxAmount ? String(expense.taxAmount) : '',
    method: expense.method,
    paidFromLedgerId: expense.paidFromLedgerId,
    chequeNo: expense.chequeNo ?? '',
    chequeDate: expense.chequeDate ? expense.chequeDate.slice(0, 10) : '',
    transferReference: expense.transferReference ?? '',
    payeeName: expense.payeeName ?? '',
    vendorId: expense.vendorId ?? '',
    warehouseId: expense.warehouseId ?? '',
    attachments: expense.attachments ?? [],
    notes: expense.notes ?? '',
  };
}

const ExpensePage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [expense, setExpense] = useState<Expense | null>(null);
  const [values, setValues] = useState<ExpenseFormValues | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = (next: Expense) => {
    setExpense(next);
    setValues(expenseToForm(next));
  };

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      apply(await expenseService.get(id));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this expense');
      router.push('/finance/expenses');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    expenseCategoryService.list('active').then(setCategories).catch(() => undefined);
    financeService
      .getLedgers({ isCashEquivalent: true, status: 'active' })
      .then((all) => setAccounts(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
    vendorService
      .list({ status: 'all' })
      .then((all) => setVendors(all.filter((v) => !v.isPlaceholder)))
      .catch(() => undefined);
    warehouseService.getWarehouses().then(setWarehouses).catch(() => undefined);
  }, []);

  const run = async (work: () => Promise<Expense>, success: (e: Expense) => string, failure: string) => {
    setBusy(true);
    try {
      const next = await work();
      apply(next);
      toast.success(success(next));
    } catch (error: any) {
      toast.error(error.response?.data?.message || failure);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !expense || !values || typeof id !== 'string') {
    return (
      <Layout>
        <div className={styles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  const editable = expense.status === 'draft' || expense.status === 'rejected';
  const unsaved = JSON.stringify(expenseToPayload(values))
    !== JSON.stringify(expenseToPayload(expenseToForm(expense)));

  // A retired category is not offered for new spending, but an expense already in it must still
  // show its own category in the dropdown rather than a blank.
  const categoryChoices = categories.some((c) => c.id === expense.categoryId)
    ? categories
    : [
      ...categories,
      {
        id: expense.categoryId,
        name: `${expense.categoryName} (retired)`,
        ledgerId: expense.ledgerId,
        ledgerCode: expense.ledgerCode,
        ledgerName: expense.ledgerName,
        requiresApproval: false,
        approvalAbove: null,
        requiresReceipt: expense.receiptRequired,
        isActive: false,
        expenseCount: 0,
      },
    ];

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => expenseService.update(id, expenseToPayload(values)), () => 'Expense saved', 'Could not save this expense');
  };

  const submit = () => {
    if (unsaved) {
      toast.error('Save your changes first — an expense is submitted exactly as it was last saved');
      return;
    }
    const message = expense.approvalNeeded
      ? `Submit for approval?\n\n${expense.approvalNeeded}\n\nNothing reaches the accounts until a second person approves it.`
      : `Submit and post?\n\n${expense.categoryName}: ${expense.description}\n`
        + `Paid out: ${money(expense.totalAmount)}\n`
        + `${PAYMENT_METHOD_LABELS[expense.method]} from ${expense.paidFromName}\n\n`
        + 'It posts immediately. From then on it can be cancelled, not deleted.';
    if (!window.confirm(message)) return;

    run(
      () => expenseService.submit(id),
      (next) => (next.status === 'posted' ? `${next.reference} posted` : 'Submitted — waiting for approval'),
      'Could not submit this expense',
    );
  };

  const approve = () => {
    if (
      !window.confirm(
        `Approve and post this expense?\n\n`
          + `${expense.categoryName}: ${expense.description}\n`
          + `Paid out: ${money(expense.totalAmount)}\n`
          + `${PAYMENT_METHOD_LABELS[expense.method]} from ${expense.paidFromName}\n`
          + `${expense.attachments.length ? `${expense.attachments.length} receipt(s) attached` : 'No receipt attached'}\n\n`
          + 'It posts to the accounts the moment you approve it.',
      )
    ) {
      return;
    }
    run(() => expenseService.approve(id), (next) => `${next.reference} approved and posted`, 'Could not approve this expense');
  };

  const reject = () => {
    const reason = window.prompt(
      'Send this expense back?\n\nSay what needs fixing — whoever submitted it will see this.',
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say what needs fixing');
      return;
    }
    run(() => expenseService.reject(id, reason.trim()), () => 'Sent back', 'Could not send this expense back');
  };

  const clearCheque = () => {
    const clearedOn = window.prompt(
      `Cheque ${expense.chequeNo} for ${money(expense.totalAmount)} cleared on which day?\n\n`
        + 'Use the date on the bank statement (YYYY-MM-DD).',
      new Date().toISOString().slice(0, 10),
    );
    if (clearedOn === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clearedOn.trim())) {
      toast.error('Enter the date as YYYY-MM-DD');
      return;
    }
    run(() => expenseService.clearCheque(id, clearedOn.trim()), (next) => `Cheque ${next.chequeNo} marked cleared`, 'Could not mark this cheque cleared');
  };

  const cancel = () => {
    const reason = window.prompt(
      `Cancel ${expense.reference} and reverse it out of the accounts?\n\nSay why — it stays on the record.`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say why this expense is being cancelled');
      return;
    }
    run(() => expenseService.cancel(id, reason.trim()), (next) => `${next.reference} cancelled and reversed`, 'Could not cancel this expense');
  };

  const discard = async () => {
    if (!window.confirm('Delete this expense? It has never reached the accounts.')) return;
    setBusy(true);
    try {
      await expenseService.remove(id);
      toast.success('Expense deleted');
      router.push('/finance/expenses');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this expense');
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            {expense.reference} · {expense.categoryName}
          </h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/expenses')}>
            &larr; Back
          </button>
        </div>

        {expense.status === 'draft' && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Not submitted yet</span>
            {expense.approvalNeeded
              ? `${expense.approvalNeeded} Submitting will send it for approval.`
              : 'Submitting will post it straight away.'}
          </div>
        )}

        {expense.status === 'rejected' && (
          <div className={`${finance.banner} ${finance.bannerBad}`}>
            <span className={finance.bannerTitle}>Sent back</span>
            {expense.rejectionReason}
            <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
              Correct it and submit it again, or delete it if it should not have been recorded.
            </p>
          </div>
        )}

        {expense.status === 'pending_approval' && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Waiting for approval</span>
            {expense.approvalNeeded} Nothing has reached the accounts.
            {expense.rejectionReason && (
              <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
                Sent back once before: {expense.rejectionReason}
              </p>
            )}
          </div>
        )}

        {expense.status === 'posted' && (
          <div className={`${finance.banner} ${expense.isChequeUncleared ? finance.bannerInfo : finance.bannerOk}`}>
            <span className={finance.bannerTitle}>
              {expense.isChequeUncleared ? 'Posted — cheque not yet cleared' : 'Posted'}
            </span>
            {money(expense.totalAmount)} spent
            {expense.approvedAt ? ', approved by a second person' : ''}.{' '}
            {expense.journalEntryId && (
              <a href={`/finance/journal/${expense.journalEntryId}`}>See the entry it wrote</a>
            )}
            {expense.chequeClearedAt && (
              <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
                Cheque cleared on {new Date(expense.chequeClearedAt).toLocaleDateString('en-PK')}.
              </p>
            )}
          </div>
        )}

        {expense.status === 'cancelled' && (
          <div className={`${finance.banner} ${finance.bannerBad}`}>
            <span className={finance.bannerTitle}>Cancelled</span>
            {expense.cancelReason || 'No reason was recorded.'}
          </div>
        )}

        {editable ? (
          <form className={styles.form} onSubmit={save}>
            <ExpenseForm
              values={values}
              onChange={setValues}
              categories={categoryChoices}
              accounts={accounts}
              vendors={vendors}
              warehouses={warehouses}
              disabled={busy}
            />

            <div className={styles.formActions}>
              {can(undefined, 'finance-expenses:delete') && (
                <button type="button" className={styles.cancelButton} onClick={discard} disabled={busy}>
                  Delete
                </button>
              )}
              {can(undefined, 'finance-expenses:edit') && (
                <button type="submit" className={styles.cancelButton} disabled={busy}>
                  Save
                </button>
              )}
              {can(undefined, 'finance-expenses:add') && (
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={submit}
                  disabled={busy || unsaved}
                  title={unsaved ? 'Save your changes before submitting' : undefined}
                >
                  {expense.approvalNeeded ? 'Submit for Approval' : 'Submit & Post'} · {money(expense.totalAmount)}
                </button>
              )}
            </div>
          </form>
        ) : (
          <ReadOnlyExpense expense={expense} />
        )}

        {expense.status === 'pending_approval' && can(undefined, 'finance-expenses:change') && (
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={reject} disabled={busy}>
              Send Back
            </button>
            <button type="button" className={styles.submitButton} onClick={approve} disabled={busy}>
              Approve &amp; Post · {money(expense.totalAmount)}
            </button>
          </div>
        )}

        {expense.status === 'posted' && (
          <div className={styles.formActions}>
            {can(undefined, 'finance-reversal:change') && !expense.chequeClearedAt && (
              <button
                type="button"
                className={styles.cancelButton}
                onClick={cancel}
                disabled={busy}
                style={{ color: '#b91c1c' }}
              >
                Cancel &amp; Reverse
              </button>
            )}
            {expense.isChequeUncleared && can(undefined, 'finance-expenses:change') && (
              <button type="button" className={styles.submitButton} onClick={clearCheque} disabled={busy}>
                Mark Cheque Cleared
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

const ReadOnlyExpense: React.FC<{ expense: Expense }> = ({ expense }) => (
  <>
    <div className={finance.settingsGrid}>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Date</span>
        <span className={finance.settingValue}>
          {new Date(expense.expenseDate).toLocaleDateString('en-PK')}
        </span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Posts to</span>
        <span className={finance.settingValue}>
          {expense.ledgerCode} · {expense.ledgerName}
        </span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Paid by</span>
        <span className={finance.settingValue}>
          {expense.method === 'cheque' ? `Cheque ${expense.chequeNo}` : PAYMENT_METHOD_LABELS[expense.method]}
          {' · '}
          {expense.paidFromName}
        </span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Status</span>
        <span className={finance.settingValue}>{EXPENSE_STATUS_LABELS[expense.status]}</span>
      </div>
    </div>

    <div className={finance.panel}>
      <h2 className={finance.panelTitle}>{expense.description}</h2>
      <p className={finance.readonlyNote} style={{ margin: 0 }}>
        {expense.vendorName || expense.payeeName ? `Paid to ${expense.vendorName || expense.payeeName}. ` : ''}
        {expense.warehouseName ? `For ${expense.warehouseName}. ` : ''}
        {expense.transferReference ? `Reference ${expense.transferReference}.` : ''}
      </p>
      {expense.attachments.length > 0 ? (
        <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.2rem' }}>
          {expense.attachments.map((url, i) => (
            <li key={url}>
              <a href={`${API_BASE}${url}`} target="_blank" rel="noreferrer">
                Receipt {i + 1}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className={finance.readonlyNote} style={{ margin: '0.75rem 0 0' }}>
          No receipt attached.
        </p>
      )}
    </div>

    <div className={finance.totalsBar}>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Expense</span>
        <span className={finance.totalsValue}>{money(expense.amount)}</span>
      </div>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Tax</span>
        <span className={finance.totalsValue}>{money(expense.taxAmount)}</span>
      </div>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Paid out</span>
        <span className={finance.totalsValue}>{money(expense.totalAmount)}</span>
      </div>
    </div>

    {expense.notes && <p className={finance.readonlyNote}>{expense.notes}</p>}
  </>
);

export default function ExpensePageWrapper() {
  return (
    <ProtectedRoute permission="finance-expenses:view">
      <ExpensePage />
    </ProtectedRoute>
  );
}
