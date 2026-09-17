import React from 'react';
import {
  ContraSubtype,
  CONTRA_SUBTYPES,
  CONTRA_SUBTYPE_LABELS,
  Ledger,
  Voucher,
  VoucherCategory,
  VoucherInput,
  VOUCHER_CATEGORIES,
  VOUCHER_CATEGORY_HELP,
  VOUCHER_CATEGORY_LABELS,
} from '../../services/financeService';
import { ImageUpload } from '../UI/ImageUpload';
import { money } from './BillForm';
import styles from '../../styles/FormPage.module.scss';
import finance from '../../styles/Finance.module.scss';

/**
 * The voucher form, shared by create and edit.
 *
 * One form for six documents, because they are six shapes of the same act. The category chosen at
 * the top decides which fields exist at all: a contra asks where the money left and where it
 * arrived, a journal asks for lines, and the four money vouchers ask for one cash or bank account
 * and one other side.
 *
 * The account dropdowns are already filtered to what the server will accept — a cash voucher lists
 * only cash and bank accounts, a journal lists neither those nor any control account. The server
 * refuses the rest by name anyway; this is so the refusal is rare rather than the way people find
 * out.
 */

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
  : '';

export interface VoucherLineValue {
  ledgerId: string;
  side: 'debit' | 'credit';
  amount: string;
  narration: string;
}

export interface VoucherFormValues {
  category: VoucherCategory;
  subtype: ContraSubtype | '';
  voucherDate: string;
  narration: string;
  reference: string;
  /** The four money vouchers. */
  cashBankLedgerId: string;
  otherSide: 'account' | 'shop';
  counterLedgerId: string;
  partyId: string;
  amount: string;
  /** Contra. */
  fromLedgerId: string;
  toLedgerId: string;
  /** Journal. */
  lines: VoucherLineValue[];
  attachments: string[];
}

