import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import PaymentForm, {
  EMPTY_PAYMENT_FORM,
  PaymentFormValues,
  paymentToPayload,
  paymentTotals,
} from '../../../components/Finance/PaymentForm';
import { money } from '../../../components/Finance/BillForm';
import {
  financeService,
  paymentService,
  vendorService,
  Ledger,
  Vendor,
} from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

const CreatePaymentPage: React.FC = () => {
  const router = useRouter();
  const [values, setValues] = useState<PaymentFormValues>(EMPTY_PAYMENT_FORM);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [saving, setSaving] = useState(false);
  const [preselectBillId, setPreselectBillId] = useState<string | undefined>();

  // Arriving from a bill's "Pay this bill" button carries the supplier and the bill.
  useEffect(() => {
    if (!router.isReady) return;
    const { vendorId, billId } = router.query;
    if (typeof vendorId === 'string') {
      setValues((v) => ({ ...v, vendorId }));
    }
    if (typeof billId === 'string') setPreselectBillId(billId);
  }, [router.isReady, router.query]);

  useEffect(() => {
    vendorService
      .list({ status: 'all' })
      // Money cannot be paid to "not identified", so the holding record is not offered.
      .then((all) => setVendors(all.filter((v) => !v.isPlaceholder)))
      .catch(() => undefined);

    financeService
      .getLedgers({ isCashEquivalent: true, status: 'active' })
      // Rider cash and collections in transit belong to their own modules. Paying a supplier out
      // of them would make a rider look short with nothing in that module to explain it.
      .then((all) => setAccounts(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  const totals = paymentTotals(values);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!values.vendorId) {
      toast.error('Choose a supplier');
      return;
    }
    if (!values.paidFromLedgerId) {
      toast.error('Choose the account the money comes out of');
      return;
    }
    if (totals.amount <= 0) {
      toast.error('Enter how much is being paid');
      return;
    }
    if (values.method === 'cheque' && !values.chequeNo.trim()) {
      toast.error('A cheque needs its cheque number');
      return;
    }
    if (totals.onAccount < -0.005) {
      toast.error('The bills ticked add up to more than the payment');
      return;
    }

    setSaving(true);
    try {
      const created = await paymentService.create(paymentToPayload(values));
      toast.success(`Payment to ${created.vendorName} prepared`);
      router.push(`/finance/payments/${created.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not prepare this payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Prepare a Supplier Payment</h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/payments')}>
            &larr; Back
          </button>
        </div>

        <div className={`${finance.banner} ${finance.bannerInfo}`}>
          <span className={finance.bannerTitle}>This prepares the payment — it does not release it</span>
          Nothing leaves the accounts until the payment is released on the next screen, often by a
          different person. Record the payment after the money has actually gone, or release it
          only once it has.
        </div>

        <form className={styles.form} onSubmit={submit}>
          <PaymentForm
            values={values}
            onChange={setValues}
            vendors={vendors}
            accounts={accounts}
            disabled={saving}
            preselectBillId={preselectBillId}
          />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/payments')}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Saving…' : `Prepare · ${money(totals.amount)}`}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreatePaymentPageWrapper() {
  return (
    <ProtectedRoute permission="finance-payments:add">
      <CreatePaymentPage />
    </ProtectedRoute>
  );
}
