import React from 'react';
import {
  ExpenseCategory,
  ExpenseInput,
  Ledger,
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  Vendor,
} from '../../services/financeService';
import { Warehouse } from '../../services/warehouseService';
import { ImageUpload } from '../UI/ImageUpload';
import { money } from './BillForm';
import styles from '../../styles/FormPage.module.scss';
import finance from '../../styles/Finance.module.scss';

/**
 * The expense form, shared by create and edit.
 *
 * It tells the person, before they submit, what submitting will do — post now, or wait for a
 * second person — because an expense that silently sits in a queue is one somebody chases the
 * cashier about a week later. The server makes the actual decision; this only previews it.
 */

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
  : '';

export interface ExpenseFormValues {
  categoryId: string;
  expenseDate: string;
  description: string;
  amount: string;
  taxAmount: string;
  method: PaymentMethod;
  paidFromLedgerId: string;
  chequeNo: string;
  chequeDate: string;
  transferReference: string;
  payeeName: string;
  vendorId: string;
  warehouseId: string;
  attachments: string[];
  notes: string;
}

export const EMPTY_EXPENSE_FORM: ExpenseFormValues = {
  categoryId: '',
  expenseDate: new Date().toISOString().slice(0, 10),
  description: '',
  amount: '',
  taxAmount: '',
  method: 'cash',
  paidFromLedgerId: '',
  chequeNo: '',
  chequeDate: '',
  transferReference: '',
  payeeName: '',
  vendorId: '',
  warehouseId: '',
  attachments: [],
  notes: '',
};

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function expenseTotals(values: ExpenseFormValues) {
  const amount = num(values.amount);
  const tax = num(values.taxAmount);
  return { amount, tax, total: Math.round((amount + tax) * 100) / 100 };
}

export function expenseToPayload(values: ExpenseFormValues): ExpenseInput {
  const isCheque = values.method === 'cheque';
  return {
    categoryId: values.categoryId,
    expenseDate: values.expenseDate,
    description: values.description.trim(),
    amount: num(values.amount),
    taxAmount: num(values.taxAmount),
    method: values.method,
    paidFromLedgerId: values.paidFromLedgerId,
    chequeNo: isCheque ? values.chequeNo.trim() : undefined,
    chequeDate: isCheque && values.chequeDate ? values.chequeDate : undefined,
    transferReference: !isCheque ? values.transferReference.trim() || undefined : undefined,
    payeeName: values.payeeName.trim() || undefined,
    vendorId: values.vendorId || undefined,
    warehouseId: values.warehouseId || undefined,
    attachments: values.attachments,
    notes: values.notes.trim() || undefined,
  };
}

/**
 * What submitting will do, in words. Mirrors the server's rule so the screen can say it in
 * advance; the server applies the rule for real at the moment of submission.
 */
export function approvalPreview(category: ExpenseCategory | undefined, total: number): string | null {
  if (!category) return null;
  if (category.requiresApproval) {
    return `Every "${category.name}" expense waits for a second person to approve it.`;
  }
  if (category.approvalAbove !== null && total - category.approvalAbove > 0.005) {
    return `"${category.name}" goes straight through up to ${money(category.approvalAbove)} — this one will wait for approval.`;
  }
  return null;
}

interface Props {
  values: ExpenseFormValues;
  onChange: (next: ExpenseFormValues) => void;
  categories: ExpenseCategory[];
  /** Cash and bank accounts only. */
  accounts: Ledger[];
  vendors: Vendor[];
  warehouses: Warehouse[];
  disabled?: boolean;
}