export interface ShopOption {
  id: string;
  label: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export const EMPTY_VOUCHER_LINE: VoucherLineValue = {
  ledgerId: '',
  side: 'debit',
  amount: '',
  narration: '',
};

export const EMPTY_VOUCHER_FORM: VoucherFormValues = {
  category: 'CRV',
  subtype: '',
  voucherDate: today(),
  narration: '',
  reference: '',
  cashBankLedgerId: '',
  otherSide: 'account',
  counterLedgerId: '',
  partyId: '',
  amount: '',
  fromLedgerId: '',
  toLedgerId: '',
  lines: [{ ...EMPTY_VOUCHER_LINE }, { ...EMPTY_VOUCHER_LINE, side: 'credit' }],
  attachments: [],
};

export const MONEY_CATEGORIES: VoucherCategory[] = ['CPV', 'CRV', 'BPV', 'BRV'];
export const MONEY_IN: VoucherCategory[] = ['CRV', 'BRV'];

/** Cash vouchers list cash accounts, bank vouchers list bank accounts — as the server sees them. */
export function cashBankChoices(accounts: Ledger[]): Ledger[] {
  return accounts.filter((l) => l.isCashEquivalent && !l.isControl);
}

/** Everything a money voucher may have on its other side: not our own money, not a control. */
export function counterChoices(accounts: Ledger[]): Ledger[] {
  return accounts.filter((l) => !l.isCashEquivalent && !l.isControl);
}

/** A journal moves no money and adjusts no control account. */
export function journalChoices(accounts: Ledger[]): Ledger[] {
  return accounts.filter((l) => !l.isCashEquivalent && !l.isControl);
}

export function journalTotals(values: VoucherFormValues): {
  debit: number;
  credit: number;
  difference: number;
} {
  let debit = 0;
  let credit = 0;
  values.lines.forEach((l) => {
    const amount = Number(l.amount) || 0;
    if (l.side === 'debit') debit += amount;
    else credit += amount;
  });
  return {
    debit: Math.round(debit * 100) / 100,
    credit: Math.round(credit * 100) / 100,
    difference: Math.round((debit - credit) * 100) / 100,
  };
}

/** Everything the form needs to say no before the server has to. */
export function validateVoucher(values: VoucherFormValues): string | null {
  if (values.narration.trim().length < 3) return 'Say what this voucher is for';
  if (!values.voucherDate) return 'Choose the date';

  if (values.category === 'JV') {
    const filled = values.lines.filter((l) => l.ledgerId && Number(l.amount) > 0);
    if (filled.length < 2) return 'A journal voucher needs at least two lines with figures on them';
    const totals = journalTotals(values);
    if (totals.difference !== 0) {
      return 'The two sides do not agree — every entry has an equal and opposite side';
    }
    return null;
  }

  if (!(Number(values.amount) > 0)) return 'Enter the amount';

  if (values.category === 'CV') {
    if (!values.subtype) return 'Say what kind of transfer this is';
    if (!values.fromLedgerId) return 'Choose the account the money leaves';
    if (!values.toLedgerId) return 'Choose the account the money arrives in';
    if (values.fromLedgerId === values.toLedgerId) {
      return 'The money would leave and arrive in the same account';
    }
    return null;
  }

  if (!values.cashBankLedgerId) {
    return MONEY_CATEGORIES.includes(values.category) && values.category.endsWith('RV')
      ? 'Choose the account the money arrives in'
      : 'Choose the account the money leaves';
  }
  if (values.otherSide === 'shop' && !values.partyId) return 'Choose the shop';
  if (values.otherSide === 'account' && !values.counterLedgerId) {
    return 'Choose the account for the other side';
  }
  return null;
}

export function voucherToPayload(values: VoucherFormValues): VoucherInput {
  const base: VoucherInput = {
    category: values.category,
    voucherDate: values.voucherDate,
    narration: values.narration.trim(),
    reference: values.reference.trim() || undefined,
    attachments: values.attachments,
  };

  if (values.category === 'JV') {
    return {
      ...base,
      lines: values.lines
        .filter((l) => l.ledgerId && Number(l.amount) > 0)
        .map((l) => ({
          ledgerId: l.ledgerId,
          debit: l.side === 'debit' ? Number(l.amount) : undefined,
          credit: l.side === 'credit' ? Number(l.amount) : undefined,
          narration: l.narration.trim() || undefined,
        })),
    };
  }

  if (values.category === 'CV') {
    return {
      ...base,
      subtype: (values.subtype || undefined) as ContraSubtype | undefined,
      fromLedgerId: values.fromLedgerId,
      toLedgerId: values.toLedgerId,
      amount: Number(values.amount) || 0,
    };
  }

  return {
    ...base,
    cashBankLedgerId: values.cashBankLedgerId,
    amount: Number(values.amount) || 0,
    ...(values.otherSide === 'shop'
      ? { partyType: 'dealer' as const, partyId: values.partyId }
      : { counterLedgerId: values.counterLedgerId }),
  };
}

/**
 * Read a saved voucher back into the form.
 *
 * The document stores the composed debits and credits rather than what was typed, so the fields are
 * recovered from the lines. The order the server writes them in is fixed — money in leads with the
 * cash line, money out leads with the other side, a contra leads with where the money arrived — so
 * this is a reversal of that, not a guess.
 */
export function voucherToForm(voucher: Voucher): VoucherFormValues {
  const base: VoucherFormValues = {
    ...EMPTY_VOUCHER_FORM,
    category: voucher.category,
    subtype: voucher.subtype ?? '',
    voucherDate: voucher.voucherDate.slice(0, 10),
    narration: voucher.narration,
    reference: voucher.paymentReference ?? '',
    amount: String(voucher.amount),
    attachments: voucher.attachments ?? [],
    lines: [{ ...EMPTY_VOUCHER_LINE }, { ...EMPTY_VOUCHER_LINE, side: 'credit' }],
  };

  if (voucher.category === 'JV') {
    return {
      ...base,
      lines: voucher.lines.map((l) => ({
        ledgerId: l.ledgerId,
        side: l.debit > 0 ? ('debit' as const) : ('credit' as const),
        amount: String(l.debit > 0 ? l.debit : l.credit),
        narration: l.narration ?? '',
      })),
    };
  }

  if (voucher.category === 'CV') {
    const arrived = voucher.lines.find((l) => l.debit > 0);
    const left = voucher.lines.find((l) => l.credit > 0);
    return {
      ...base,
      toLedgerId: arrived?.ledgerId ?? '',
      fromLedgerId: left?.ledgerId ?? '',
    };
  }

  const isMoneyIn = MONEY_IN.includes(voucher.category);
  const cashLine = isMoneyIn ? voucher.lines[0] : voucher.lines[1];
  const otherLine = isMoneyIn ? voucher.lines[1] : voucher.lines[0];

  return {
    ...base,
    cashBankLedgerId: cashLine?.ledgerId ?? '',
    otherSide: voucher.partyId ? 'shop' : 'account',
    partyId: voucher.partyId ?? '',
    counterLedgerId: voucher.partyId ? '' : otherLine?.ledgerId ?? '',
  };
}

interface Props {
  values: VoucherFormValues;
  onChange: (values: VoucherFormValues) => void;
  accounts: Ledger[];
  shops: ShopOption[];
  /** The category is fixed once a voucher exists — changing it would be a different document. */
  lockCategory?: boolean;
  disabled?: boolean;
}

const VoucherForm: React.FC<Props> = ({
  values,
  onChange,
  accounts,
  shops,
  lockCategory,
  disabled,
}) => {
  const set = <K extends keyof VoucherFormValues>(key: K, value: VoucherFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  const setLine = (index: number, patch: Partial<VoucherLineValue>) => {
    const lines = values.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    onChange({ ...values, lines });
  };

  const isMoney = MONEY_CATEGORIES.includes(values.category);
  const isMoneyIn = MONEY_IN.includes(values.category);
  const moneyAccounts = cashBankChoices(accounts);
  const counters = counterChoices(accounts);
  const journalAccounts = journalChoices(accounts);
  const totals = journalTotals(values);
  const balanced = values.category === 'JV' && totals.debit > 0 && totals.difference === 0;

  const accountOption = (l: Ledger) => (
    <option key={l.id} value={l.id}>
      {l.code} · {l.name}
    </option>
  );

  return (
    <>
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="category">Kind of voucher *</label>
          <select
            id="category"
            className={styles.select}
            value={values.category}
            onChange={(e) => {
              const category = e.target.value as VoucherCategory;
              // Switching kind clears the fields that belonged to the old one, so nothing is
              // carried across into a document it does not belong on.
              onChange({
                ...EMPTY_VOUCHER_FORM,
                category,
                voucherDate: values.voucherDate,
                narration: values.narration,
                reference: values.reference,
                attachments: values.attachments,
              });
            }}
            disabled={disabled || lockCategory}
          >
            {VOUCHER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c} — {VOUCHER_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <p className={styles.hint}>{VOUCHER_CATEGORY_HELP[values.category]}</p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="voucherDate">Date *</label>
          <input
            id="voucherDate"
            type="date"
            className={styles.input}
            value={values.voucherDate}
            onChange={(e) => set('voucherDate', e.target.value)}
            disabled={disabled}
            required
          />
          <p className={styles.hint}>It decides which month this lands in.</p>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="narration">What this voucher is for *</label>
        <input
          id="narration"
          type="text"
          className={styles.input}
          value={values.narration}
          onChange={(e) => set('narration', e.target.value)}
          disabled={disabled}
          placeholder="e.g. Day cash deposited into the operating account"
          required
        />
        <p className={styles.hint}>
          Whoever approves this reads only these words and the entry below. Write it for them.
        </p>
      </div>

      {isMoney && (
        <>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="cashBankLedgerId">
                {isMoneyIn ? 'Money arrives in *' : 'Money leaves *'}
              </label>
              <select
                id="cashBankLedgerId"
                className={styles.select}
                value={values.cashBankLedgerId}
                onChange={(e) => set('cashBankLedgerId', e.target.value)}
                disabled={disabled}
                required
              >
                <option value="">Choose an account…</option>
                {moneyAccounts.map(accountOption)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="amount">Amount *</label>
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

          <div className={styles.formGroup}>
            <label>The other side *</label>
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
              <label className={finance.settingLabel} style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="radio"
                  checked={values.otherSide === 'account'}
                  onChange={() => onChange({ ...values, otherSide: 'account', partyId: '' })}
                  disabled={disabled}
                />
                An account
              </label>
              <label className={finance.settingLabel} style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="radio"
                  checked={values.otherSide === 'shop'}
                  onChange={() => onChange({ ...values, otherSide: 'shop', counterLedgerId: '' })}
                  disabled={disabled}
                />
                A shop
              </label>
            </div>
            <p className={styles.hint}>
              {values.otherSide === 'shop'
                ? isMoneyIn
                  ? 'Taking money from a shop at the office. It comes off what they owe.'
                  : 'Refunding a shop. It goes back onto their account.'
                : 'Suppliers, staff wages, stock and rider cash are kept by their own screens and '
                  + 'are not offered here.'}
            </p>
          </div>

          {values.otherSide === 'shop' ? (
            <div className={styles.formGroup}>
              <label htmlFor="partyId">Shop *</label>
              <select
                id="partyId"
                className={styles.select}
                value={values.partyId}
                onChange={(e) => set('partyId', e.target.value)}
                disabled={disabled}
                required
              >
                <option value="">Choose a shop…</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className={styles.formGroup}>
              <label htmlFor="counterLedgerId">Account *</label>
              <select
                id="counterLedgerId"
                className={styles.select}
                value={values.counterLedgerId}
                onChange={(e) => set('counterLedgerId', e.target.value)}
                disabled={disabled}
                required
              >
                <option value="">Choose an account…</option>
                {counters.map(accountOption)}
              </select>
              {!isMoneyIn && (
                <p className={styles.hint}>
                  Day-to-day spending belongs on the Expenses screen, which carries the approval
                  limits. Use this for drawings, loans repaid, taxes paid and the like.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {values.category === 'CV' && (
        <>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="subtype">Kind of transfer *</label>
              <select
                id="subtype"
                className={styles.select}
                value={values.subtype}
                onChange={(e) => set('subtype', e.target.value as ContraSubtype)}
                disabled={disabled}
                required
              >
                <option value="">Choose…</option>
                {CONTRA_SUBTYPES.map((s) => (
                  <option key={s} value={s}>
                    {CONTRA_SUBTYPE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="cvAmount">Amount *</label>
              <input
                id="cvAmount"
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

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="fromLedgerId">Money leaves *</label>
              <select
                id="fromLedgerId"
                className={styles.select}
                value={values.fromLedgerId}
                onChange={(e) => set('fromLedgerId', e.target.value)}
                disabled={disabled}
                required
              >
                <option value="">Choose an account…</option>
                {moneyAccounts.map(accountOption)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="toLedgerId">Money arrives in *</label>
              <select
                id="toLedgerId"
                className={styles.select}
                value={values.toLedgerId}
                onChange={(e) => set('toLedgerId', e.target.value)}
                disabled={disabled}
                required
              >
                <option value="">Choose an account…</option>
                {moneyAccounts.map(accountOption)}
              </select>
              <p className={styles.hint}>
                Both sides are ours, so the business is no richer or poorer — only the money has
                moved.
              </p>
            </div>
          </div>
        </>
      )}

      {values.category === 'JV' && (
        <div className={styles.formGroup}>
          <label>Lines *</label>
          <table className={finance.roleTable}>
            <thead>
              <tr>
                <th>Account</th>
                <th style={{ width: '9rem' }}>Side</th>
                <th style={{ width: '10rem', textAlign: 'right' }}>Amount</th>
                <th>Note</th>
                <th style={{ width: '3rem' }} />
              </tr>
            </thead>
            <tbody>
              {values.lines.map((l, index) => (
                // The rows have no id of their own until they are saved; the position is what
                // identifies them while they are being typed.
                 
                <tr key={index}>
                  <td>
                    <select
                      className={styles.select}
                      value={l.ledgerId}
                      onChange={(e) => setLine(index, { ledgerId: e.target.value })}
                      disabled={disabled}
                      aria-label={`Account for line ${index + 1}`}
                    >
                      <option value="">Choose an account…</option>
                      {journalAccounts.map(accountOption)}
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.select}
                      value={l.side}
                      onChange={(e) => setLine(index, { side: e.target.value as 'debit' | 'credit' })}
                      disabled={disabled}
                      aria-label={`Side for line ${index + 1}`}
                    >
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={styles.input}
                      value={l.amount}
                      onChange={(e) => setLine(index, { amount: e.target.value })}
                      disabled={disabled}
                      placeholder="0.00"
                      aria-label={`Amount for line ${index + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className={styles.input}
                      value={l.narration}
                      onChange={(e) => setLine(index, { narration: e.target.value })}
                      disabled={disabled}
                      placeholder="Optional"
                      aria-label={`Note for line ${index + 1}`}
                    />
                  </td>
                  <td>
                    {values.lines.length > 2 && !disabled && (
                      <button
                        type="button"
                        className={finance.removeLine}
                        onClick={() => onChange({
                          ...values,
                          lines: values.lines.filter((_, i) => i !== index),
                        })}
                        aria-label={`Remove line ${index + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!disabled && (
            <button
              type="button"
              className={finance.removeLine}
              onClick={() => onChange({ ...values, lines: [...values.lines, { ...EMPTY_VOUCHER_LINE }] })}
            >
              + Add a line
            </button>
          )}

          <div className={finance.totalsBar}>
            <div className={finance.totalsItem}>
              <span className={finance.totalsLabel}>Debited</span>
              <span className={finance.totalsValue}>{money(totals.debit)}</span>
            </div>
            <div className={finance.totalsItem}>
              <span className={finance.totalsLabel}>Credited</span>
              <span className={finance.totalsValue}>{money(totals.credit)}</span>
            </div>
            <div className={finance.totalsVerdict}>
              <span className={balanced ? finance.totalsBalanced : finance.totalsUnbalanced}>
                {balanced
                  ? 'The two sides agree'
                  : `Out by ${money(Math.abs(totals.difference))} — every entry has an equal and opposite side`}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.formGroup}>
        <label htmlFor="reference">Cheque, slip or challan number</label>
        <input
          id="reference"
          type="text"
          className={styles.input}
          value={values.reference}
          onChange={(e) => set('reference', e.target.value)}
          disabled={disabled}
          placeholder="e.g. Deposit slip 55213"
        />
        <p className={styles.hint}>
          The voucher gets its own number when it posts. This is the number on the paper.
        </p>
      </div>

      <div className={styles.formGroup}>
        <label>Attachments</label>
        {values.attachments.length > 0 && (
          <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
            {values.attachments.map((url, i) => (
              <li key={url} style={{ marginBottom: '0.3rem' }}>
                <a href={`${API_BASE}${url}`} target="_blank" rel="noreferrer">
                  Attachment {i + 1}
                </a>{' '}
                {!disabled && (
                  <button
                    type="button"
                    className={finance.removeLine}
                    onClick={() => set('attachments', values.attachments.filter((a) => a !== url))}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!disabled && values.attachments.length < 10 && (
          <ImageUpload
            value=""
            category="vouchers"
            label={values.attachments.length ? 'Add another' : 'Attach the slip or paperwork'}
            onChange={(url) => {
              if (url) set('attachments', [...values.attachments, url]);
            }}
          />
        )}
      </div>
    </>
  );
};

export default VoucherForm;
