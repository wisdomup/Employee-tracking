import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import FinanceNav from '../../components/Finance/FinanceNav';
import { can } from '../../utils/permissions';
import {
  openingBalanceService,
  financeService,
  OpeningWorksheet,
  Ledger,
} from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * The changeover: what the business owned and owed on the day the books went live.
 *
 * Done once, so the screen explains itself as it goes rather than assuming anybody has seen it
 * before. The three stages are laid out in order and the one being worked on is the only one
 * that accepts input — there is no version of this where doing the steps out of order helps.
 *
 * Amounts are typed in each account's OWN direction: 400,000 against Bank is money held,
 * 150,000 against a loan is money owed. Asking a non-accountant which side of an entry a figure
 * belongs on is how opening balances get entered backwards.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const OpeningBalancesPage: React.FC = () => {
  const [sheet, setSheet] = useState<OpeningWorksheet | null>(null);
  const [equityLedgers, setEquityLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cutoverDate, setCutoverDate] = useState('');
  const [capitalLedgerId, setCapitalLedgerId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [worksheet, ledgers] = await Promise.all([
        openingBalanceService.worksheet(),
        financeService.getLedgers({ accountType: 'equity', status: 'active' }).catch(() => []),
      ]);
      setSheet(worksheet);
      setEquityLedgers(ledgers.filter((l) => l.code !== worksheet.status.openingEquityCode));
      setDrafts(
        Object.fromEntries(
          worksheet.rows.filter((r) => r.amount !== 0).map((r) => [r.ledgerId, String(r.amount)]),
        ),
      );
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the opening balances');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stage = sheet?.status.stage ?? 'not-started';
  const canEdit = stage === 'not-started' && can(undefined, 'finance-opening:edit');
  const canPost = can(undefined, 'finance-opening:change');

  const dirty = useMemo(() => {
    if (!sheet) return false;
    return sheet.rows.some((row) => {
      const typed = drafts[row.ledgerId];
      const value = typed === undefined || typed === '' ? 0 : Number(typed);
      return row.editable && value !== row.amount;
    });
  }, [sheet, drafts]);

  const save = async () => {
    if (!sheet) return;
    const entries = sheet.rows
      .filter((row) => row.editable)
      .map((row) => {
        const typed = drafts[row.ledgerId];
        return {
          ledgerId: row.ledgerId,
          amount: typed === undefined || typed === '' ? 0 : Number(typed),
        };
      });

    setBusy(true);
    try {
      setSheet(await openingBalanceService.save(entries));
      toast.success('Figures saved. Nothing has reached the accounts yet.');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save the figures');
    } finally {
      setBusy(false);
    }
  };

  const openBooks = async () => {
    if (!sheet || !cutoverDate) {
      toast.error('Choose the changeover date first.');
      return;
    }
    if (
      !window.confirm(
        `Open the books as at ${cutoverDate}?\n\n`
          + `Owned: ${money(sheet.totalDebits)}\nOwed: ${money(sheet.totalCredits)}\n`
          + `Worth: ${money(sheet.openingEquity)}\n\n`
          + 'This writes the opening entry. It can be undone, but only until trading is recorded '
          + 'on top of it.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      await openingBalanceService.post(cutoverDate);
      toast.success('The books are open.');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not open the books');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!capitalLedgerId) {
      toast.error('Choose where the changeover figure should go.');
      return;
    }
    setBusy(true);
    try {
      await openingBalanceService.closeEquity(capitalLedgerId);
      toast.success('The changeover is finished.');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not finish the changeover');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    const reason = window.prompt('Why is the changeover being reopened?');
    if (!reason?.trim()) return;

    setBusy(true);
    try {
      await openingBalanceService.reopen(reason.trim());
      toast.success('Reopened. The figures are back on the worksheet.');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not reopen the changeover');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !sheet) {
    return (
      <Layout>
        <div className={listStyles.container}>
          <Loader />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Opening Balances</h1>
          {stage !== 'not-started' && can(undefined, 'finance-reversal:change') && (
            <button className={listStyles.deleteButton} disabled={busy} onClick={reopen}>
              Reopen the changeover
            </button>
          )}
        </div>

        <FinanceNav />

        {stage === 'complete' ? (
          <div className={`${styles.banner} ${styles.bannerOk}`}>
            <span className={styles.bannerTitle}>The changeover is finished</span>
            The books were opened as at{' '}
            {sheet.status.cutoverDate
              ? new Date(sheet.status.cutoverDate).toLocaleDateString('en-PK')
              : '—'}
            , and account {sheet.status.openingEquityCode} reads nil. That nil is the proof
            everything was accounted for.
          </div>
        ) : stage === 'balances-entered' ? (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <span className={styles.bannerTitle}>One step left</span>
            The opening figures are posted, but {money(sheet.status.openingEquityBalance)} is still
            sitting in account {sheet.status.openingEquityCode}. That is what the business was
            worth at changeover, and it has to be moved to the owner&apos;s capital before the
            changeover counts as done.
          </div>
        ) : (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>What this screen is for</span>
            The accounts start empty. This is where you tell them what the business already owned
            and owed on the day you switched over — cash, bank, loans, what you owe suppliers.
            <p className={styles.readonlyNote} style={{ marginBottom: 0 }}>
              Type every figure as a positive number in its own sense: what you <em>hold</em> in
              the bank, what you <em>owe</em> on a loan. Nothing reaches the accounts until you
              press Open the books.
            </p>
          </div>
        )}

        {/* --- The worksheet --------------------------------------------- */}
        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <h2 className={styles.panelTitle}>Step 1 — What the business had</h2>

            <div style={{ overflowX: 'auto' }}>
              <table className={styles.roleTable}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Group</th>
                    <th style={{ textAlign: 'right', width: '12rem' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row) => (
                    <tr key={row.ledgerId}>
                      <td>
                        <span className={styles.code}>{row.code}</span> {row.name}
                        {row.note && (
                          <p className={styles.readonlyNote} style={{ margin: '0.15rem 0 0' }}>
                            {row.note}
                          </p>
                        )}
                      </td>
                      <td className={styles.muted}>{row.groupName}</td>
                      <td style={{ textAlign: 'right' }}>
                        {row.editable && canEdit ? (
                          <input
                            type="number"
                            step="0.01"
                            className={formStyles.input}
                            style={{ textAlign: 'right' }}
                            value={drafts[row.ledgerId] ?? ''}
                            disabled={busy}
                            aria-label={`Opening balance for ${row.name}`}
                            placeholder="0.00"
                            onChange={(e) =>
                              setDrafts((prev) => ({ ...prev, [row.ledgerId]: e.target.value }))
                            }
                          />
                        ) : (
                          <span
                            className={`${styles.amount} ${
                              row.amount < 0 ? styles.amountNegative : ''
                            }`}
                          >
                            {row.amount === 0 ? '—' : money(row.amount)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.totalsBar}>
              <div className={styles.totalsItem}>
                <span className={styles.totalsLabel}>Everything owned</span>
                <span className={styles.totalsValue}>{money(sheet.totalDebits)}</span>
              </div>
              <div className={styles.totalsItem}>
                <span className={styles.totalsLabel}>Everything owed</span>
                <span className={styles.totalsValue}>{money(sheet.totalCredits)}</span>
              </div>
              <div className={styles.totalsItem}>
                <span className={styles.totalsLabel}>So the business was worth</span>
                <span className={`${styles.totalsValue} ${styles.totalsBalanced}`}>
                  {money(sheet.openingEquity)}
                </span>
              </div>
              <div className={styles.totalsVerdict}>
                Everything owned, less everything owed. This figure is worked out for you — it is
                never typed in, because an entry that balanced because somebody calculated it by
                hand would balance just as well with two of the other numbers wrong.
              </div>
            </div>

            {canEdit && (
              <div className={formStyles.formActions}>
                <button
                  className={formStyles.cancelButton}
                  disabled={busy || !dirty}
                  onClick={save}
                >
                  Save figures
                </button>
              </div>
            )}
          </div>
        </div>

        {/* --- Opening the books ------------------------------------------ */}
        {stage === 'not-started' && canPost && (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Step 2 — Open the books</h2>
            <p className={styles.readonlyNote}>
              Pick the day you switched over. Nothing may already be recorded on or before it —
              an opening balance and the transactions behind it describe the same money, and
              counting both would double everything.
            </p>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="cutoverDate">Changeover date</label>
                <input
                  id="cutoverDate"
                  type="date"
                  className={formStyles.input}
                  value={cutoverDate}
                  disabled={busy}
                  onChange={(e) => setCutoverDate(e.target.value)}
                />
              </div>
              <div className={formStyles.formGroup} style={{ justifyContent: 'flex-end' }}>
                <button
                  className={formStyles.submitButton}
                  disabled={busy || !cutoverDate || sheet.rows.every((r) => r.amount === 0)}
                  onClick={openBooks}
                >
                  Open the books
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- Finishing -------------------------------------------------- */}
        {stage === 'balances-entered' && canPost && (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>Step 3 — Say whose money it is</h2>
            <p className={styles.readonlyNote}>
              {money(sheet.status.openingEquityBalance)} is what the business was worth at
              changeover. Moving it to the owner&apos;s capital finishes the job — after which
              account {sheet.status.openingEquityCode} reads nil, and that nil is the proof
              nothing was left out.
            </p>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="capitalLedgerId">Move it to</label>
                <select
                  id="capitalLedgerId"
                  className={formStyles.select}
                  value={capitalLedgerId}
                  disabled={busy}
                  onChange={(e) => setCapitalLedgerId(e.target.value)}
                >
                  <option value="">Choose an account…</option>
                  {equityLedgers.map((ledger) => (
                    <option key={ledger.id} value={ledger.id}>
                      {ledger.code} · {ledger.name}
                    </option>
                  ))}
                </select>
                <p className={formStyles.hint}>
                  Usually the owner&apos;s capital. It has to be an equity account.
                </p>
              </div>
              <div className={formStyles.formGroup} style={{ justifyContent: 'flex-end' }}>
                <button
                  className={formStyles.submitButton}
                  disabled={busy || !capitalLedgerId}
                  onClick={finish}
                >
                  Finish the changeover
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default function OpeningBalancesPageWrapper() {
  return (
    <ProtectedRoute permission="finance-opening:view">
      <OpeningBalancesPage />
    </ProtectedRoute>
  );
}
