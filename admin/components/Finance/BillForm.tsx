import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  billService,
  Ledger,
  OpenReceipt,
  Vendor,
} from '../../services/financeService';
import styles from '../../styles/FormPage.module.scss';
import finance from '../../styles/Finance.module.scss';

/**
 * The supplier bill form, shared by create and edit.
 *
 * The screen is built around one idea: what the supplier has invoiced should be checked against
 * what the warehouse actually received, and the checking should happen HERE rather than in
 * somebody's head. So the receipts are listed with what is left on each, the running difference
 * between the invoice total and what has been ticked is always on screen, and a charge line is
 * offered for the part of an invoice that is not goods.
 *
 * The one thing the form will not do is guess. It never pre-ticks a receipt.
 */

export interface BillFormValues {
  vendorId: string;
  supplierBillNo: string;
  billDate: string;
  dueDate: string;
  /** receiptId to the amount of it being claimed, as typed. */
  matched: Record<string, string>;
  lines: { description: string; ledgerId: string; amount: string }[];
  taxAmount: string;
  notes: string;
}

export const EMPTY_BILL_FORM: BillFormValues = {
  vendorId: '',
  supplierBillNo: '',
  billDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  matched: {},
  lines: [],
  taxAmount: '',
  notes: '',
};

export function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function billTotals(values: BillFormValues) {
  const goods = Object.values(values.matched).reduce((sum, v) => sum + num(v), 0);
  const charges = values.lines.reduce((sum, l) => sum + num(l.amount), 0);
  const tax = num(values.taxAmount);
  return { goods, charges, tax, total: goods + charges + tax };
}

/** What goes to the API — receipts with nothing claimed on them are simply not sent. */
export function billToPayload(values: BillFormValues) {
  return {
    vendorId: values.vendorId,
    supplierBillNo: values.supplierBillNo.trim() || undefined,
    billDate: values.billDate,
    dueDate: values.dueDate || undefined,
    matchedReceipts: Object.entries(values.matched)
      .filter(([, amount]) => num(amount) > 0)
      .map(([receiptId, amount]) => ({ receiptId, amount: num(amount) })),
    lines: values.lines
      .filter((l) => l.description.trim() && l.ledgerId && num(l.amount) > 0)
      .map((l) => ({
        description: l.description.trim(),
        ledgerId: l.ledgerId,
        amount: num(l.amount),
      })),
    taxAmount: num(values.taxAmount),
    notes: values.notes.trim() || undefined,
  };
}

interface Props {
  values: BillFormValues;
  onChange: (next: BillFormValues) => void;
  vendors: Vendor[];
  /** Expense accounts only. Goods reach inventory through the matched receipts instead. */
  ledgers: Ledger[];
  disabled?: boolean;
  /** Set when editing, so the draft's own receipts stay on the list. */
  billId?: string;
}

