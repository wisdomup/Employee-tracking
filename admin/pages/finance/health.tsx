import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import FinanceNav from '../../components/Finance/FinanceNav';
import TrailPanel from '../../components/Finance/TrailPanel';
import TrailAmount from '../../components/Finance/TrailAmount';
import { useTrail } from '../../hooks/useTrail';
import { can } from '../../utils/permissions';
import {
  healthService,
  BalanceCheckResult,
  ControlCheck,
  ControlHistoryRow,
  PostingSwitch,
  PostingFailure,
} from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * Does the ledger still agree with the rest of the business?
 *
 * The screen the whole module is for. Everything else records; this one proves. It is written to
 * be read by somebody who is not an accountant — the labels say what the account is FOR, and a
 * failing check shows the arithmetic rather than an error code.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Turn a breakdown key into something readable without maintaining a second dictionary. */
function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const HealthPage: React.FC = () => {
  const { stack: trailStack, openTrail, pushTrail, goToTrail, closeTrail } = useTrail();
  const [checks, setChecks] = useState<ControlCheck[]>([]);
  const [day, setDay] = useState('');
  const [switches, setSwitches] = useState<PostingSwitch[]>([]);
  const [failures, setFailures] = useState<PostingFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Recorded runs per check, fetched the first time its working is opened. */
  const [history, setHistory] = useState<Record<string, ControlHistoryRow[] | 'failed'>>({});
  const [balances, setBalances] = useState<BalanceCheckResult | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const [controls, sw, fails] = await Promise.all([
        healthService.controls(refresh),
        healthService.switches().catch(() => [] as PostingSwitch[]),
        healthService.failures().catch(() => [] as PostingFailure[]),
      ]);
      setChecks(controls.checks);
      setDay(controls.day);
      setSwitches(sw);
      setFailures(fails);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the finance health check');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const toggle = async (item: PostingSwitch) => {
    const turningOn = !item.enabled;
    if (
      turningOn
      && !window.confirm(
        `Turn on "${item.label}"?\n\n`
          + 'From now on this will write to the accounts by itself. Turn on one thing at a time '
          + 'and check this page the next morning — if the books stop agreeing with the '
          + 'warehouse, you will know which change caused it.',
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      await healthService.setSwitch(item.event, turningOn);
      toast.success(turningOn ? `${item.label} — on` : `${item.label} — off`);
      load(false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not change that setting');
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      const result = await healthService.retryFailures();
      toast.success(
        result.recovered > 0
          ? `${result.recovered} of ${result.retried} now recorded`
          : `Tried ${result.retried} again — none went through. The cause is still there.`,
      );
      load(false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not retry');
    } finally {
      setBusy(false);
    }
  };

  // Opening a check's working also fetches its history — in the click, never in an effect.
  const toggleWorking = (checkId: string) => {
    const opening = expanded !== checkId;
    setExpanded(opening ? checkId : null);
    if (!opening || history[checkId]) return;
    healthService
      .history(checkId, 30)
      .then((rows) => setHistory((prev) => ({ ...prev, [checkId]: rows })))
      .catch(() => setHistory((prev) => ({ ...prev, [checkId]: 'failed' })));
  };

  /**
   * Prove every account's cached balance against its postings, and rebuild the ones that drifted.
   *
   * The nightly job only REPORTS drift — on purpose, because drift means something wrote to a
   * balance outside the posting engine, and correcting it silently hides that bug. Until now nothing
   * in the product could then repair it: the endpoints existed and no screen called them.
   */
  const checkBalances = async (repair: boolean) => {
    if (
      repair
      && !window.confirm(
        'Rebuild the drifted balances from their postings?\n\n'
          + 'The postings are the truth and nothing about them changes. But a drift means something '
          + 'wrote to a balance outside the accounts engine. Note which accounts are listed before '
          + 'you do this, because afterwards the evidence of that is gone.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await healthService.checkBalances(repair);
      if (repair) {
        const n = result.drifted.length;
        toast.success(`Rebuilt ${n} account${n === 1 ? '' : 's'} from their postings`);
        // Check again, so what is shown is the state after the repair rather than the drift before.
        setBalances(await healthService.checkBalances(false));
      } else {
        setBalances(result);
      }
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: unknown } } })
        ?.response?.data?.message;
      toast.error(typeof message === 'string' && message ? message : 'Could not check the balances');
    } finally {
      setBusy(false);
    }
  };

  const failing = checks.filter((c) => !c.ok);
  const canOperate = can(undefined, 'finance-period:change');
  const canRepairBalances = can(undefined, 'finance-coa:change');

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Finance Health</h1>
          <button
            className={listStyles.addButton}
            disabled={loading || busy}
            onClick={() => load(true)}
          >
            Check Again Now
          </button>
        </div>

        <FinanceNav />

        {loading ? (
          <Loader />
        ) : (
          <>
            <div
              className={`${styles.banner} ${failing.length === 0 ? styles.bannerOk : styles.bannerBad}`}
            >
              <span className={styles.bannerTitle}>
                {failing.length === 0
                  ? 'The accounts agree with the rest of the system'
                  : `${failing.length} thing${failing.length === 1 ? '' : 's'} do not add up`}
              </span>
              {failing.length === 0 ? (
                <>
                  Everything the accounts say about money owed, cash held and stock on hand matches
                  what the delivery, collection and warehouse records say. Last checked {day}.
                </>
              ) : (
                <>
                  Until these are resolved the month cannot be closed. That is deliberate: signing
                  off figures that disagree with the warehouse is the thing this check exists to
                  prevent. Last checked {day}.
                </>
              )}
            </div>

            {/* ---- Control checks ---- */}
            <div className={listStyles.listCard} style={{ marginBottom: '1.5rem' }}>
              <div className={listStyles.listCardBody}>
                <h2 className={styles.panelTitle}>What was checked</h2>

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th />
                        <th>What it is</th>
                        <th style={{ textAlign: 'right' }}>The accounts say</th>
                        <th style={{ textAlign: 'right' }}>The records say</th>
                        <th style={{ textAlign: 'right' }}>Difference</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map((check) => (
                        <React.Fragment key={check.checkId}>
                          <tr>
                            <td>
                              <span
                                className={`${styles.checkMark} ${
                                  check.ok ? styles.checkPass : styles.checkFail
                                }`}
                                aria-label={check.ok ? 'Agrees' : 'Does not agree'}
                              >
                                {check.ok ? '✓' : '!'}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontWeight: 500 }}>{check.label}</div>
                              <div className={styles.muted} style={{ fontSize: '0.78rem' }}>
                                Account {check.ledgerCode}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {/*
                                The books side of the comparison, openable. This screen's whole job
                                is to say the two sides disagree; the next question is always which
                                postings made up the books figure.
                              */}
                              <TrailAmount
                                value={check.ledgerBalance}
                                trail={check.ledgerId ? { kind: 'ledger', ledgerId: check.ledgerId } : null}
                                onOpen={openTrail}
                                format={money}
                                title={`Every posting on account ${check.ledgerCode}`}
                              />
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {/*
                                The operational side is counted from orders, collections, stock and
                                payroll rather than from journal lines, so there is no trail to open —
                                the working below names the parts it was summed from.
                              */}
                              <span className={styles.amount}>
                                {money(check.operationalValue)}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span
                                className={`${styles.amount} ${
                                  check.ok ? '' : styles.amountNegative
                                }`}
                              >
                                {check.ok ? '—' : money(check.drift)}
                              </span>
                            </td>
                            <td>
                              <button
                                className={listStyles.editButton}
                                onClick={() => toggleWorking(check.checkId)}
                              >
                                {expanded === check.checkId ? 'Hide' : 'Working'}
                              </button>
                            </td>
                          </tr>

                          {expanded === check.checkId && (
                            <tr>
                              <td colSpan={6}>
                                <div className={styles.panel}>
                                  {/* The arithmetic, not a verdict. A difference with no working
                                      leaves the reader to re-derive it by hand. */}
                                  <h3 className={styles.panelTitle}>How the records figure was reached</h3>
                                  <table className={styles.roleTable}>
                                    <tbody>
                                      {Object.entries(check.breakdown).map(([key, value]) => (
                                        <tr key={key}>
                                          <td>{humanise(key)}</td>
                                          <td style={{ textAlign: 'right', width: '12rem' }}>
                                            <span className={styles.amount}>{money(value)}</span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {check.note && (
                                    <p className={styles.readonlyNote}>{check.note}</p>
                                  )}
                                  <CheckHistory rows={history[check.checkId]} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ---- Cached balances ---- */}
            {canRepairBalances && (
              <div className={listStyles.listCard} style={{ marginBottom: '1.5rem' }}>
                <div className={listStyles.listCardBody}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      flexWrap: 'wrap',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <h2 className={styles.panelTitle} style={{ margin: 0 }}>
                      Account balances against their postings
                    </h2>
                    <button
                      className={formStyles.cancelButton}
                      disabled={busy}
                      onClick={() => checkBalances(false)}
                    >
                      Check account balances
                    </button>
                  </div>
                  <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
                    Every account keeps a running balance for speed. The postings behind it are the
                    truth. This proves the two agree; the nightly check reports a difference but never
                    corrects one.
                  </p>

                  {balances && balances.drifted.length === 0 && (
                    <div className={`${styles.banner} ${styles.bannerOk}`} style={{ marginBottom: 0 }}>
                      All {balances.checked} accounts agree with their postings.
                    </div>
                  )}

                  {balances && balances.drifted.length > 0 && (
                    <>
                      <div className={`${styles.banner} ${styles.bannerBad}`}>
                        <span className={styles.bannerTitle}>
                          {balances.drifted.length} of {balances.checked} accounts disagree with their
                          postings
                        </span>
                        Something changed these balances without going through the accounts engine.
                        Find out what before rebuilding them.
                      </div>
                      <table className={styles.roleTable}>
                        <thead>
                          <tr>
                            <th>Account</th>
                            <th style={{ textAlign: 'right' }}>Balance is off by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {balances.drifted.map((d) => (
                            <tr key={d.code}>
                              <td>
                                <span className={styles.code}>{d.code}</span> {d.name}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span className={`${styles.amount} ${styles.amountNegative}`}>
                                  {money(d.drift)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className={formStyles.formActions}>
                        <button
                          className={formStyles.submitButton}
                          disabled={busy}
                          onClick={() => checkBalances(true)}
                        >
                          Rebuild from the postings
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ---- Failed postings ---- */}
            {failures.length > 0 && (
              <div className={listStyles.listCard} style={{ marginBottom: '1.5rem' }}>
                <div className={listStyles.listCardBody}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      flexWrap: 'wrap',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <h2 className={styles.panelTitle} style={{ margin: 0 }}>
                      Not yet recorded in the accounts
                    </h2>
                    {canOperate && (
                      <button
                        className={formStyles.submitButton}
                        disabled={busy}
                        onClick={retry}
                      >
                        Try Again
                      </button>
                    )}
                  </div>

                  <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
                    These happened in the business but could not be written to the accounts —
                    usually because an account is not set up. The work itself was never blocked;
                    a delivery is never refused because of a bookkeeping problem. Retrying is
                    always safe.
                  </p>

                  <div style={{ overflowX: 'auto' }}>
                    <table className={styles.roleTable}>
                      <thead>
                        <tr>
                          <th>What</th>
                          <th>Why it did not go through</th>
                          <th style={{ textAlign: 'right' }}>Tries</th>
                          <th>Last tried</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failures.map((f) => (
                          <tr key={f.id}>
                            <td>{f.event}</td>
                            <td className={styles.muted}>{f.lastError}</td>
                            <td style={{ textAlign: 'right' }}>{f.attempts}</td>
                            <td className={styles.muted}>
                              {new Date(f.lastAttemptAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ---- Posting switches ---- */}
            {switches.length > 0 && (
              <div className={listStyles.listCard}>
                <div className={listStyles.listCardBody}>
                  <h2 className={styles.panelTitle}>What records itself in the accounts</h2>

                  <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
                    Turn these on <strong>one at a time</strong>, and look at this page the next
                    morning before turning on the next. If the accounts stop agreeing with the
                    warehouse, you will know exactly which change caused it. Turn them all on at
                    once and you will not.
                  </p>

                  <div style={{ overflowX: 'auto' }}>
                    <table className={styles.roleTable}>
                      <tbody>
                        {switches.map((item) => (
                          <tr key={item.event}>
                            <td>{item.label}</td>
                            <td style={{ width: '7rem' }}>
                              <span
                                className={`${styles.status} ${
                                  item.enabled ? styles.status_posted : styles.status_draft
                                }`}
                              >
                                {item.enabled ? 'On' : 'Off'}
                              </span>
                            </td>
                            <td style={{ width: '9rem' }}>
                              {canOperate && (
                                <button
                                  className={
                                    item.enabled
                                      ? listStyles.deleteButton
                                      : listStyles.approveButton
                                  }
                                  disabled={busy}
                                  onClick={() => toggle(item)}
                                >
                                  {item.enabled ? 'Turn off' : 'Turn on'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <TrailPanel
        stack={trailStack}
        onPush={pushTrail}
        onGoTo={goToTrail}
        onClose={closeTrail}
      />
    </Layout>
  );
};

/**
 * One check's recorded runs, newest first.
 *
 * Answers the question a drift raises next: is it new, or has it been there for weeks? A drift that
 * appeared yesterday points at yesterday's work; one that has sat there since the books opened
 * points somewhere else entirely.
 */
const CheckHistory: React.FC<{ rows: ControlHistoryRow[] | 'failed' | undefined }> = ({ rows }) => {
  if (rows === undefined) return <p className={styles.muted}>Loading the earlier runs…</p>;
  if (rows === 'failed') return <p className={styles.muted}>The earlier runs could not be loaded.</p>;
  if (rows.length === 0) return null;

  // The current run of agreeing or disagreeing days, from the newest backwards.
  let streak = 0;
  while (streak < rows.length && rows[streak].ok === rows[0].ok) streak += 1;
  const since = rows[streak - 1].day;
  const runs = (n: number) => `${n} run${n === 1 ? '' : 's'}`;
  const summary = rows[0].ok
    ? streak === rows.length
      ? `Agreed on every one of the last ${runs(rows.length)}.`
      : `Has agreed since ${since}.`
    : streak === rows.length
      ? `Has disagreed on every one of the last ${runs(rows.length)}.`
      : `Has disagreed since ${since}, ${runs(streak)} in a row.`;

  return (
    <>
      <h3 className={styles.panelTitle} style={{ marginTop: '1rem' }}>Earlier runs</h3>
      <p className={styles.readonlyNote} style={{ marginTop: 0 }}>{summary}</p>
      <table className={styles.roleTable}>
        <thead>
          <tr>
            <th>Day</th>
            <th style={{ textAlign: 'right' }}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 14).map((row) => (
            <tr key={row.day}>
              <td>{row.day}</td>
              <td style={{ textAlign: 'right' }}>
                <span className={`${styles.amount} ${row.ok ? '' : styles.amountNegative}`}>
                  {row.ok ? 'Agreed' : money(row.drift)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

export default function HealthPageWrapper() {
  return (
    <ProtectedRoute report="finance.health">
      <HealthPage />
    </ProtectedRoute>
  );
}
