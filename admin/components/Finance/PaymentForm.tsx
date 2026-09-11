import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  paymentService,
  Ledger,
  OpenBill,
  PaymentInput,
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  Vendor,
} from '../../services/financeService';
import { money } from './BillForm';
import styles from '../../styles/FormPage.module.scss';
import finance from '../../styles/Finance.module.scss';

/**
 * The supplier payment form, shared by create and edit.
 *
 * Two figures matter and the form keeps them visibly apart: how much is being paid, and which
 * bills it settles. They are ALLOWED to differ — the difference is held on account against the
 * supplier — so the form never forces one to equal the other. It shows the gap and says in words
 * what will happen to it.
 *
 * Like the bill form, it never ticks a bill by itself. The one exception is arriving from a
 * bill's own "Pay this bill" button, where the person has already said which bill they mean.
 */

export interface PaymentFormValues {
  vendorId: string;
  paymentDate: string;
  method: PaymentMethod;
  paidFromLedgerId: string;
  chequeNo: string;
  chequeDate: string;
  transferReference: string;
  amount: string;
  /** billId to the amount of this payment set against it, as typed. */
  allocated: Record<string, string>;
  notes: string;
}

export const EMPTY_PAYMENT_FORM: PaymentFormValues = {
  vendorId: '',
  paymentDate: new Date().toISOString().slice(0, 10),
  method: 'bank_transfer',
  paidFromLedgerId: '',
  chequeNo: '',
  chequeDate: '',
  transferReference: '',
  amount: '',
  allocated: {},
  notes: '',
};

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function paymentTotals(values: PaymentFormValues) {
  const amount = num(values.amount);
  const allocated = Object.values(values.allocated).reduce((sum, v) => sum + num(v), 0);
  return { amount, allocated, onAccount: round2(amount - allocated) };
}

/** What goes to the API. Fields that do not belong to the chosen method are not sent at all. */
export function paymentToPayload(values: PaymentFormValues): PaymentInput {
  const isCheque = values.method === 'cheque';
  return {
    vendorId: values.vendorId,
    paymentDate: values.paymentDate,
    method: values.method,
    paidFromLedgerId: values.paidFromLedgerId,
    chequeNo: isCheque ? values.chequeNo.trim() : undefined,
    chequeDate: isCheque && values.chequeDate ? values.chequeDate : undefined,
    transferReference: !isCheque ? values.transferReference.trim() || undefined : undefined,
    amount: num(values.amount),
    allocations: Object.entries(values.allocated)
      .filter(([, amount]) => num(amount) > 0)
      .map(([billId, amount]) => ({ billId, amount: num(amount) })),
    notes: values.notes.trim() || undefined,
  };
}

interface Props {
  values: PaymentFormValues;
  onChange: (next: PaymentFormValues) => void;
  vendors: Vendor[];
  /** Cash and bank accounts only — money can only come out of somewhere money actually is. */
  accounts: Ledger[];
  disabled?: boolean;
  /** Set when editing, so the bills this draft already settles stay on the list. */
  paymentId?: string;
  /** Set when arriving from a bill's "Pay this bill" button. Ticked once, on first load. */
  preselectBillId?: string;
}