const ExpenseForm: React.FC<Props> = ({
  values,
  onChange,
  categories,
  accounts,
  vendors,
  warehouses,
  disabled,
}) => {
  const set = <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  const category = categories.find((c) => c.id === values.categoryId);
  const totals = expenseTotals(values);
  const waits = approvalPreview(category, totals.total);
  const isCheque = values.method === 'cheque';

  return (
    <>
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="categoryId">What kind of spending *</label>
          <select
            id="categoryId"
            className={styles.select}
            value={values.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
            disabled={disabled}
            required
          >
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {category && (
            <p className={styles.hint}>
              Posts to {category.ledgerCode} · {category.ledgerName}.
              {category.requiresReceipt && ' Needs a receipt attached.'}
            </p>
          )}
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="expenseDate">Date *</label>
          <input
            id="expenseDate"
            type="date"
            className={styles.input}
            value={values.expenseDate}
            onChange={(e) => set('expenseDate', e.target.value)}
            disabled={disabled}
            required
          />
          <p className={styles.hint}>The day the money was spent. It decides which month this lands in.</p>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="description">What it was for *</label>
        <input
          id="description"
          type="text"
          className={styles.input}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          disabled={disabled}
          placeholder="e.g. Electricity bill for the Lahore warehouse, August"
          required
        />
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="amount">Amount before tax *</label>
          <input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            className={styles.input}
            value={values.amount}
            onChange={(e) => set('amount', e.target.value)}
            disabled={disabled}
            placeholder="0.00"
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="taxAmount">Tax on the receipt</label>
          <input
            id="taxAmount"
            type="number"
            step="0.01"
            min="0"
            className={styles.input}
            value={values.taxAmount}
            onChange={(e) => set('taxAmount', e.target.value)}
            disabled={disabled}
            placeholder="0.00"
          />
          <p className={styles.hint}>Booked separately, because it can be claimed back.</p>
        </div>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="method">Paid by *</label>
          <select
            id="method"
            className={styles.select}
            value={values.method}
            onChange={(e) => set('method', e.target.value as PaymentMethod)}
            disabled={disabled}
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="paidFromLedgerId">{isCheque ? 'Drawn on *' : 'Paid from *'}</label>
          <select
            id="paidFromLedgerId"
            className={styles.select}
            value={values.paidFromLedgerId}
            onChange={(e) => set('paidFromLedgerId', e.target.value)}
            disabled={disabled}
            required
          >
            <option value="">Choose an account…</option>
            {accounts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isCheque ? (
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="chequeNo">Cheque number *</label>
            <input
              id="chequeNo"
              type="text"
              className={styles.input}
              value={values.chequeNo}
              onChange={(e) => set('chequeNo', e.target.value)}
              disabled={disabled}
              required
            />
            <p className={styles.hint}>
              A leaf already used on a supplier payment or another expense is refused.
            </p>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="chequeDate">Date on the cheque</label>
            <input
              id="chequeDate"
              type="date"
              className={styles.input}
              value={values.chequeDate}
              onChange={(e) => set('chequeDate', e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>
      ) : (
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="transferReference">
              {values.method === 'bank_transfer' ? 'Transfer reference' : 'Receipt or voucher number'}
            </label>
            <input
              id="transferReference"
              type="text"
              className={styles.input}
              value={values.transferReference}
              onChange={(e) => set('transferReference', e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="payeeName">Paid to</label>
          <input
            id="payeeName"
            type="text"
            className={styles.input}
            value={values.payeeName}
            onChange={(e) => set('payeeName', e.target.value)}
            disabled={disabled}
            placeholder="e.g. PSO pump, Ring Road"
          />
          <p className={styles.hint}>For anyone who is not on the supplier list.</p>
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="vendorId">Or a supplier</label>
          <select
            id="vendorId"
            className={styles.select}
            value={values.vendorId}
            onChange={(e) => set('vendorId', e.target.value)}
            disabled={disabled}
          >
            <option value="">None</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            Paid on the spot. If they are sending an invoice to pay later, record a supplier bill
            instead.
          </p>
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="warehouseId">For which warehouse</label>
          <select
            id="warehouseId"
            className={styles.select}
            value={values.warehouseId}
            onChange={(e) => set('warehouseId', e.target.value)}
            disabled={disabled}
          >
            <option value="">Not for a particular warehouse</option>
            {warehouses.map((w) => (
              <option key={w._id} value={w._id}>
                {w.name} · {w.city}
              </option>
            ))}
          </select>
          <p className={styles.hint}>Lets spending be reported by city.</p>
        </div>
      </div>

      <div className={finance.panel}>
        <h2 className={finance.panelTitle}>
          Receipt{category?.requiresReceipt ? ' *' : ''}
        </h2>
        {values.attachments.length > 0 && (
          <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
            {values.attachments.map((url, i) => (
              <li key={url} style={{ marginBottom: '0.3rem' }}>
                <a href={`${API_BASE}${url}`} target="_blank" rel="noreferrer">
                  Receipt {i + 1}
                </a>{' '}
                <button
                  type="button"
                  className={finance.removeLine}
                  disabled={disabled}
                  onClick={() => set('attachments', values.attachments.filter((a) => a !== url))}
                  aria-label={`Remove receipt ${i + 1}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {!disabled && values.attachments.length < 10 && (
          <ImageUpload
            value=""
            category="expenses"
            label={values.attachments.length ? 'Add another receipt' : 'Attach a photo of the receipt'}
            onChange={(url) => {
              if (url) set('attachments', [...values.attachments, url]);
            }}
          />
        )}
      </div>

      <div className={finance.totalsBar}>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Expense</span>
          <span className={finance.totalsValue}>{money(totals.amount)}</span>
        </div>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Tax</span>
          <span className={finance.totalsValue}>{money(totals.tax)}</span>
        </div>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Paid out</span>
          <span className={finance.totalsValue}>{money(totals.total)}</span>
        </div>
        <div className={finance.totalsVerdict}>
          {category && totals.total > 0 && (
            <span className={waits ? finance.totalsUnbalanced : finance.totalsBalanced}>
              {waits ? 'Will wait for approval' : 'Posts as soon as it is submitted'}
            </span>
          )}
        </div>
      </div>

      {waits && totals.total > 0 && <p className={finance.readonlyNote}>{waits}</p>}

      <div className={styles.formGroup}>
        <label htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          className={styles.textarea}
          value={values.notes}
          disabled={disabled}
          onChange={(e) => set('notes', e.target.value)}
          maxLength={1000}
        />
      </div>
    </>
  );
};

export default ExpenseForm;
