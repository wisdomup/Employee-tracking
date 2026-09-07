import React, { useEffect, useMemo, useState } from 'react';
import {
  AccountGroup,
  AccountType,
  CODE_BLOCK_HINT,
  Ledger,
  SUBLEDGER_LABELS,
  SubledgerType,
  financeService,
} from '../../services/financeService';
import styles from '../../styles/FormPage.module.scss';
import finance from '../../styles/Finance.module.scss';

/**
 * The account form, shared by create and edit.
 *
 * One component rather than two copies because the rules it has to explain are subtle and easy
 * to let drift: which fields lock once an account has been posted to, and which parts of an
 * engine account are protected. A user who is refused should have been told beforehand.
 */

export interface LedgerFormValues {
  name: string;
  code: string;
  groupId: string;
  description: string;
  openingAmount: string;
  openingAsOf: string;
  isControl: boolean;
  subledgerType: SubledgerType | '';
  isCashEquivalent: boolean;
}

export const EMPTY_LEDGER_FORM: LedgerFormValues = {
  name: '',
  code: '',
  groupId: '',
  description: '',
  openingAmount: '',
  openingAsOf: '',
  isControl: false,
  subledgerType: '',
  isCashEquivalent: false,
};

interface Props {
  groups: AccountGroup[];
  values: LedgerFormValues;
  onChange: (next: LedgerFormValues) => void;
  /** Present when editing. Drives the locks below. */
  existing?: Ledger | null;
  disabled?: boolean;
}

const SUBLEDGER_TYPES: SubledgerType[] = ['dealer', 'vendor', 'rider', 'warehouse', 'employee'];

