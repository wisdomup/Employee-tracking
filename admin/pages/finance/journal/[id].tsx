import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import EntryLineEditor, {
  EditorLine,
  EMPTY_LINE,
} from '../../../components/Finance/EntryLineEditor';
import { can } from '../../../utils/permissions';
import { financeService, journalService, JournalEntry, Ledger } from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import listStyles from '../../../styles/ListPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

/**
 * One entry. A draft is editable here; a posted entry is read-only, permanently.
 *
 * Both states share a screen rather than splitting into view and edit pages, because the
 * transition between them is the important moment and it should not involve navigating
 * somewhere else.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EntryPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [narration, setNarration] = useState('');
  const [date, setDate] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reversalReason, setReversalReason] = useState('');

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    try {
      const [data, allLedgers] = await Promise.all([
        journalService.get(id),
        financeService.getLedgers({ status: 'active' }),
      ]);
      setEntry(data);
      setLedgers(allLedgers.filter((l) => !l.isControl));
      setNarration(data.narration ?? '');
      setDate(data.date.slice(0, 10));
      setReferenceNo(data.referenceNo ?? '');
      setLines(
        (data.lines ?? []).map((l) => ({
          ledgerId: l.ledgerId,
          debit: l.debit ? String(l.debit) : '',
          credit: l.credit ? String(l.credit) : '',
          lineNarration: l.lineNarration ?? '',
        })),
      );
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load this entry');
      router.push('/finance/journal');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const isDraft = entry?.status === 'draft';

  const saveDraft = async () => {
    if (typeof id !== 'string') return;
    setBusy(true);
    try {
      await journalService.updateDraft(id, {
        date,
        narration: narration.trim(),
        referenceNo: referenceNo.trim(),
        lines: lines
          .filter((l) => l.ledgerId && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l) => ({
            ledgerId: l.ledgerId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            lineNarration: l.lineNarration.trim() || undefined,
          })),
      });
      toast.success('Draft saved');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this draft');
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (typeof id !== 'string') return;
    setBusy(true);
    try {
      await journalService.post(id);
      toast.success('Entry posted. It can no longer be edited — only reversed.');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not post this entry');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (typeof id !== 'string') return;
    if (!window.confirm('Delete this draft? Nothing has been posted, so nothing is lost.')) return;
    try {
      await journalService.deleteDraft(id);
      toast.success('Draft deleted');
      router.push('/finance/journal');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this draft');
    }
  };

  const reverse = async () => {
    if (typeof id !== 'string') return;
    if (!reversalReason.trim()) {
      toast.error('Say why this entry is being reversed');
      return;
    }
    setBusy(true);
    try {
      await journalService.reverse(id, reversalReason.trim());
      toast.success('Reversed. Both entries stay on the record.');
      setReversing(false);
      setReversalReason('');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not reverse this entry');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !entry) {
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
            {entry.entryNo ? `Entry #${entry.entryNo}` : 'Draft entry'}{' '}
            <span className={`${finance.status} ${finance[`status_${entry.status}`]}`}>
              {entry.status}
            </span>
          </h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/journal')}>
            ← Back
          </button>
        </div>

        {entry.status === 'reversed' && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>This entry has been reversed</span>
            {entry.reversalReason}
            {entry.reversedByEntryId && (
              <>
                {' '}
                <a href={`/finance/journal/${entry.reversedByEntryId}`}>
                  Open the reversing entry
                </a>
                .
              </>
            )}
          </div>
        )}

        {entry.reversalOf && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>This entry reverses another</span>
            <a href={`/finance/journal/${entry.reversalOf}`}>Open the original</a>.
          </div>
        )}

        {isDraft && entry.postBlockedReason && (
          <div className={`${finance.banner} ${finance.bannerBad}`}>
            <span className={finance.bannerTitle}>This month will not accept the entry</span>
            {entry.postBlockedReason}
          </div>
        )}

        {!isDraft && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>Posted entries cannot be changed</span>
            That is deliberate. To correct one, reverse it and post a replacement — both stay on
            the record, so the history reads as what actually happened.
          </div>
        )}

        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="date">Date</label>
              <input
                id="date"
                type="date"
                className={styles.input}
                value={date}
                disabled={!isDraft || busy}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="referenceNo">Reference</label>
              <input
                id="referenceNo"
                type="text"
                className={styles.input}
                value={referenceNo}
                disabled={!isDraft || busy}
                onChange={(e) => setReferenceNo(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label>Month</label>
              <input className={styles.input} value={entry.postingPeriod} disabled readOnly />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="narration">Description</label>
            <input
              id="narration"
              type="text"
              className={styles.input}
              value={narration}
              disabled={!isDraft || busy}
              onChange={(e) => setNarration(e.target.value)}
            />
          </div>

          <h2 style={{ fontSize: '1rem', margin: '1.5rem 0 0.75rem' }}>Lines</h2>

          {isDraft ? (
            <EntryLineEditor
              ledgers={ledgers}
              lines={lines.length >= 2 ? lines : [{ ...EMPTY_LINE }, { ...EMPTY_LINE }]}
              onChange={setLines}
              disabled={busy}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
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
                  {(entry.lines ?? []).map((line, i) => (
                    <tr key={i}>
                      <td>
                        <span className={finance.code}>{line.ledgerCode}</span> {line.ledgerName}
                      </td>
                      <td className={finance.muted}>{line.lineNarration || '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={finance.amount}>
                          {line.debit ? money(line.debit) : '—'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={finance.amount}>
                          {line.credit ? money(line.credit) : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={finance.reportTotals}>
                    <td colSpan={2}>Totals</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={finance.amount}>{money(entry.totalDebit)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={finance.amount}>{money(entry.totalCredit)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {reversing && (
            <div className={styles.formGroup} style={{ marginTop: '1.25rem' }}>
              <label htmlFor="reversalReason">Why is this being reversed? *</label>
              <input
                id="reversalReason"
                type="text"
                className={styles.input}
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="e.g. Posted to the wrong account"
              />
              <p className={styles.hint}>
                Recorded on both entries. The reversal is dated today, so a month that has already
                been reported is not restated behind anyone.
              </p>
            </div>
          )}

          <div className={styles.formActions}>
            {isDraft && can(undefined, 'finance-journal:delete') && (
              <button type="button" className={listStyles.deleteButton} onClick={remove}>
                Delete Draft
              </button>
            )}
            {isDraft && can(undefined, 'finance-journal:edit') && (
              <button
                type="button"
                className={styles.cancelButton}
                disabled={busy}
                onClick={saveDraft}
              >
                Save Draft
              </button>
            )}
            {isDraft && can(undefined, 'finance-journal:change') && (
              <button
                type="button"
                className={styles.submitButton}
                disabled={busy || entry.canPost === false}
                onClick={post}
              >
                {busy ? 'Posting…' : 'Post to Ledger'}
              </button>
            )}
            {entry.status === 'posted' && can(undefined, 'finance-reversal:change') && (
              <>
                {!reversing ? (
                  <button
                    type="button"
                    className={styles.submitButton}
                    onClick={() => setReversing(true)}
                  >
                    Reverse Entry
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      onClick={() => setReversing(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.submitButton}
                      disabled={busy}
                      onClick={reverse}
                    >
                      {busy ? 'Reversing…' : 'Confirm Reversal'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EntryPageWrapper() {
  return (
    <ProtectedRoute permission="finance-journal:view">
      <EntryPage />
    </ProtectedRoute>
  );
}
