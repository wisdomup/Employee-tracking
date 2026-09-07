import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import FinanceNav from '../../../components/Finance/FinanceNav';
import {
  vendorService,
  SupplierCandidate,
  MigrationProgress,
  Vendor,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import formStyles from '../../../styles/FormPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Matching the supplier names already typed on goods receipts to a real supplier list.
 *
 * A one-off job, and the one screen in this module where a mistake is invisible: merging two
 * different companies attributes one's goods to the other and nothing downstream complains.
 *
 * So the screen is built to make a person look before they commit. Names are shown worth-most
 * first, every selection shows what it is about to move and what that is worth, and the
 * confirmation states the total rather than asking a vague "are you sure?".
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CleanupPage: React.FC = () => {
  const router = useRouter();

  const [candidates, setCandidates] = useState<SupplierCandidate[]>([]);
  const [unnamedReceipts, setUnnamedReceipts] = useState(0);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState('');
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, prog, list] = await Promise.all([
        vendorService.candidates(),
        vendorService.progress(),
        vendorService.list({ status: 'all' }),
      ]);
      setCandidates(data.candidates);
      setUnnamedReceipts(data.unnamedReceipts);
      setProgress(prog);
      setVendors(list.filter((v) => !v.isPlaceholder));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the typed names');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => (showDone ? candidates : candidates.filter((c) => !c.resolvedTo)),
    [candidates, showDone],
  );

  const selectedRows = useMemo(
    () => candidates.filter((c) => selected.has(c.typedName)),
    [candidates, selected],
  );

  const selectedValue = selectedRows.reduce((sum, c) => sum + c.totalValue, 0);
  const selectedReceipts = selectedRows.reduce((sum, c) => sum + c.receiptCount, 0);

  const toggleRow = (typedName: string) => {
    const next = new Set(selected);
    if (next.has(typedName)) next.delete(typedName);
    else next.add(typedName);
    setSelected(next);
  };

  /** Take the suggestion: select this name and point at the supplier it looks like. */
  const acceptSuggestion = (candidate: SupplierCandidate, vendorId: string) => {
    setSelected(new Set([candidate.typedName]));
    setTarget(vendorId);
    setNewName('');
  };

  const assign = async () => {
    if (selected.size === 0) {
      toast.error('Choose at least one typed name');
      return;
    }
    if (!target && newName.trim().length < 2) {
      toast.error('Choose a supplier, or give a new name');
      return;
    }

    const destination = target
      ? vendors.find((v) => v.id === target)?.name ?? 'that supplier'
      : newName.trim();

    // Names the total, because "are you sure?" without a figure is a question people answer
    // without reading. Getting this wrong files one company's goods under another.
    if (
      !window.confirm(
        `Attach ${selectedReceipts} goods receipt${selectedReceipts === 1 ? '' : 's'} `
          + `worth ${money(selectedValue)} to "${destination}"?\n\n`
          + `Typed as: ${selectedRows.map((r) => r.typedName).join(', ')}`,
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const result = await vendorService.assign({
        vendorId: target || undefined,
        newVendorName: target ? undefined : newName.trim(),
        typedNames: [...selected],
      });
      toast.success(
        `${result.receiptsLinked} receipt${result.receiptsLinked === 1 ? '' : 's'} attached to ${result.vendor.name}`,
      );
      setSelected(new Set());
      setTarget('');
      setNewName('');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not attach those names');
    } finally {
      setBusy(false);
    }
  };

  const parkRest = async () => {
    if (
      !window.confirm(
        'File every remaining receipt under "Unidentified Supplier"?\n\n'
          + 'This is a holding record, not a real supplier. It makes the totals add up now, and '
          + 'you can move receipts out of it later as you recognise them.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await vendorService.parkUnassigned();
      toast.success(`${result.receiptsLinked} receipt(s) filed under the holding record`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not do that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Match Typed Names</h1>
          <button
            className={listStyles.addButton}
            style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
            onClick={() => router.push('/finance/vendors')}
          >
            &larr; Suppliers
          </button>
        </div>

        <FinanceNav />

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>What this is for</span>
          Until now the supplier on a goods receipt was free text, so the same company has been
          written several ways. Attach each spelling to one supplier and the receipts join up.
          <strong> Nothing is merged automatically</strong> — a wrong match files one company's
          goods under another and nothing else would notice, so every match is yours to make.
          The receipts keep the name that was actually typed.
        </div>

        {progress && (
          <div className={styles.settingsGrid}>
            <div className={styles.settingCard}>
              <span className={styles.settingLabel}>Receipts attached</span>
              <span className={styles.settingValue}>
                {progress.linkedReceipts} / {progress.totalReceipts}
              </span>
            </div>
            <div className={styles.settingCard}>
              <span className={styles.settingLabel}>Still unattached</span>
              <span
                className={styles.settingValue}
                style={progress.unlinkedReceipts > 0 ? { color: '#b42318' } : undefined}
              >
                {progress.unlinkedReceipts}
              </span>
            </div>
            <div className={styles.settingCard}>
              <span className={styles.settingLabel}>Suppliers</span>
              <span className={styles.settingValue}>{progress.vendorCount}</span>
            </div>
            <div className={styles.settingCard}>
              <span className={styles.settingLabel}>On holding record</span>
              <span className={styles.settingValue}>{progress.onPlaceholder}</span>
            </div>
          </div>
        )}

        {loading ? (
          <Loader />
        ) : (
          <>
            {/* --- The action bar. Sticky so it is reachable from anywhere in a long list. --- */}
            {selected.size > 0 && (
              <div
                className={formStyles.form}
                style={{ position: 'sticky', top: '0.5rem', zIndex: 5, marginBottom: '1rem' }}
              >
                <p style={{ marginTop: 0, fontWeight: 600 }}>
                  {selected.size} name{selected.size === 1 ? '' : 's'} chosen ·{' '}
                  {selectedReceipts} receipt{selectedReceipts === 1 ? '' : 's'} ·{' '}
                  {money(selectedValue)}
                </p>

                <div className={formStyles.formRow}>
                  <div className={formStyles.formGroup}>
                    <label htmlFor="target">Attach to an existing supplier</label>
                    <select
                      id="target"
                      className={formStyles.select}
                      value={target}
                      disabled={busy || newName.trim().length > 0}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Choose…</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.reference} · {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={formStyles.formGroup}>
                    <label htmlFor="newName">Or create a new one</label>
                    <input
                      id="newName"
                      type="text"
                      className={formStyles.input}
                      value={newName}
                      disabled={busy || target.length > 0}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Supplier name"
                    />
                    <p className={formStyles.hint}>
                      One or the other, not both — the system refuses to guess which you meant.
                    </p>
                  </div>
                </div>

                <div className={formStyles.formActions}>
                  <button
                    type="button"
                    className={formStyles.cancelButton}
                    onClick={() => setSelected(new Set())}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    className={formStyles.submitButton}
                    disabled={busy}
                    onClick={assign}
                  >
                    {busy ? 'Attaching…' : 'Attach'}
                  </button>
                </div>
              </div>
            )}

            <div className={listStyles.listCard}>
              <div className={listStyles.listCardBody}>
                <div className={styles.filterRow}>
                  <label className={styles.settingLabel} style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={showDone}
                      onChange={(e) => setShowDone(e.target.checked)}
                      style={{ marginRight: '0.4rem' }}
                    />
                    Show names already attached
                  </label>
                </div>

                {visible.length === 0 ? (
                  <p className={styles.muted}>
                    {candidates.length === 0
                      ? 'No goods receipts carry a supplier name yet.'
                      : 'Every typed name has been attached to a supplier.'}
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className={styles.roleTable}>
                      <thead>
                        <tr>
                          <th style={{ width: '2rem' }} />
                          <th>Typed on the receipt</th>
                          <th style={{ textAlign: 'right' }}>Receipts</th>
                          <th style={{ textAlign: 'right' }}>Value</th>
                          <th>Looks like</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((c) => (
                          <tr key={c.typedName}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.has(c.typedName)}
                                onChange={() => toggleRow(c.typedName)}
                                aria-label={`Choose ${c.typedName}`}
                              />
                            </td>
                            <td>
                              <div style={{ fontWeight: 500 }}>{c.typedName}</div>
                              <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                                {new Date(c.firstSeen).toLocaleDateString()} –{' '}
                                {new Date(c.lastSeen).toLocaleDateString()}
                              </div>
                              {c.resolvedTo && (
                                <span
                                  className={`${styles.flag} ${styles.flagControl}`}
                                  style={{ marginTop: '0.2rem', display: 'inline-block' }}
                                >
                                  attached to {c.resolvedTo.name}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span className={styles.amount}>{c.receiptCount}</span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span className={styles.amount}>{money(c.totalValue)}</span>
                            </td>
                            <td>
                              {c.suggestions.length === 0 ? (
                                <span className={styles.muted}>—</span>
                              ) : (
                                c.suggestions.map((s) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    className={styles.addLine}
                                    style={{ marginRight: '0.35rem', padding: '0.25rem 0.6rem' }}
                                    onClick={() => acceptSuggestion(c, s.id)}
                                  >
                                    {s.name}
                                  </button>
                                ))
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {unnamedReceipts > 0 && (
                  <p className={styles.readonlyNote}>
                    {unnamedReceipts} receipt{unnamedReceipts === 1 ? ' was' : 's were'} entered
                    with no supplier name at all. There is nothing to match those on — file them
                    under the holding record below.
                  </p>
                )}
              </div>
            </div>

            {progress && !progress.complete && (
              <div className={`${styles.banner} ${styles.bannerInfo}`} style={{ marginTop: '1.25rem' }}>
                <span className={styles.bannerTitle}>When you have matched what you can</span>
                File the rest under a holding record so the totals add up. It is deliberately
                obvious rather than a plausible-looking supplier, and receipts can be moved out of
                it later.
                <div style={{ marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    className={formStyles.cancelButton}
                    disabled={busy}
                    onClick={parkRest}
                  >
                    File {progress.unlinkedReceipts} remaining receipt
                    {progress.unlinkedReceipts === 1 ? '' : 's'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
};

export default function CleanupPageWrapper() {
  return (
    <ProtectedRoute permission="finance-vendors:change">
      <CleanupPage />
    </ProtectedRoute>
  );
}
