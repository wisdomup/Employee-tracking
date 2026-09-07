import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import VendorForm, {
  EMPTY_VENDOR_FORM,
  VendorFormValues,
} from '../../../components/Finance/VendorForm';
import { financeService, vendorService, Ledger } from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';

const CreateVendorPage: React.FC = () => {
  const router = useRouter();
  const [values, setValues] = useState<VendorFormValues>(EMPTY_VENDOR_FORM);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    financeService
      .getLedgers({ accountType: 'expense', status: 'active' })
      // A control account is posted to by the module that owns it, never chosen as a default.
      .then((all) => setLedgers(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (values.name.trim().length < 2) {
      toast.error('Give the supplier a name');
      return;
    }

    setSaving(true);
    try {
      const created = await vendorService.create(buildPayload(values));
      toast.success(`${created.reference} · ${created.name} added`);
      router.push('/finance/vendors');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not add this supplier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>New Supplier</h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/vendors')}>
            &larr; Back
          </button>
        </div>

        <form className={styles.form} onSubmit={submit}>
          <VendorForm values={values} onChange={setValues} ledgers={ledgers} disabled={saving} />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/vendors')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Adding…' : 'Add Supplier'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

/** Empty strings become absent rather than blank values the API would store as "". */
export function buildPayload(v: VendorFormValues): Record<string, unknown> {
  return {
    name: v.name.trim(),
    phone: v.phone.trim() || undefined,
    email: v.email.trim() || undefined,
    address: v.city.trim() ? { city: v.city.trim() } : undefined,
    taxRegistrationNo: v.taxRegistrationNo.trim() || undefined,
    paymentTermsDays: v.paymentTermsDays ? Number(v.paymentTermsDays) : undefined,
    defaultExpenseLedgerId: v.defaultExpenseLedgerId || null,
    openingBalance: v.openingAmount
      ? { amount: Number(v.openingAmount), asOf: v.openingAsOf || null }
      : undefined,
    notes: v.notes.trim() || undefined,
  };
}

export default function CreateVendorPageWrapper() {
  return (
    <ProtectedRoute permission="finance-vendors:add">
      <CreateVendorPage />
    </ProtectedRoute>
  );
}
