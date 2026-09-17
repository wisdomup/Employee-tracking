import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import VoucherForm, {
  ShopOption,
  validateVoucher,
  VoucherFormValues,
  voucherToForm,
  voucherToPayload,
} from '../../../components/Finance/VoucherForm';
import { money } from '../../../components/Finance/BillForm';
import { can } from '../../../utils/permissions';
import {
  financeService,
  voucherService,
  CONTRA_SUBTYPE_LABELS,
  Ledger,
  Voucher,
  VOUCHER_STATUS_LABELS,
} from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

/**
 * One voucher, through its whole life.
 *
 * The entry it will write is on the screen at every stage, including while it is still a draft.
 * That is the point of the document: the person approving it should be looking at the debits and
 * credits, not at a description of them.
 */

const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
  : '';

const VoucherPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [values, setValues] = useState<VoucherFormValues | null>(null);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = (next: Voucher) => {
    setVoucher(next);
    setValues(voucherToForm(next));
  };

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      apply(await voucherService.get(id));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this voucher');
      router.push('/finance/vouchers');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    financeService.getLedgers({ status: 'active' }).then(setAccounts).catch(() => undefined);
    voucherService
      .shops()
      .then((list) => setShops(list.map((s) => ({ id: s.id, label: s.shopName || s.name }))))
      .catch(() => undefined);
  }, []);

  const run = async (
    work: () => Promise<Voucher>,
    success: (v: Voucher) => string,
    failure: string,
  ) => {
    setBusy(true);
    try {
      const next = await work();
      apply(next);
      toast.success(success(next));
    } catch (error: any) {
      toast.error(error.response?.data?.message || failure);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !voucher || !values || typeof id !== 'string') {
    return (
      <Layout>
        <div className={styles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  const editable = voucher.status === 'draft' || voucher.status === 'rejected';
  const unsaved = JSON.stringify(voucherToPayload(values))
    !== JSON.stringify(voucherToPayload(voucherToForm(voucher)));

  const totalDebit = voucher.lines.reduce((sum, l) => sum + l.debit, 0);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateVoucher(values);
    if (problem) {
      toast.error(problem);
      return;
    }
    run(
      () => voucherService.update(id, voucherToPayload(values)),
      () => 'Voucher saved',
      'Could not save this voucher',
    );
  };

  const submit = () => {
    if (unsaved) {
      toast.error('Save your changes first — a voucher is submitted exactly as it was last saved');
      return;
    }
    if (!window.confirm(
      `Submit this voucher for approval?\n\n${voucher.categoryLabel}\n`
        + `${voucher.narration}\n${money(voucher.amount)}\n\n`
        + 'Somebody else has to approve it, and posting is a separate step after that.',
    )) {
      return;
    }
    run(
      () => voucherService.submit(id),
      () => 'Submitted — waiting for approval',
      'Could not submit this voucher',
    );
  };

  const approve = () => {
    if (!window.confirm(
      `Approve this voucher?\n\n${voucher.categoryLabel}\n${voucher.narration}\n`
        + `${money(voucher.amount)}\n\n`
        + 'Approving does not post it. It can then be posted to the accounts.',
    )) {
      return;
    }
    run(() => voucherService.approve(id), () => 'Approved', 'Could not approve this voucher');
  };

  const reject = () => {
    const reason = window.prompt(
      'Send this voucher back?\n\nSay what needs fixing — whoever raised it will see this.',
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say what needs fixing');
      return;
    }
    run(
      () => voucherService.reject(id, reason.trim()),
      () => 'Sent back',
      'Could not send this voucher back',
    );
  };

  const post = () => {
    if (!window.confirm(
      `Post this voucher to the accounts?\n\n${voucher.narration}\n${money(voucher.amount)}\n\n`
        + 'It takes its number now. From then on it can be cancelled, not deleted.',
    )) {
      return;
    }
    run(
      () => voucherService.post(id),
      (next) => `${next.reference} posted`,
      'Could not post this voucher',
    );
  };

  const cancel = () => {
    const reason = window.prompt(
      `Cancel ${voucher.reference} and reverse it out of the accounts?\n\nSay why — it stays on the record.`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('Say why this voucher is being cancelled');
      return;
    }
    run(
      () => voucherService.cancel(id, reason.trim()),
      (next) => `${next.reference} cancelled and reversed`,
      'Could not cancel this voucher',
    );
  };

  const discard = async () => {
    if (!window.confirm('Delete this voucher? It has never reached the accounts.')) return;
    setBusy(true);
    try {
      await voucherService.remove(id);
      toast.success('Voucher deleted');
      router.push('/finance/vouchers');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this voucher');
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            {voucher.reference} · {voucher.categoryLabel}
          </h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/vouchers')}>
            &larr; Back
          </button>
        </div>

        {voucher.status === 'draft' && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Not submitted yet</span>
            Nothing has reached the accounts. Submitting sends it to somebody else to approve.
          </div>
        )}

        {voucher.status === 'rejected' && (
          <div className={`${finance.banner} ${finance.bannerBad}`}>
            <span className={finance.bannerTitle}>Sent back</span>
            {voucher.rejectionReason}
            <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
              Correct it and submit it again, or delete it if it should not have been raised.
            </p>
          </div>
        )}

        {voucher.status === 'submitted' && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Waiting for approval</span>
            Nothing has reached the accounts. Whoever raised it cannot approve it.
            {voucher.rejectionReason && (
              <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
                Sent back once before: {voucher.rejectionReason}
              </p>
            )}
          </div>
        )}

        {voucher.status === 'approved' && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Approved, not yet posted</span>
            Approving is not posting. Post it to write it to the accounts — the month it is dated in
            has to be open.
          </div>
        )}

        {voucher.status === 'posted' && (
          <div className={`${finance.banner} ${finance.bannerOk}`}>
            <span className={finance.bannerTitle}>Posted</span>
            {money(voucher.amount)}, approved by a second person.{' '}
            {voucher.journalEntryId && (
              <a href={`/finance/journal/${voucher.journalEntryId}`}>See the entry it wrote</a>
            )}
          </div>
        )}

        {voucher.status === 'cancelled' && (
          <div className={`${finance.banner} ${finance.bannerBad}`}>
            <span className={finance.bannerTitle}>Cancelled and reversed</span>
            {voucher.cancelReason || 'No reason was recorded.'}
          </div>
        )}

        <div className={finance.panel}>
          <h2 className={finance.panelTitle}>The entry this voucher writes</h2>
          <table className={finance.roleTable}>
            <thead>
              <tr>
                <th>Account</th>
                <th>Note</th>
                <th style={{ textAlign: 'right' }}>Debit</th>
                <th style={{ textAlign: 'right' }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {voucher.lines.map((l, i) => (
                // Lines have no id of their own; their order is part of the document.
                 
                <tr key={`${l.ledgerId}-${i}`}>
                  <td>
                    <span className={finance.code}>{l.ledgerCode}</span> {l.ledgerName}
                  </td>
                  <td className={finance.muted}>{l.partyName || l.narration || '—'}</td>
                  <td className={finance.amount}>{l.debit ? money(l.debit) : '—'}</td>
                  <td className={finance.amount}>{l.credit ? money(l.credit) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 600 }} colSpan={2}>
                  Total
                </td>
                <td className={finance.amount} style={{ fontWeight: 600 }}>
                  {money(totalDebit)}
                </td>
                <td className={finance.amount} style={{ fontWeight: 600 }}>
                  {money(totalDebit)}
                </td>
              </tr>
            </tbody>
          </table>

          <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
            {VOUCHER_STATUS_LABELS[voucher.status]} ·{' '}
            {new Date(voucher.voucherDate).toLocaleDateString('en-PK')}
            {voucher.subtype ? ` · ${CONTRA_SUBTYPE_LABELS[voucher.subtype]}` : ''}
            {voucher.paymentReference ? ` · ${voucher.paymentReference}` : ''}
          </p>

          {voucher.attachments.length > 0 && (
            <p className={finance.readonlyNote} style={{ marginBottom: 0 }}>
              {voucher.attachments.map((url, i) => (
                <span key={url}>
                  {i > 0 && ' · '}
                  <a href={`${API_BASE}${url}`} target="_blank" rel="noreferrer">
                    Attachment {i + 1}
                  </a>
                </span>
              ))}
            </p>
          )}
        </div>

        {editable ? (
          <form className={styles.form} onSubmit={save}>
            <VoucherForm
              values={values}
              onChange={setValues}
              accounts={accounts}
              shops={shops}
              lockCategory
              disabled={busy}
            />

            <div className={styles.formActions}>
              {can(undefined, 'finance-vouchers:delete') && (
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={discard}
                  disabled={busy}
                >
                  Delete
                </button>
              )}
              {can(undefined, 'finance-vouchers:edit') && (
                <button type="submit" className={styles.cancelButton} disabled={busy}>
                  Save
                </button>
              )}
              {can(undefined, 'finance-vouchers:add') && (
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={submit}
                  disabled={busy}
                >
                  Submit for Approval
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className={styles.formActions}>
            {voucher.status === 'submitted' && can(undefined, 'finance-vouchers:change') && (
              <>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={reject}
                  disabled={busy}
                >
                  Send Back
                </button>
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={approve}
                  disabled={busy}
                >
                  Approve
                </button>
              </>
            )}

            {voucher.status === 'approved' && can(undefined, 'finance-vouchers:change') && (
              <>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={reject}
                  disabled={busy}
                >
                  Send Back
                </button>
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={post}
                  disabled={busy}
                >
                  Post to the Accounts
                </button>
              </>
            )}

            {voucher.status === 'posted' && can(undefined, 'finance-reversal:change') && (
              <button type="button" className={styles.cancelButton} onClick={cancel} disabled={busy}>
                Cancel &amp; Reverse
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default function VoucherPageWrapper() {
  return (
    <ProtectedRoute permission="finance-vouchers:view">
      <VoucherPage />
    </ProtectedRoute>
  );
}
