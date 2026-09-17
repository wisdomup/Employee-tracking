import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import VoucherForm, {
  EMPTY_VOUCHER_FORM,
  ShopOption,
  validateVoucher,
  VoucherFormValues,
  voucherToPayload,
} from '../../../components/Finance/VoucherForm';
import {
  financeService,
  voucherService,
  Ledger,
} from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

/**
 * Raising a voucher.
 *
 * Saving and submitting are separate buttons on purpose. A voucher is submitted exactly as it was
 * saved, and the person approving it is reading a document, not watching a form.
 */

const CreateVoucherPage: React.FC = () => {
  const router = useRouter();
  const [values, setValues] = useState<VoucherFormValues>(EMPTY_VOUCHER_FORM);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    financeService
      .getLedgers({ status: 'active' })
      .then(setAccounts)
      .catch(() => undefined);
    voucherService
      .shops()
      .then((list) => setShops(list.map((s) => ({ id: s.id, label: s.shopName || s.name }))))
      .catch(() => undefined);
  }, []);

  const save = async (andSubmit: boolean) => {
    const problem = validateVoucher(values);
    if (problem) {
      toast.error(problem);
      return;
    }

    setSaving(true);
    try {
      const created = await voucherService.create(voucherToPayload(values));
      if (!andSubmit) {
        toast.success('Voucher saved as a draft');
        router.push(`/finance/vouchers/${created.id}`);
        return;
      }

      await voucherService.submit(created.id);
      toast.success('Submitted — waiting for approval');
      router.push(`/finance/vouchers/${created.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this voucher');
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Raise a Voucher</h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/vouchers')}>
            &larr; Back
          </button>
        </div>

        <div className={`${finance.banner} ${finance.bannerInfo}`}>
          <span className={finance.bannerTitle}>Nothing posts from this screen</span>
          A voucher is raised here, approved by somebody else, and posted after that. It gets its
          number when it posts.
        </div>

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
        >
          <VoucherForm
            values={values}
            onChange={setValues}
            accounts={accounts}
            shops={shops}
            disabled={saving}
          />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/vouchers')}
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
              {saving ? 'Saving…' : 'Submit for Approval'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateVoucherPageWrapper() {
  return (
    <ProtectedRoute permission="finance-vouchers:add">
      <CreateVoucherPage />
    </ProtectedRoute>
  );
}
