import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import EntryLineEditor, {
  EditorLine,
  EMPTY_LINE,
} from '../../../components/Finance/EntryLineEditor';
import { can } from '../../../utils/permissions';
import { financeService, journalService, Ledger } from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';
import finance from '../../../styles/Finance.module.scss';

const CreateEntryPage: React.FC = () => {
  const router = useRouter();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    financeService
      .getLedgers({ status: 'active' })
      .then((all) => {
        // Control accounts are filtered out of the picker entirely. They are posted to by the
        // module that owns them — deliveries, collections, stock — and a hand adjustment here
        // is exactly what makes those balances stop agreeing with their source.
        setLedgers(all.filter((l) => !l.isControl));
      })
      .catch(() => toast.error('Could not load the chart of accounts'));
  }, []);

  const buildPayload = () => ({
    date,
    narration: narration.trim(),
    referenceNo: referenceNo.trim() || undefined,
    lines: lines
      .filter((l) => l.ledgerId && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({
        ledgerId: l.ledgerId,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        lineNarration: l.lineNarration.trim() || undefined,
      })),
  });

  const validate = (): string | null => {
    if (!narration.trim()) return 'Describe what this entry is for';
    const usable = buildPayload().lines;
    if (usable.length < 2) return 'An entry needs at least two lines with amounts';
    return null;
  };

  const save = async (thenPost: boolean) => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }

    setSaving(true);
    try {
      const draft = await journalService.createDraft(buildPayload());

      if (!thenPost) {
        toast.success('Draft saved');
        router.push(`/finance/journal/${draft._id}`);
        return;
      }

      // Save then post, rather than one combined call. If posting is refused — an unbalanced
      // entry, a closed month — the typed work survives as a draft instead of being lost.
      await journalService.post(draft._id);
      toast.success('Entry posted');
      router.push(`/finance/journal/${draft._id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>New Journal Entry</h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/journal')}>
            ← Back
          </button>
        </div>

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="date">Date *</label>
              <input
                id="date"
                type="date"
                className={styles.input}
                value={date}
                disabled={saving}
                onChange={(e) => setDate(e.target.value)}
                required
              />
              <p className={styles.hint}>
                The date the transaction happened, not today. It decides which month the entry
                lands in, and a closed month will refuse it.
              </p>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="referenceNo">Reference</label>
              <input
                id="referenceNo"
                type="text"
                className={styles.input}
                value={referenceNo}
                disabled={saving}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="Voucher or document number"
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="narration">Description *</label>
            <input
              id="narration"
              type="text"
              className={styles.input}
              value={narration}
              disabled={saving}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="e.g. Office rent for July"
              required
            />
            <p className={styles.hint}>
              Written for whoever finds this entry in six months, not for you today.
            </p>
          </div>

          <h2 style={{ fontSize: '1rem', margin: '1.5rem 0 0.75rem' }}>Lines</h2>
          <p className={finance.readonlyNote} style={{ marginTop: 0, marginBottom: '0.75rem' }}>
            Accounts that hold a per-customer, per-supplier or per-rider breakdown are not listed
            here. They are posted to by deliveries, collections and stock movements, so that their
            totals always match those records.
          </p>

          <EntryLineEditor
            ledgers={ledgers}
            lines={lines}
            onChange={setLines}
            disabled={saving}
          />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/journal')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.cancelButton} disabled={saving}>
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            {can(undefined, 'finance-journal:change') && (
              <button
                type="button"
                className={styles.submitButton}
                disabled={saving}
                onClick={() => save(true)}
              >
                {saving ? 'Posting…' : 'Save and Post'}
              </button>
            )}
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateEntryPageWrapper() {
  return (
    <ProtectedRoute permission="finance-journal:add">
      <CreateEntryPage />
    </ProtectedRoute>
  );
}
