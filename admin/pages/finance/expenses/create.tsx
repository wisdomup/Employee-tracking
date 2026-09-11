import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import ExpenseForm, {
  approvalPreview,
  EMPTY_EXPENSE_FORM,
  ExpenseFormValues,
  expenseToPayload,
  expenseTotals,
} from '../../../components/Finance/ExpenseForm';
import { money } from '../../../components/Finance/BillForm';
import {
  expenseCategoryService,
  expenseService,
  financeService,
  vendorService,
  ExpenseCategory,
  Ledger,
  Vendor,
} from '../../../services/financeService';
import { warehouseService, Warehouse } from '../../../services/warehouseService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

const CreateExpensePage: React.FC = () => {
  const router = useRouter();
  const [values, setValues] = useState<ExpenseFormValues>(EMPTY_EXPENSE_FORM);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    expenseCategoryService.list('active').then(setCategories).catch(() => undefined);
    financeService
      .getLedgers({ isCashEquivalent: true, status: 'active' })
      .then((all) => setAccounts(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
    vendorService
      .list({ status: 'active' })
      .then((all) => setVendors(all.filter((v) => !v.isPlaceholder)))
      .catch(() => undefined);
    warehouseService
      .getWarehouses({ isActive: true })
      .then(setWarehouses)
      .catch(() => undefined);
  }, []);

  const totals = expenseTotals(values);
  const category = categories.find((c) => c.id === values.categoryId);
  const waits = approvalPreview(category, totals.total);

  const validate = (): boolean => {
    if (!values.categoryId) return !!toast.error('Choose what kind of spending this is');
    if (values.description.trim().length < 3) return !!toast.error('Say what the money was spent on');
    if (totals.amount <= 0) return !!toast.error('Enter how much was spent');
    if (!values.paidFromLedgerId) return !!toast.error('Choose the account the money came out of');
    if (values.method === 'cheque' && !values.chequeNo.trim()) {
      return !!toast.error('A cheque needs its cheque number');
    }
    return true;
  };

  const save = async (andSubmit: boolean) => {
    if (!validate()) return;
    if (andSubmit && category?.requiresReceipt && values.attachments.length === 0) {
      toast.error(`"${category.name}" expenses need their receipt attached before they are submitted`);
      return;
    }

    setSaving(true);
    try {
      const created = await expenseService.create(expenseToPayload(values));
      if (!andSubmit) {
        toast.success('Expense saved as a draft');
        router.push(`/finance/expenses/${created.id}`);
        return;
      }
      try {
        const submitted = await expenseService.submit(created.id);
        toast.success(
          submitted.status === 'posted'
            ? `${submitted.reference} posted`
            : 'Submitted — waiting for approval',
        );
      } catch (error: any) {
        // The draft exists; it just could not go further. Say so, and take them to it.
        toast.error(
          `Saved as a draft, but not submitted: ${error.response?.data?.message || 'unknown error'}`,
        );
      }
      router.push(`/finance/expenses/${created.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not record this expense');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Record an Expense</h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/expenses')}>
            &larr; Back
          </button>
        </div>

        <div className={`${finance.banner} ${finance.bannerInfo}`}>
          <span className={finance.bannerTitle}>Money already spent, paid on the spot</span>
          If a supplier is sending an invoice to be paid later, record it as a supplier bill instead
          — that is what keeps track of what is owed.
        </div>

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
        >
          <ExpenseForm
            values={values}
            onChange={setValues}
            categories={categories}
            accounts={accounts}
            vendors={vendors}
            warehouses={warehouses}
            disabled={saving}
          />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/expenses')}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => save(false)}
              disabled={saving}
            >
              Save Draft
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving
                ? 'Saving…'
                : waits
                  ? `Submit for Approval · ${money(totals.total)}`
                  : `Submit & Post · ${money(totals.total)}`}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateExpensePageWrapper() {
  return (
    <ProtectedRoute permission="finance-expenses:add">
      <CreateExpensePage />
    </ProtectedRoute>
  );
}