const LedgerForm: React.FC<Props> = ({ groups, values, onChange, existing, disabled }) => {
  const [codeTouched, setCodeTouched] = useState(false);

  const set = <K extends keyof LedgerFormValues>(key: K, value: LedgerFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  const selectedGroup = useMemo(
    () => groups.find((g) => g._id === values.groupId) ?? null,
    [groups, values.groupId],
  );

  const accountType: AccountType | null = selectedGroup?.accountType ?? null;

  /**
   * Once an account carries entries, several things stop being editable — not as a policy
   * choice but because changing them would restate history that has already been reported.
   * The server refuses all of these; the form disables them so nobody types into a field that
   * is going to be rejected.
   */
  const hasMovement = Boolean(
    existing && Math.abs(existing.naturalBalance) > 0.005,
  );
  const lockedByHistory = Boolean(existing) && hasMovement;
  const isEngineAccount = Boolean(existing?.isSystem);

  // Suggest a code when creating, and only until the user types their own.
  useEffect(() => {
    if (existing || codeTouched || !accountType || values.code) return;
    let cancelled = false;
    financeService
      .suggestCode(accountType)
      .then((code) => {
        if (!cancelled) onChange({ ...values, code });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountType, existing, codeTouched]);

  return (
    <>
      <div className={styles.formGroup}>
        <label htmlFor="groupId">Group *</label>
        <select
          id="groupId"
          className={styles.select}
          value={values.groupId}
          disabled={disabled || (isEngineAccount && !!existing)}
          onChange={(e) => set('groupId', e.target.value)}
          required
        >
          <option value="">Choose a group…</option>
          {groups
            .filter((g) => g.isActive)
            .map((g) => (
              <option key={g._id} value={g._id}>
                {' '.repeat((g.depth - 1) * 3)}
                {g.code} · {g.name}
              </option>
            ))}
        </select>
        <p className={styles.hint}>
          The group decides the account type, and the type decides which statement this account
          appears on and which way its balance signs. It is not chosen separately.
        </p>
        {isEngineAccount && (
          <p className={finance.readonlyNote}>
            This account is used by the posting engine, so it must keep its type. You can still
            rename and re-code it.
          </p>
        )}
        {lockedByHistory && !isEngineAccount && (
          <p className={finance.readonlyNote}>
            This account has entries posted to it, so it can only move to another group of the
            same type.
          </p>
        )}
      </div>

      {accountType && (
        <div className={styles.formGroup}>
          <span className={finance.readonlyNote} style={{ marginTop: 0 }}>
            Type:{' '}
            <span className={`${finance.typeChip} ${finance[`type_${accountType}`]}`}>
              {accountType}
            </span>{' '}
            · normal balance {accountType === 'asset' || accountType === 'expense' ? 'Debit' : 'Credit'}{' '}
            · codes {CODE_BLOCK_HINT[accountType]}
          </span>
        </div>
      )}

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="name">Account name *</label>
          <input
            id="name"
            type="text"
            className={styles.input}
            value={values.name}
            disabled={disabled}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Bank — Meezan Current"
            required
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            className={styles.input}
            value={values.code}
            disabled={disabled}
            onChange={(e) => {
              setCodeTouched(true);
              set('code', e.target.value.replace(/[^\d]/g, '').slice(0, 4));
            }}
            placeholder="1110"
          />
          <p className={styles.hint}>
            Four digits, inside the block for this type. Left blank, the next free code is
            allocated — they step by ten so accounts can be inserted later.
          </p>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="description">Notes</label>
        <textarea
          id="description"
          className={styles.textarea}
          value={values.description}
          disabled={disabled}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What belongs in this account, and what does not."
          maxLength={500}
        />
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="openingAmount">Opening balance</label>
          <input
            id="openingAmount"
            type="number"
            step="0.01"
            className={styles.input}
            value={values.openingAmount}
            disabled={disabled || lockedByHistory}
            onChange={(e) => set('openingAmount', e.target.value)}
            placeholder="0.00"
          />
          <p className={styles.hint}>
            Recorded on the account. It posts nothing on its own — the opening journal entry is
            raised at cutover.
          </p>
          {lockedByHistory && (
            <p className={finance.readonlyNote}>
              Locked: this account has entries. Correct an opening balance with a journal entry
              so the change is visible in the account history.
            </p>
          )}
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="openingAsOf">Opening balance is true as of</label>
          <input
            id="openingAsOf"
            type="date"
            className={styles.input}
            value={values.openingAsOf}
            disabled={disabled || lockedByHistory}
            onChange={(e) => set('openingAsOf', e.target.value)}
          />
          <p className={styles.hint}>
            Without a date, no balance-as-at report can tell whether an entry predates this
            figure.
          </p>
        </div>
      </div>

      <div className={styles.checkboxGroup}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={values.isCashEquivalent}
            disabled={disabled}
            onChange={(e) => set('isCashEquivalent', e.target.checked)}
          />
          Counts as cash in the Cash Flow statement
        </label>
        <p className={styles.hint}>
          Cash and bank accounts only. A cheque is not money until it clears, so cheque accounts
          are deliberately left out.
        </p>
      </div>

      <div className={styles.checkboxGroup}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={values.isControl}
            disabled={disabled || lockedByHistory}
            onChange={(e) =>
              onChange({
                ...values,
                isControl: e.target.checked,
                subledgerType: e.target.checked ? values.subledgerType : '',
              })
            }
          />
          Control account
        </label>
        <p className={styles.hint}>
          Holds the total of a subledger — what every shop owes, what every rider is carrying.
          Manual journal entries can never post to a control account, which is what keeps it
          agreeing with the module it mirrors.
        </p>
        {lockedByHistory && (
          <p className={finance.readonlyNote}>
            Locked: this account already has entries, and those entries carry no subledger.
          </p>
        )}
      </div>

      {values.isControl && (
        <div className={styles.formGroup}>
          <label htmlFor="subledgerType">Subledger *</label>
          <select
            id="subledgerType"
            className={styles.select}
            value={values.subledgerType}
            disabled={disabled || lockedByHistory}
            onChange={(e) => set('subledgerType', e.target.value as SubledgerType | '')}
            required
          >
            <option value="">Choose what it is broken down by…</option>
            {SUBLEDGER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SUBLEDGER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
};

export default LedgerForm;
