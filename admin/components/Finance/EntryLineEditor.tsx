import React, { useMemo } from 'react';
import { Ledger } from '../../services/financeService';
import styles from '../../styles/Finance.module.scss';
import formStyles from '../../styles/FormPage.module.scss';

/**
 * The lines of a journal entry, with the running debit and credit totals shown while typing.
 *
 * The totals strip is the point of this component. An accountant's whole task here is making
 * two columns agree, and a form that only reveals the difference on submit makes them do the
 * arithmetic themselves.
 */

export interface EditorLine {
  ledgerId: string;
  debit: string;
  credit: string;
  lineNarration: string;
}

export const EMPTY_LINE: EditorLine = {
  ledgerId: '',
  debit: '',
  credit: '',
  lineNarration: '',
};

interface Props {
  ledgers: Ledger[];
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  disabled?: boolean;
}

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EntryLineEditor: React.FC<Props> = ({ ledgers, lines, onChange, disabled }) => {
  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + toNumber(l.debit), 0);
    const credit = lines.reduce((s, l) => s + toNumber(l.credit), 0);
    return {
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      difference: Math.round((debit - credit) * 100) / 100,
    };
  }, [lines]);

  const balanced = Math.abs(totals.difference) < 0.005 && totals.debit > 0;

  const set = (index: number, patch: Partial<EditorLine>) => {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  /**
   * Typing in one column clears the other.
   *
   * An account is either debited or credited, never both — the server refuses a line carrying
   * both, so the form should make it impossible to build one rather than reject it afterwards.
   */
  const setAmount = (index: number, column: 'debit' | 'credit', value: string) => {
    set(index, column === 'debit' ? { debit: value, credit: '' } : { credit: value, debit: '' });
  };

  return (
    <>
      <div className={styles.lineGrid}>
        <span className={styles.lineHeader}>Account</span>
        <span className={styles.lineHeader}>Debit</span>
        <span className={styles.lineHeader}>Credit</span>
        <span className={styles.lineHeader}>Note</span>
        <span className={styles.lineHeader} />
      </div>

      {lines.map((line, index) => (
        <div className={styles.lineGrid} key={index}>
          <select
            className={formStyles.select}
            value={line.ledgerId}
            disabled={disabled}
            onChange={(e) => set(index, { ledgerId: e.target.value })}
            aria-label={`Account for line ${index + 1}`}
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
            className={formStyles.input}
            value={line.debit}
            disabled={disabled}
            onChange={(e) => setAmount(index, 'debit', e.target.value)}
            placeholder="0.00"
            aria-label={`Debit for line ${index + 1}`}
          />

          <input
            type="number"
            step="0.01"
            min="0"
            className={formStyles.input}
            value={line.credit}
            disabled={disabled}
            onChange={(e) => setAmount(index, 'credit', e.target.value)}
            placeholder="0.00"
            aria-label={`Credit for line ${index + 1}`}
          />

          <input
            type="text"
            className={formStyles.input}
            value={line.lineNarration}
            disabled={disabled}
            onChange={(e) => set(index, { lineNarration: e.target.value })}
            placeholder="Optional"
            aria-label={`Note for line ${index + 1}`}
          />

          <button
            type="button"
            className={styles.removeLine}
            // Two lines is the floor — one line is not an entry, it is half of one.
            disabled={disabled || lines.length <= 2}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
            aria-label={`Remove line ${index + 1}`}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        className={styles.addLine}
        disabled={disabled}
        onClick={() => onChange([...lines, { ...EMPTY_LINE }])}
      >
        + Add line
      </button>

      <div className={styles.totalsBar}>
        <div className={styles.totalsItem}>
          <span className={styles.totalsLabel}>Total debit</span>
          <span className={styles.totalsValue}>{money(totals.debit)}</span>
        </div>
        <div className={styles.totalsItem}>
          <span className={styles.totalsLabel}>Total credit</span>
          <span className={styles.totalsValue}>{money(totals.credit)}</span>
        </div>
        <div className={styles.totalsItem}>
          <span className={styles.totalsLabel}>Difference</span>
          <span
            className={`${styles.totalsValue} ${
              balanced ? styles.totalsBalanced : styles.totalsUnbalanced
            }`}
          >
            {money(Math.abs(totals.difference))}
          </span>
        </div>
        <span
          className={`${styles.totalsVerdict} ${
            balanced ? styles.totalsBalanced : styles.totalsUnbalanced
          }`}
        >
          {balanced
            ? 'Balanced — ready to post'
            : totals.difference > 0
              ? `Credit ${money(totals.difference)} more to balance`
              : totals.difference < 0
                ? `Debit ${money(Math.abs(totals.difference))} more to balance`
                : 'Enter the amounts'}
        </span>
      </div>
    </>
  );
};

export default EntryLineEditor;
