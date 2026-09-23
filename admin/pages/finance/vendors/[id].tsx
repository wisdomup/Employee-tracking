import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import VendorForm, {
  EMPTY_VENDOR_FORM,
  VendorFormValues,
  vendorToForm,
} from '../../../components/Finance/VendorForm';
import { buildPayload } from './create';
import { can } from '../../../utils/permissions';
import { financeService, vendorService, Ledger, Vendor } from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

/**
 * One supplier's record.
 *
 * Opens for anyone who may see the supplier LIST, not only for whoever may change it: the list
 * rows are clickable, so gating this page on `edit` sent every view-only user to the dashboard
 * from a link the same page had just offered them. Without `edit` the form is shown disabled and
 * the save button is gone — a refusal after the click teaches people to distrust the list.
 */
const EditVendorPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const canEdit = can(undefined, 'finance-vendors:edit');

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [values, setValues] = useState<VendorFormValues>(EMPTY_VENDOR_FORM);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const [data, all] = await Promise.all([
        vendorService.get(id),
        financeService.getLedgers({ accountType: 'expense', status: 'active' }),
      ]);
      setVendor(data);
      setValues(vendorToForm(data));
      setLedgers(all.filter((l) => !l.isControl));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this supplier');
      router.push('/finance/vendors');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof id !== 'string' || !canEdit) return;
    if (values.name.trim().length < 2) {
      toast.error('Give the supplier a name');
      return;
    }

    setSaving(true);
    try {
      await vendorService.update(id, buildPayload(values));
      toast.success('Supplier saved');
      router.push('/finance/vendors');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this supplier');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !vendor) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            <span className={finance.code}>{vendor.reference}</span> {vendor.name}
          </h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/vendors')}>
            &larr; Back
          </button>
        </div>

        {vendor.isPlaceholder && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>This is the holding record</span>
            Goods receipts whose supplier could not be identified are filed here.
            {/* Gated on `change`, which is what the clean-up screen itself requires. An
                ungated link here bounces anyone holding only `view` or `edit`. */}
            {can(undefined, 'finance-vendors:change') ? (
              <>
                {' '}Move them across from{' '}
                <Link href="/finance/vendors/cleanup">Match Typed Names</Link> as they are
                recognised.
              </>
            ) : (
              ' They are moved across on the Match Typed Names screen as they are recognised.'
            )}
            {' '}It is meant to empty.
          </div>
        )}

        {!canEdit && (
          <p className={finance.readonlyNote}>
            You can see this supplier but not change it. Editing a supplier needs the Suppliers
            edit permission.
          </p>
        )}

        <form className={styles.form} onSubmit={submit}>
          <VendorForm
            values={values}
            onChange={setValues}
            ledgers={ledgers}
            disabled={saving || !canEdit}
            existing={vendor}
          />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/vendors')}
            >
              {canEdit ? 'Cancel' : 'Back to Suppliers'}
            </button>
            {canEdit && (
              <button type="submit" className={styles.submitButton} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditVendorPageWrapper() {
  return (
    <ProtectedRoute permission="finance-vendors:view">
      <EditVendorPage />
    </ProtectedRoute>
  );
}