const BillForm: React.FC<Props> = ({ values, onChange, vendors, ledgers, disabled, billId }) => {
  const [receipts, setReceipts] = useState<OpenReceipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);

  const set = <K extends keyof BillFormValues>(key: K, value: BillFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  const loadReceipts = useCallback(async () => {
    if (!values.vendorId) {
      setReceipts([]);
      return;
    }
    setLoadingReceipts(true);
    try {
      setReceipts(await billService.openReceipts(values.vendorId, billId));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this supplier’s receipts');
      setReceipts([]);
    } finally {
      setLoadingReceipts(false);
    }
  }, [values.vendorId, billId]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  const totals = billTotals(values);

  const toggleReceipt = (receipt: OpenReceipt) => {
    const next = { ...values.matched };
    if (next[receipt.id] !== undefined) delete next[receipt.id];
    // Defaulted to the whole remainder, which is what is being billed in nearly every case.
    else next[receipt.id] = String(receipt.outstanding);
    set('matched', next);
  };

  const setMatchedAmount = (receiptId: string, amount: string) => {
    set('matched', { ...values.matched, [receiptId]: amount });
  };

  const addLine = () => {
    set('lines', [...values.lines, { description: '', ledgerId: '', amount: '' }]);
  };

  const setLine = (index: number, patch: Partial<BillFormValues['lines'][number]>) => {
    set('lines', values.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLine = (index: number) => {
    set('lines', values.lines.filter((_, i) => i !== index));
  };

  return (
    <>
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="vendorId">Supplier *</label>
          <select
            id="vendorId"
            className={styles.select}
            value={values.vendorId}
            // Changing the supplier would leave receipts ticked that belong to somebody else, so
            // the matches are cleared with it rather than silently carried across.
            onChange={(e) => onChange({ ...values, vendorId: e.target.value, matched: {} })}
            disabled={disabled}
            required
          >
            <option value="">Choose a supplier…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            The holding record for unidentified receipts is not on this list — match those
            receipts to a real supplier first.
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="supplierBillNo">Their invoice number</label>
          <input
            id="supplierBillNo"
            type="text"
            className={styles.input}
            value={values.supplierBillNo}
            onChange={(e) => set('supplierBillNo', e.target.value)}
            disabled={disabled}
            placeholder="e.g. INV-2201"
          />
          <p className={styles.hint}>
            As printed on their paper. The same number cannot be entered twice for one supplier —
            that check is what stops an invoice being paid twice.
          </p>
        </div>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="billDate">Bill date *</label>
          <input
            id="billDate"
            type="date"
            className={styles.input}
            value={values.billDate}
            onChange={(e) => set('billDate', e.target.value)}
            disabled={disabled}
            required
          />
          <p className={styles.hint}>
            The date on their invoice, not today. It decides which month this lands in.
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="dueDate">Due date</label>
          <input
            id="dueDate"
            type="date"
            className={styles.input}
            value={values.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
            disabled={disabled}
          />
          <p className={styles.hint}>
            Leave blank to use the supplier&apos;s payment terms.
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="taxAmount">Input tax</label>
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
          <p className={styles.hint}>The tax shown on their invoice, claimable on a return.</p>
        </div>
      </div>

      {/* ---- Goods ---------------------------------------------------------- */}

      <div className={finance.panel}>
        <h2 className={finance.panelTitle}>Goods received from this supplier</h2>

        {!values.vendorId && (
          <p className={finance.readonlyNote}>Choose a supplier to see what they have delivered.</p>
        )}

        {values.vendorId && loadingReceipts && (
          <p className={finance.readonlyNote}>Loading…</p>
        )}

        {values.vendorId && !loadingReceipts && receipts.length === 0 && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Nothing outstanding</span>
            Everything received from this supplier has already been billed. A bill can still be
            raised for a service or a charge using the lines below.
          </div>
        )}

        {receipts.length > 0 && (
          <>
            <p className={finance.readonlyNote} style={{ marginTop: 0 }}>
              Tick what this invoice is paying for. Nothing is ticked for you — attaching the
              wrong delivery to an invoice is not something anything downstream would notice.
            </p>

            <table className={finance.roleTable}>
              <thead>
                <tr>
                  <th style={{ width: '3rem' }} />
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Typed as</th>
                  <th style={{ textAlign: 'right' }}>Left to bill</th>
                  <th style={{ width: '9rem' }}>On this bill</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const ticked = values.matched[r.id] !== undefined;
                  return (
                    <tr key={r.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={ticked}
                          disabled={disabled}
                          onChange={() => toggleReceipt(r)}
                          aria-label={`Include receipt ${r.documentNo ?? ''}`}
                        />
                      </td>
                      <td className={finance.code}>{r.documentNo ? `#${r.documentNo}` : '—'}</td>
                      <td>{new Date(r.receiptDate).toLocaleDateString('en-PK')}</td>
                      <td className={finance.muted}>{r.typedName || '—'}</td>
                      <td className={finance.amount}>
                        {money(r.outstanding)}
                        {r.billedAmount > 0 && (
                          <div className={finance.muted} style={{ fontSize: '0.76rem' }}>
                            {money(r.billedAmount)} already billed
                          </div>
                        )}
                      </td>
                      <td>
                        {ticked && (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max={r.outstanding}
                            className={styles.input}
                            value={values.matched[r.id]}
                            disabled={disabled}
                            onChange={(e) => setMatchedAmount(r.id, e.target.value)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className={finance.readonlyNote}>
              An amount can be reduced to bill part of a delivery, but never raised above what is
              left — if the supplier is charging more than the goods were booked at, the
              difference belongs on a charge line below.
            </p>
          </>
        )}
      </div>

      {/* ---- Other charges -------------------------------------------------- */}

      <div className={finance.panel}>
        <h2 className={finance.panelTitle}>Other charges on this invoice</h2>
        <p className={finance.readonlyNote} style={{ marginTop: 0 }}>
          Freight, handling, a service fee — anything on the invoice that is not the goods
          themselves.
        </p>

        {values.lines.map((line, index) => (
          <div key={index} className={finance.lineGrid}>
            <input
              type="text"
              className={styles.input}
              placeholder="What it is for"
              value={line.description}
              disabled={disabled}
              onChange={(e) => setLine(index, { description: e.target.value })}
            />
            <select
              className={styles.select}
              value={line.ledgerId}
              disabled={disabled}
              onChange={(e) => setLine(index, { ledgerId: e.target.value })}
            >
              <option value="">Choose an account…</option>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              className={styles.input}
              placeholder="0.00"
              value={line.amount}
              disabled={disabled}
              onChange={(e) => setLine(index, { amount: e.target.value })}
            />
            <button
              type="button"
              className={finance.removeLine}
              disabled={disabled}
              onClick={() => removeLine(index)}
              aria-label="Remove this charge"
            >
              ×
            </button>
          </div>
        ))}

        <button type="button" className={finance.addLine} disabled={disabled} onClick={addLine}>
          + Add a charge
        </button>
      </div>

      {/* ---- Totals --------------------------------------------------------- */}

      <div className={finance.totalsBar}>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Goods</span>
          <span className={finance.totalsValue}>{money(totals.goods)}</span>
        </div>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Charges</span>
          <span className={finance.totalsValue}>{money(totals.charges)}</span>
        </div>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Tax</span>
          <span className={finance.totalsValue}>{money(totals.tax)}</span>
        </div>
        <div className={finance.totalsItem}>
          <span className={finance.totalsLabel}>Invoice total</span>
          <span className={finance.totalsValue}>{money(totals.total)}</span>
        </div>
        <div className={finance.totalsVerdict}>
          {/*
            No cross-check against a figure the user typed for the invoice total, deliberately.
            Asking for the total twice and complaining when they disagree teaches people to copy
            one into the other. This shows what the bill adds up to; the person compares it with
            the paper in their hand.
          */}
          <span className={totals.total > 0 ? finance.totalsBalanced : finance.totalsUnbalanced}>
            {totals.total > 0 ? 'Compare this with the invoice' : 'Nothing on this bill yet'}
          </span>
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

export default BillForm;
