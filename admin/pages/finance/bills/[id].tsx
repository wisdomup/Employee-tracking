import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import BillForm, {
  BillFormValues,
  billToPayload,
  billTotals,
  money,
} from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import {
  billService,
  financeService,
  vendorService,
  BillDetail,
  BILL_PAYMENT_STATUS_LABELS,
  Ledger,
  PAYMENT_METHOD_LABELS,
  Vendor,
} from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

/**
 * One bill: edited while it is a draft, read-only once it is posted.
 *
 * A posted bill is deliberately not editable. It is a record of a piece of paper somebody sent
 * us, and quietly rewriting one because a figure was typed wrong is how a payment run pays an
 * amount nobody approved. The correction is a cancellation and a fresh bill, so both survive.
 */

function billToForm(bill: BillDetail): BillFormValues {
  return {
    vendorId: bill.vendorId,
    supplierBillNo: bill.supplierBillNo ?? '',
    billDate: bill.billDate.slice(0, 10),
    dueDate: bill.dueDate.slice(0, 10),
    matched: Object.fromEntries(
      bill.matchedReceipts.map((m) => [m.receiptId, String(m.amount)]),
    ),
    lines: bill.lines.map((l) => ({
      description: l.description,
      ledgerId: l.ledgerId,
      amount: String(l.amount),
    })),
    taxAmount: bill.taxAmount ? String(bill.taxAmount) : '',
    notes: bill.notes ?? '',
  };
}

const BillPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [bill, setBill] = useState<BillDetail | null>(null);
  const [values, setValues] = useState<BillFormValues | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const detail = await billService.get(id);
      setBill(detail);
      setValues(billToForm(detail));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this bill');
      router.push('/finance/bills');
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
      .getLedgers({ accountType: 'expense', status: 'active' })
      .then((all) => setLedgers(all.filter((l) => !l.isControl)))
      .catch(() => undefined);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof id !== 'string' || !values) return;

    setBusy(true);
    try {
      const updated = await billService.update(id, billToPayload(values));
      setBill(updated);
      setValues(billToForm(updated));
      toast.success('Draft saved');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this bill');
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (typeof id !== 'string' || !bill || !values) return;

    const totals = billTotals(values);
    /*
     * The confirmation names the figures rather than asking a vague "are you sure?".
     *
     * What is about to happen is irreversible in the only sense that matters: the entry it
     * writes can be reversed but never deleted. Saying what will be recorded, and against whom,
     * is the last point at which a wrong supplier is catchable by reading.
     */
    if (
      !window.confirm(
        `Post this bill to the accounts?\n\n`
          + `Supplier: ${bill.vendorName}\n`
          + `${bill.supplierBillNo ? `Their invoice: ${bill.supplierBillNo}\n` : ''}`
          + `Goods: ${money(totals.goods)}\n`
          + `Charges: ${money(totals.charges)}\n`
          + `Tax: ${money(totals.tax)}\n`
          + `Total owed to them: ${money(totals.total)}\n\n`
          + 'From here it can be cancelled, which reverses it. It cannot be deleted.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const posted = await billService.post(id);
      setBill(posted);
      setValues(billToForm(posted));
      toast.success(`${posted.reference} posted`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not post this bill');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (typeof id !== 'string' || !bill) return;

    const reason = window.prompt(
      `Cancel ${bill.reference} and reverse it out of the accounts?\n\n`
        + 'The goods on it become billable again. Say why — it stays on the record.',
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say why this bill is being cancelled');
      return;
    }

    setBusy(true);
    try {
      const cancelled = await billService.cancel(id, reason.trim());
      setBill(cancelled);
      toast.success(`${cancelled.reference} cancelled and reversed`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not cancel this bill');
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (typeof id !== 'string' || !bill) return;
    if (!window.confirm('Delete this draft? It has never reached the accounts.')) return;

    setBusy(true);
    try {
      await billService.remove(id);
      toast.success('Draft deleted');
      router.push('/finance/bills');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this draft');
      setBusy(false);
    }
  };

  if (loading || !bill || !values) {
    return (
      <Layout>
        <div className={styles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  const isDraft = bill.status === 'draft';
  const isPosted = bill.status === 'posted';
  const totals = billTotals(values);
  const hasPayments = bill.paidAmount > 0;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            {bill.reference} · {bill.vendorName}
          </h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/bills')}>
            &larr; Back
          </button>
        </div>

        {isPosted && (
          <div
            className={`${finance.banner} ${
              bill.isOverdue ? finance.bannerBad : finance.bannerOk
            }`}
          >
            <span className={finance.bannerTitle}>
              {bill.paymentStatus === 'paid'
                ? 'Posted, and paid in full'
                : bill.isOverdue
                  ? 'Posted, and past due'
                  : 'Posted to the accounts'}
            </span>
            {bill.paymentStatus === 'paid' ? (
              <>Nothing more is owed on this bill. </>
            ) : (
              <>
                {money(bill.outstanding)} still owed to {bill.vendorName}, due{' '}
                {new Date(bill.dueDate).toLocaleDateString('en-PK')}.{' '}
              </>
            )}
            {bill.journalEntryId && (
              <a href={`/finance/journal/${bill.journalEntryId}`}>See the entry it wrote</a>
            )}
            <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
              A posted bill is not edited. If something on it is wrong, cancel it and record the
              corrected one — that way both the original and the correction stay on the record.
            </p>
          </div>
        )}

        {bill.status === 'cancelled' && (
          <div className={`${finance.banner} ${finance.bannerBad}`}>
            <span className={finance.bannerTitle}>Cancelled</span>
            {bill.cancelReason || 'No reason was recorded.'}
            <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
              Its entry has been reversed and the goods on it are billable again. The document
              stays here so the reversal has something to point at.
            </p>
          </div>
        )}

        {isDraft && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Still a draft</span>
            Nothing has reached the accounts and no bill number has been used. Post it when the
            figures match the invoice in front of you.
          </div>
        )}

        {isDraft ? (
          <form className={styles.form} onSubmit={save}>
            <BillForm
              values={values}
              onChange={setValues}
              vendors={vendors}
              ledgers={ledgers}
              disabled={busy}
              billId={bill.id}
            />

            <div className={styles.formActions}>
              {can(undefined, 'finance-bills:delete') && (
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={discard}
                  disabled={busy}
                >
                  Delete Draft
                </button>
              )}
              {can(undefined, 'finance-bills:edit') && (
                <button type="submit" className={styles.cancelButton} disabled={busy}>
                  Save Draft
                </button>
              )}
              {can(undefined, 'finance-bills:change') && (
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={post}
                  disabled={busy || totals.total <= 0}
                >
                  {busy ? 'Working…' : `Post · ${money(totals.total)}`}
                </button>
              )}
            </div>
          </form>
        ) : (
          <ReadOnlyBill bill={bill} />
        )}

        {isPosted && (
          <div className={styles.formActions}>
            {can(undefined, 'finance-reversal:change') && !hasPayments && (
              <button
                type="button"
                className={styles.cancelButton}
                onClick={cancel}
                disabled={busy}
                style={{ color: '#b91c1c' }}
              >
                Cancel &amp; Reverse This Bill
              </button>
            )}
            {bill.paymentStatus !== 'paid' && can(undefined, 'finance-payments:add') && (
              <button
                type="button"
                className={styles.submitButton}
                disabled={busy}
                onClick={() =>
                  router.push(
                    `/finance/payments/create?vendorId=${bill.vendorId}&billId=${bill.id}`,
                  )
                }
              >
                Pay This Bill · {money(bill.outstanding)}
              </button>
            )}
          </div>
        )}

        {isPosted && hasPayments && can(undefined, 'finance-reversal:change') && (
          <p className={finance.readonlyNote}>
            This bill cannot be cancelled while payments stand against it — cancelling it would
            leave them paying for nothing. Cancel those payments first if the bill itself is wrong.
          </p>
        )}
      </div>
    </Layout>
  );
};

/** What a posted or cancelled bill shows: the same facts, with nothing to type into. */
const ReadOnlyBill: React.FC<{ bill: BillDetail }> = ({ bill }) => (
  <>
    <div className={finance.settingsGrid}>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Their invoice</span>
        <span className={finance.settingValue}>{bill.supplierBillNo || '—'}</span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Dated</span>
        <span className={finance.settingValue}>
          {new Date(bill.billDate).toLocaleDateString('en-PK')}
        </span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Due</span>
        <span className={finance.settingValue}>
          {new Date(bill.dueDate).toLocaleDateString('en-PK')}
        </span>
      </div>
      <div className={finance.settingCard}>
        <span className={finance.settingLabel}>Total</span>
        <span className={finance.settingValue}>{money(bill.totalAmount)}</span>
      </div>
    </div>

    {bill.matchedReceipts.length > 0 && (
      <div className={finance.panel}>
        <h2 className={finance.panelTitle}>Goods this bill paid for</h2>
        <table className={finance.roleTable}>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Date</th>
              <th>Typed as</th>
              <th style={{ textAlign: 'right' }}>Receipt total</th>
              <th style={{ textAlign: 'right' }}>On this bill</th>
            </tr>
          </thead>
          <tbody>
            {bill.matchedReceipts.map((m) => (
              <tr key={m.receiptId}>
                <td className={finance.code}>{m.documentNo ? `#${m.documentNo}` : '—'}</td>
                <td>
                  {m.receiptDate ? new Date(m.receiptDate).toLocaleDateString('en-PK') : '—'}
                </td>
                <td className={finance.muted}>{m.typedName || '—'}</td>
                <td className={finance.amount}>{money(m.receiptTotal)}</td>
                <td className={finance.amount}>{money(m.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {bill.lines.length > 0 && (
      <div className={finance.panel}>
        <h2 className={finance.panelTitle}>Other charges</h2>
        <table className={finance.roleTable}>
          <thead>
            <tr>
              <th>What for</th>
              <th>Account</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description}</td>
                <td>
                  <span className={finance.code}>{l.ledgerCode}</span> {l.ledgerName}
                </td>
                <td className={finance.amount}>{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {bill.status === 'posted' && (
      <div className={finance.panel}>
        <h2 className={finance.panelTitle}>Payments against this bill</h2>
        {bill.payments.length === 0 ? (
          <p className={finance.readonlyNote} style={{ margin: 0 }}>
            Nothing has been paid on it yet.
          </p>
        ) : (
          <table className={finance.roleTable}>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Date</th>
                <th>Paid by</th>
                <th style={{ textAlign: 'right' }}>Towards this bill</th>
              </tr>
            </thead>
            <tbody>
              {bill.payments.map((p) => (
                <tr key={p.paymentId}>
                  <td>
                    <a className={finance.code} href={`/finance/payments/${p.paymentId}`}>
                      {p.reference}
                    </a>
                  </td>
                  <td>{new Date(p.paymentDate).toLocaleDateString('en-PK')}</td>
                  <td>{PAYMENT_METHOD_LABELS[p.method]}</td>
                  <td className={finance.amount}>{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )}

    <div className={finance.totalsBar}>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Goods</span>
        <span className={finance.totalsValue}>{money(bill.goodsAmount)}</span>
      </div>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Charges</span>
        <span className={finance.totalsValue}>{money(bill.chargesAmount)}</span>
      </div>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Tax</span>
        <span className={finance.totalsValue}>{money(bill.taxAmount)}</span>
      </div>
      <div className={finance.totalsItem}>
        <span className={finance.totalsLabel}>Total</span>
        <span className={finance.totalsValue}>{money(bill.totalAmount)}</span>
      </div>
      {bill.status === 'posted' && (
        <>
          <div className={finance.totalsItem}>
            <span className={finance.totalsLabel}>Paid</span>
            <span className={finance.totalsValue}>{money(bill.paidAmount)}</span>
          </div>
          <div className={finance.totalsVerdict}>
            <span
              className={
                bill.paymentStatus === 'paid' ? finance.totalsBalanced : finance.totalsUnbalanced
              }
            >
              {bill.paymentStatus === 'paid'
                ? BILL_PAYMENT_STATUS_LABELS.paid
                : `${money(bill.outstanding)} still owed`}
            </span>
          </div>
        </>
      )}
    </div>

    {bill.notes && <p className={finance.readonlyNote}>{bill.notes}</p>}
  </>
);

export default function BillPageWrapper() {
  return (
    <ProtectedRoute permission="finance-bills:view">
      <BillPage />
    </ProtectedRoute>
  );
}
