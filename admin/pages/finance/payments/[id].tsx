import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import PaymentForm, {
  PaymentFormValues,
  paymentToPayload,
  paymentTotals,
} from '../../../components/Finance/PaymentForm';
import { money } from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import {
  financeService,
  paymentService,
  vendorService,
  Ledger,
  PaymentDetail,
  PAYMENT_METHOD_LABELS,
  Vendor,
} from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

/**
 * One payment: edited while it is being prepared, read-only once released.
 *
 * Releasing is the moment money is recorded as gone, so the confirmation spells out every figure
 * the person releasing should have checked — the supplier, the amount, where it came from, and
 * what it settles — rather than asking whether they are sure.
 */

function paymentToForm(payment: PaymentDetail): PaymentFormValues {
  return {
    vendorId: payment.vendorId,
    paymentDate: payment.paymentDate.slice(0, 10),
    method: payment.method,
    paidFromLedgerId: payment.paidFromLedgerId,
    chequeNo: payment.chequeNo ?? '',
    chequeDate: payment.chequeDate ? payment.chequeDate.slice(0, 10) : '',
    transferReference: payment.transferReference ?? '',
    amount: String(payment.amount),
    allocated: Object.fromEntries(payment.allocations.map((a) => [a.billId, String(a.amount)])),
    notes: payment.notes ?? '',
  };
}

const PaymentPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [values, setValues] = useState<PaymentFormValues | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const detail = await paymentService.get(id);
      setPayment(detail);
      setValues(paymentToForm(detail));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this payment');
      router.push('/finance/payments');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    vendorService
      .list({ status: 'all' })
      .then((all) => setVendors(all.filter((v) => !v.isPlaceholder)))
      .catch(() => undefined);
    financeService
      .getLedgers({ isCashEquivalent: true, status: 'active' })
      .then((all) => setAccounts(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof id !== 'string' || !values) return;

    setBusy(true);
    try {
      const updated = await paymentService.update(id, paymentToPayload(values));
      setPayment(updated);
      setValues(paymentToForm(updated));
      toast.success('Payment saved');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this payment');
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    if (typeof id !== 'string' || !payment) return;

    const instrument = payment.method === 'cheque'
      ? `Cheque ${payment.chequeNo}, drawn on ${payment.paidFromName}`
      : `${PAYMENT_METHOD_LABELS[payment.method]} from ${payment.paidFromName}`;
    const settles = payment.allocations.length
      ? payment.allocations
        .map((a) => `  ${a.reference}${a.supplierBillNo ? ` (${a.supplierBillNo})` : ''}: ${money(a.amount)}`)
        .join('\n')
      : '  No bills — all of it on account';

    // Built from what was SAVED, not from the form, so an unsaved edit cannot be released under
    // a confirmation that shows figures the server has never seen.
    if (
      !window.confirm(
        `Release this payment?\n\n`
          + `To: ${payment.vendorName}\n`
          + `Amount: ${money(payment.amount)}\n`
          + `${instrument}\n\n`
          + `Settles:\n${settles}\n`
          + `${payment.unallocatedAmount > 0.005 ? `On account: ${money(payment.unallocatedAmount)}\n` : ''}`
          + '\nFrom here it can be cancelled, which reverses it. It cannot be deleted.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const posted = await paymentService.post(id);
      setPayment(posted);
      setValues(paymentToForm(posted));
      toast.success(`${posted.reference} released`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not release this payment');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (typeof id !== 'string' || !payment) return;

    const reason = window.prompt(
      `Cancel ${payment.reference} and reverse it out of the accounts?\n\n`
        + 'The bills it settled become unpaid again. Say why — it stays on the record.',
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say why this payment is being cancelled');
      return;
    }

    setBusy(true);
    try {
      const cancelled = await paymentService.cancel(id, reason.trim());
      setPayment(cancelled);
      toast.success(`${cancelled.reference} cancelled and reversed`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not cancel this payment');
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (typeof id !== 'string') return;
    if (!window.confirm('Delete this prepared payment? It has never reached the accounts.')) return;

    setBusy(true);
    try {
      await paymentService.remove(id);
      toast.success('Prepared payment deleted');
      router.push('/finance/payments');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this payment');
      setBusy(false);
    }
  };

  if (loading || !payment || !values) {
    return (
      <Layout>
        <div className={styles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  const isDraft = payment.status === 'draft';
  const totals = paymentTotals(values);
  // The saved figures and the form's figures disagree until "Save" is pressed.
  const unsaved = JSON.stringify(paymentToPayload(values))
    !== JSON.stringify(paymentToPayload(paymentToForm(payment)));

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            {payment.reference} · {payment.vendorName}
          </h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/payments')}>
            &larr; Back
          </button>
        </div>

        {payment.status === 'posted' && (
          <div className={`${finance.banner} ${finance.bannerOk}`}>
            <span className={finance.bannerTitle}>Released</span>
            {money(payment.amount)} paid to {payment.vendorName}.{' '}
            {payment.journalEntryId && (
              <a href={`/finance/journal/${payment.journalEntryId}`}>See the entry it wrote</a>
            )}
            {payment.method === 'cheque' && (
              <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
                Held as an uncleared cheque. The bank balance moves when it clears on the
                statement, not before.
              </p>
            )}
          </div>
        )}

        {payment.status === 'cancelled' && (
          <div className={`${finance.banner} ${finance.bannerBad}`}>
            <span className={finance.bannerTitle}>Cancelled</span>
            {payment.cancelReason || 'No reason was recorded.'}
            <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
              Its entry has been reversed and the bills it settled are unpaid again.
            </p>
          </div>
        )}

        {isDraft && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Prepared, not released</span>
            Nothing has left the accounts and no payment number has been used.
            {!can(undefined, 'finance-payments:change')
              && ' Somebody allowed to release payments needs to check and release it.'}
          </div>
        )}

        {isDraft ? (
          <form className={styles.form} onSubmit={save}>
            <PaymentForm
              values={values}
              onChange={setValues}
              vendors={vendors}
              accounts={accounts}
              disabled={busy}
              paymentId={payment.id}
            />

            <div className={styles.formActions}>
              {can(undefined, 'finance-payments:delete') && (
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={discard}
                  disabled={busy}
                >
                  Delete
                </button>
              )}
              {can(undefined, 'finance-payments:edit') && (
                <button type="submit" className={styles.cancelButton} disabled={busy}>
                  Save
                </button>
              )}
              {can(undefined, 'finance-payments:change') && (
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={release}
                  disabled={busy || unsaved || totals.amount <= 0}
                  title={unsaved ? 'Save your changes before releasing' : undefined}
                >
                  {busy ? 'Working…' : `Release · ${money(payment.amount)}`}
                </button>
              )}
            </div>
            {unsaved && can(undefined, 'finance-payments:change') && (
              <p className={finance.readonlyNote}>
                Save your changes first — a payment is released exactly as it was last saved.
              </p>
            )}
          </form>
        ) : (
          <ReadOnlyPayment payment={payment} />
        )}

        {payment.status === 'posted' && can(undefined, 'finance-reversal:change') && (
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={cancel}
              disabled={busy}
              style={{ color: '#b91c1c' }}
            >
              Cancel &amp; Reverse This Payment
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
};

const ReadOnlyPayment: React.FC<{ payment: PaymentDetail }> = ({ payment }) => (
  <>
    <div className={finance.settingsGrid}>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Paid on</span>
        <span className={finance.settingValue}>
          {new Date(payment.paymentDate).toLocaleDateString('en-PK')}
        </span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>How</span>
        <span className={finance.settingValue}>
          {payment.method === 'cheque'
            ? `Cheque ${payment.chequeNo}`
            : PAYMENT_METHOD_LABELS[payment.method]}
        </span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>
          {payment.method === 'cheque' ? 'Drawn on' : 'From'}
        </span>
        <span className={finance.settingValue}>{payment.paidFromName}</span>
      </div>
      {payment.transferReference && (
        <div className={finance.settingCard}>
          <span className={finance.settingLabel}>Reference</span>
          <span className={finance.settingValue}>{payment.transferReference}</span>
        </div>
      )}
    </div>

    <div className={finance.panel}>
      <h2 className={finance.panelTitle}>What it settled</h2>
      {payment.allocations.length === 0 ? (
        <p className={finance.readonlyNote} style={{ margin: 0 }}>
          No bills — the whole payment is held on account against this supplier.
        </p>
      ) : (
        <table className={finance.roleTable}>
          <thead>
            <tr>
              <th>Bill</th>
              <th>Their invoice</th>
              <th>Dated</th>
              <th style={{ textAlign: 'right' }}>Bill total</th>
              <th style={{ textAlign: 'right' }}>Paid by this</th>
            </tr>
          </thead>
          <tbody>
            {payment.allocations.map((a) => (
              <tr key={a.billId}>
                <td>
                  <a className={finance.code} href={`/finance/bills/${a.billId}`}>
                    {a.reference}
                  </a>
                </td>
                <td className={finance.muted}>{a.supplierBillNo || '—'}</td>
                <td>{a.billDate ? new Date(a.billDate).toLocaleDateString('en-PK') : '—'}</td>
                <td className={finance.amount}>{money(a.billTotal)}</td>
                <td className={finance.amount}>{money(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>

    <div className={finance.totalsBar}>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Paid</span>
        <span className={finance.totalsValue}>{money(payment.amount)}</span>
      </div>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Set against bills</span>
        <span className={finance.totalsValue}>{money(payment.allocatedAmount)}</span>
      </div>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>On account</span>
        <span className={finance.totalsValue}>{money(payment.unallocatedAmount)}</span>
      </div>
    </div>

    {payment.notes && <p className={finance.readonlyNote}>{payment.notes}</p>}
  </>
);

export default function PaymentPageWrapper() {
  return (
    <ProtectedRoute permission="finance-payments:view">
      <PaymentPage />
    </ProtectedRoute>
  );
}