const PaymentForm: React.FC<Props> = ({
  values,
  onChange,
  vendors,
  accounts,
  disabled,
  paymentId,
  preselectBillId,
}) => {
  const [bills, setBills] = useState<OpenBill[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);
  const preselected = useRef(false);

  const set = <K extends keyof PaymentFormValues>(key: K, value: PaymentFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  const loadBills = useCallback(async () => {
    if (!values.vendorId) {
      setBills([]);
      return;
    }
    setLoadingBills(true);
    try {
      setBills(await paymentService.openBills(values.vendorId, paymentId));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this supplier’s bills');
      setBills([]);
    } finally {
      setLoadingBills(false);
    }
  }, [values.vendorId, paymentId]);

  useEffect(() => {
    loadBills();
  }, [loadBills]);

  useEffect(() => {
    if (preselected.current || !preselectBillId) return;
    const bill = bills.find((b) => b.id === preselectBillId);
    if (!bill) return;
    preselected.current = true;
    onChange({
      ...values,
      allocated: { ...values.allocated, [bill.id]: String(bill.outstanding) },
      amount: values.amount || String(bill.outstanding),
    });
    // Runs once the bills arrive; `values` is read at that moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, preselectBillId]);

  const totals = paymentTotals(values);

  const toggleBill = (bill: OpenBill) => {
    const next = { ...values.allocated };
    if (next[bill.id] !== undefined) {
      delete next[bill.id];
    } else {
      // What the bill is owed, but no more than is left of the payment when one has been entered.
      const leftOfPayment = totals.amount > 0 ? Math.max(totals.onAccount, 0) : bill.outstanding;
      next[bill.id] = String(round2(Math.min(bill.outstanding, leftOfPayment || bill.outstanding)));
    }
    set('allocated', next);
  };

  const isCheque = values.method === 'cheque';

  let verdict: { ok: boolean; text: string };
  if (totals.amount <= 0) {
    verdict = { ok: false, text: 'Enter how much is being paid' };
  } else if (totals.onAccount < -0.005) {
    verdict = { ok: false, text: 'The bills ticked add up to more than the payment' };
  } else if (totals.onAccount > 0.005) {
    verdict = {
      ok: true,
      text: `${money(totals.onAccount)} will be held on account against this supplier`,
    };
  } else {
    verdict = { ok: true, text: 'Fully set against the bills ticked' };
  }

  return (
    <>
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="vendorId">Supplier *</label>
          <select
            id="vendorId"
            className={styles.select}
            value={values.vendorId}
            // A different supplier's bills cannot be on this payment, so the ticks go with it.
            onChange={(e) => onChange({ ...values, vendorId: e.target.value, allocated: {} })}
            disabled={disabled}
            required
          >
            <option value="">Choose a supplier…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.payableBalance ? ` — owed ${money(v.payableBalance)}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="paymentDate">Payment date *</label>
          <input
            id="paymentDate"
            type="date"
            className={styles.input}
            value={values.paymentDate}
            onChange={(e) => set('paymentDate', e.target.value)}
            disabled={disabled}
            required
          />
          <p className={styles.hint}>The day the money left. It decides which month this lands in.</p>
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
          <p className={styles.hint}>
            Only cash and bank accounts are offered — money can only come out of somewhere money
            actually is.
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="amount">Amount paid *</label>
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
              The same number cannot be used twice from one account — each leaf is written once.
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
            <p className={styles.hint}>Leave blank if it is the payment date.</p>
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
            <p className={styles.hint}>
              {values.method === 'bank_transfer'
                ? 'Whatever the bank shows against it, so it can be found on the statement.'
                : 'Whatever the supplier signed for the cash, if anything.'}
            </p>
          </div>
        </div>
      )}

      {isCheque && (
        <div className={`${finance.banner} ${finance.bannerInfo}`}>
          <span className={finance.bannerTitle}>A cheque is not money yet</span>
          The bank balance does not move today. The cheque is held as issued but uncleared, and
          moves out of the bank when it shows on the statement.
        </div>
      )}

      {/* ---- Bills ---------------------------------------------------------- */}

      <div className={finance.panel}>
        <h2 className={finance.panelTitle}>What this payment settles</h2>

        {!values.vendorId && (
          <p className={finance.readonlyNote}>Choose a supplier to see what they are owed.</p>
        )}

        {values.vendorId && loadingBills && <p className={finance.readonlyNote}>Loading…</p>}

        {values.vendorId && !loadingBills && bills.length === 0 && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Nothing unpaid</span>
            Every posted bill from this supplier has been paid. A payment can still be made on
            account — it will be set against their next bill.
          </div>
        )}

        {bills.length > 0 && (
          <>
            <p className={finance.readonlyNote} style={{ marginTop: 0 }}>
              Oldest due first. Tick what this payment is for; nothing is ticked for you.
            </p>

            <table className={finance.roleTable}>
              <thead>
                <tr>
                  <th style={{ width: '3rem' }} />
                  <th>Bill</th>
                  <th>Dated</th>
                  <th>Due</th>
                  <th style={{ textAlign: 'right' }}>Left to pay</th>
                  <th style={{ width: '9rem' }}>On this payment</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => {
                  const ticked = values.allocated[b.id] !== undefined;
                  return (
                    <tr key={b.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={ticked}
                          disabled={disabled}
                          onChange={() => toggleBill(b)}
                          aria-label={`Include bill ${b.reference}`}
                        />
                      </td>
                      <td>
                        <span className={finance.code}>{b.reference}</span>
                        {b.supplierBillNo && (
                          <div className={finance.muted} style={{ fontSize: '0.76rem' }}>
                            {b.supplierBillNo}
                          </div>
                        )}
                      </td>
                      <td>{new Date(b.billDate).toLocaleDateString('en-PK')}</td>
                      <td className={b.isOverdue ? finance.amountNegative : undefined}>
                        {new Date(b.dueDate).toLocaleDateString('en-PK')}
                        {b.isOverdue && <span className={finance.flag}>Overdue</span>}
                      </td>
                      <td className={finance.amount}>
                        {money(b.outstanding)}
                        {b.paidAmount > 0 && (
                          <div className={finance.muted} style={{ fontSize: '0.76rem' }}>
                            {money(b.paidAmount)} of {money(b.totalAmount)} already paid
                          </div>
                        )}
                      </td>
                      <td>
                        {ticked && (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={b.outstanding}
                            className={styles.input}
                            value={values.allocated[b.id]}
                            disabled={disabled}
                            onChange={(e) =>
                              set('allocated', { ...values.allocated, [b.id]: e.target.value })
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ---- Totals --------------------------------------------------------- */}

      <div className={finance.totalsBar}>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Paying</span>
          <span className={finance.totalsValue}>{money(totals.amount)}</span>
        </div>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Set against bills</span>
          <span className={finance.totalsValue}>{money(totals.allocated)}</span>
        </div>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>On account</span>
          <span className={finance.totalsValue}>{money(Math.max(totals.onAccount, 0))}</span>
        </div>
        <div className={finance.totalsVerdict}>
          <span className={verdict.ok ? finance.totalsBalanced : finance.totalsUnbalanced}>
            {verdict.text}
          </span>
          {totals.allocated > 0 && Math.abs(totals.onAccount) > 0.005 && (
            <button
              type="button"
              className={finance.addLine}
              disabled={disabled}
              onClick={() => set('amount', String(round2(totals.allocated)))}
            >
              Pay exactly what is ticked
            </button>
          )}
        </div>
      </div>

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

export default PaymentForm;
