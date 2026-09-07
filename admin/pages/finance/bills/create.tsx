import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import BillForm, {
  EMPTY_BILL_FORM,
  BillFormValues,
  billToPayload,
  billTotals,
  money,
} from '../../../components/Finance/BillForm';
import {
  billService,
  financeService,
  vendorService,
  Ledger,
  Vendor,
} from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

const CreateBillPage: React.FC = () => {
  const router = useRouter();
  const [values, setValues] = useState<BillFormValues>(EMPTY_BILL_FORM);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    vendorService
      .list({ status: 'active' })
      // The holding record is not a supplier — it is where receipts nobody could identify are
      // parked, and billing it would attach a real debt to the words "not identified".
      .then((all) => setVendors(all.filter((v) => !v.isPlaceholder)))
      .catch(() => undefined);

    financeService
      .getLedgers({ accountType: 'expense', status: 'active' })
      // Goods reach inventory through the matched receipts, which is the path that carries a
      // warehouse with it. A charge line has none, so control accounts are not offered.
      .then((all) => setLedgers(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  const totals = billTotals(values);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!values.vendorId) {
      toast.error('Choose a supplier');
      return;
    }
    if (totals.total <= 0) {
      toast.error('A bill has to be for something — tick a delivery or add a charge');
      return;
    }

    setSaving(true);
    try {
      const created = await billService.create(billToPayload(values));
      toast.success(`Bill from ${created.vendorName} saved as a draft`);
      router.push(`/finance/bills/${created.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not record this bill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Record a Supplier Bill</h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/bills')}>
            &larr; Back
          </button>
        </div>

        <div className={`${finance.banner} ${finance.bannerInfo}`}>
          <span className={finance.bannerTitle}>This saves a draft</span>
          Nothing reaches the accounts until the bill is posted, which is a separate step on the
          next screen. A draft carries no bill number either — the series starts at posting, so an
          abandoned draft leaves no gap in it.
        </div>

        <form className={styles.form} onSubmit={submit}>
          <BillForm
            values={values}
            onChange={setValues}
            vendors={vendors}
            ledgers={ledgers}
            disabled={saving}
          />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/bills')}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Saving…' : `Save Draft · ${money(totals.total)}`}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateBillPageWrapper() {
  return (
    <ProtectedRoute permission="finance-bills:add">
      <CreateBillPage />
    </ProtectedRoute>
  );
}
