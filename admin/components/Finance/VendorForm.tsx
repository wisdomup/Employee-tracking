import React from 'react';
import { Ledger, Vendor } from '../../services/financeService';
import styles from '../../styles/FormPage.module.scss';
import finance from '../../styles/Finance.module.scss';

/**
 * The supplier form, shared by create and edit.
 *
 * Only the name is required. A supplier is often created mid-task — somebody is recording a
 * delivery and the company is not on the list — and demanding a tax number and payment terms in
 * that moment is how people start typing "x" into fields to get past them.
 */

export interface VendorFormValues {
  name: string;
  phone: string;
  email: string;
  city: string;
  taxRegistrationNo: string;
  paymentTermsDays: string;
  defaultExpenseLedgerId: string;
  openingAmount: string;
  openingAsOf: string;
  notes: string;
}

export const EMPTY_VENDOR_FORM: VendorFormValues = {
  name: '',
  phone: '',
  email: '',
  city: '',
  taxRegistrationNo: '',
  paymentTermsDays: '',
  defaultExpenseLedgerId: '',
  openingAmount: '',
  openingAsOf: '',
  notes: '',
};

export function vendorToForm(vendor: Vendor & { address?: { city?: string } }): VendorFormValues {
  return {
    name: vendor.name,
    phone: vendor.phone ?? '',
    email: vendor.email ?? '',
    city: vendor.address?.city ?? '',
    taxRegistrationNo: vendor.taxRegistrationNo ?? '',
    paymentTermsDays: vendor.paymentTermsDays ? String(vendor.paymentTermsDays) : '',
    defaultExpenseLedgerId: '',
    openingAmount: vendor.openingBalance.amount ? String(vendor.openingBalance.amount) : '',
    openingAsOf: vendor.openingBalance.asOf ? vendor.openingBalance.asOf.slice(0, 10) : '',
    notes: vendor.notes ?? '',
  };
}

interface Props {
  values: VendorFormValues;
  onChange: (next: VendorFormValues) => void;
  /** Expense accounts only — a control account is posted to by its own module. */
  ledgers: Ledger[];
  disabled?: boolean;
  /** Present when editing. Drives the note about receipts already recorded. */
  existing?: Vendor | null;
}

const VendorForm: React.FC<Props> = ({ values, onChange, ledgers, disabled, existing }) => {
  const set = <K extends keyof VendorFormValues>(key: K, value: VendorFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <>
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="name">Supplier name *</label>
          <input
            id="name"
            type="text"
            className={styles.input}
            value={values.name}
            disabled={disabled}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Acme Traders"
            required
          />
          <p className={styles.hint}>
            Names are unique whatever the casing — the whole point of this list is that one
            supplier stops existing under four spellings.
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            type="text"
            className={styles.input}
            value={values.phone}
            disabled={disabled}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className={styles.input}
            value={values.email}
            disabled={disabled}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="city">City</label>
          <input
            id="city"
            type="text"
            className={styles.input}
            value={values.city}
            disabled={disabled}
            onChange={(e) => set('city', e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="taxRegistrationNo">Tax number (NTN / STRN)</label>
          <input
            id="taxRegistrationNo"
            type="text"
            className={styles.input}
            value={values.taxRegistrationNo}
            disabled={disabled}
            onChange={(e) => set('taxRegistrationNo', e.target.value)}
          />
          <p className={styles.hint}>Needed on the purchase side of any tax return.</p>
        </div>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="paymentTermsDays">Payment terms</label>
          <input
            id="paymentTermsDays"
            type="number"
            min="0"
            max="365"
            className={styles.input}
            value={values.paymentTermsDays}
            disabled={disabled}
            onChange={(e) => set('paymentTermsDays', e.target.value)}
            placeholder="0"
          />
          <p className={styles.hint}>
            Days from a bill's date until it is due. Leave blank or zero for payable on receipt,
            which is what most cash purchases are.
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="defaultExpenseLedgerId">Usual account</label>
          <select
            id="defaultExpenseLedgerId"
            className={styles.select}
            value={values.defaultExpenseLedgerId}
            disabled={disabled}
            onChange={(e) => set('defaultExpenseLedgerId', e.target.value)}
          >
            <option value="">None</option>
            {ledgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            Pre-fills bill lines for a supplier who always sells the same kind of thing.
          </p>
        </div>
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="openingAmount">Owed to them when the books opened</label>
          <input
            id="openingAmount"
            type="number"
            step="0.01"
            className={styles.input}
            value={values.openingAmount}
            disabled={disabled}
            onChange={(e) => set('openingAmount', e.target.value)}
            placeholder="0.00"
          />
          <p className={styles.hint}>
            Recorded here so the supplier record is complete. It posts nothing on its own — the
            opening journal entry at changeover does that.
          </p>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="openingAsOf">As at</label>
          <input
            id="openingAsOf"
            type="date"
            className={styles.input}
            value={values.openingAsOf}
            disabled={disabled}
            onChange={(e) => set('openingAsOf', e.target.value)}
          />
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

      {existing && existing.mergedFromNames.length > 0 && (
        <div className={`${finance.banner} ${finance.bannerInfo}`}>
          <span className={finance.bannerTitle}>Also written as</span>
          {existing.mergedFromNames.join(' · ')}
          <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
            These are the names typed on goods receipts that were matched to this supplier. The
            receipts still show what was actually typed.
          </p>
        </div>
      )}

      {existing && existing.receiptCount > 0 && (
        <p className={finance.readonlyNote}>
          {existing.receiptCount} goods receipt{existing.receiptCount === 1 ? '' : 's'} name this
          supplier, so it can no longer be deleted — retire it instead if you stop buying from
          them.
        </p>
      )}
    </>
  );
};

export default VendorForm;
