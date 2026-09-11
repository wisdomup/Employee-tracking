import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import FinanceNav from '../../components/Finance/FinanceNav';
import StatementTable, { statementMoney } from '../../components/Finance/StatementTable';
import { canViewReport } from '../../utils/permissions';
import {
  financeService,
  journalService,
  partyReportService,
  statementService,
  BalanceSheet,
  Ledger,
  PartyStatement,
  PartyType,
  PayablesAgeing,
  ProfitAndLoss,
  ReceivablesAgeing,
} from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * The finance reports.
 *
 * One page with tabs rather than a route per report, matching the Stock Reports and Warehouse
 * Reports precedent — and each tab is hidden unless its own report permission is held, because
 * reports are granted one at a time.
 *
 * Figures link through to what is behind them — an account to its statement, a shop or supplier to
 * theirs — because the first thing anyone does with a surprising number is ask what is in it.
 */

type Tab =
  | 'profit-and-loss'
  | 'balance-sheet'
  | 'receivables-ageing'
  | 'payables-ageing'
  | 'party-statement'
  | 'trial-balance'
  | 'day-book'
  | 'ledger-statement';

const TABS: { id: Tab; label: string; reportId: string }[] = [
  { id: 'profit-and-loss', label: 'Profit & Loss', reportId: 'finance.profit-and-loss' },
  { id: 'balance-sheet', label: 'Balance Sheet', reportId: 'finance.balance-sheet' },
  { id: 'receivables-ageing', label: 'Shops Owe Us', reportId: 'finance.receivables-ageing' },
  { id: 'payables-ageing', label: 'We Owe Suppliers', reportId: 'finance.payables-ageing' },
  { id: 'party-statement', label: 'Shop / Supplier Statement', reportId: 'finance.party-statement' },
  { id: 'trial-balance', label: 'Trial Balance', reportId: 'finance.trial-balance' },
  { id: 'day-book', label: 'Day Book', reportId: 'finance.day-book' },
  { id: 'ledger-statement', label: 'Account Statement', reportId: 'finance.ledger-statement' },
];

function money(value: number): string {
  if (!value) return '—';
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** "2026-09" → "September 2026". */
function monthName(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
}

function dayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PK');
}

function lastDayOf(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const FinanceReportsPage: React.FC = () => {
  const router = useRouter();
  const visibleTabs = TABS.filter((t) => canViewReport(t.reportId));
  const [tab, setTab] = useState<Tab>(visibleTabs[0]?.id ?? 'trial-balance');

  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState(today());
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [ledgerId, setLedgerId] = useState('');

  // Statements work in months. Blank "from" means the fiscal year to date.
  const [plFrom, setPlFrom] = useState('');
  const [plTo, setPlTo] = useState(thisMonth());
  const [compare, setCompare] = useState(false);
  const [bsAsOf, setBsAsOf] = useState(thisMonth());
  const [showZero, setShowZero] = useState(false);

  const [arAsOf, setArAsOf] = useState(today());
  const [partyType, setPartyType] = useState<PartyType>('dealer');
  const [partyId, setPartyId] = useState('');
  const [partyFrom, setPartyFrom] = useState('');
  const [partyTo, setPartyTo] = useState('');
  const [partyList, setPartyList] = useState<{ id: string; name: string; detail?: string }[]>([]);

  const [trial, setTrial] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const [statement, setStatement] = useState<any>(null);
  const [pl, setPl] = useState<ProfitAndLoss | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [ar, setAr] = useState<ReceivablesAgeing | null>(null);
  const [ap, setAp] = useState<PayablesAgeing | null>(null);
  const [party, setParty] = useState<PartyStatement | null>(null);

  // Deep links: ?tab=…&ledgerId=…&from=…&to=…&partyType=…&partyId=…
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    if (typeof q.tab === 'string' && visibleTabs.some((t) => t.id === q.tab)) setTab(q.tab as Tab);
    if (typeof q.ledgerId === 'string') setLedgerId(q.ledgerId);
    if (typeof q.from === 'string') setFrom(q.from);
    if (typeof q.to === 'string') setTo(q.to);
    if (q.partyType === 'dealer' || q.partyType === 'vendor') setPartyType(q.partyType);
    if (typeof q.partyId === 'string') setPartyId(q.partyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  useEffect(() => {
    if (tab !== 'ledger-statement' || ledgers.length > 0) return;
    financeService
      .getLedgers({ status: 'all' })
      .then(setLedgers)
      .catch(() => toast.error('Could not load the accounts'));
  }, [tab, ledgers.length]);

  useEffect(() => {
    if (tab !== 'party-statement') return;
    partyReportService
      .parties(partyType)
      .then(setPartyList)
      .catch(() => toast.error('Could not load the list'));
  }, [tab, partyType]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'profit-and-loss') {
        setPl(await statementService.profitAndLoss({ from: plFrom || undefined, to: plTo, compare, showZero }));
      } else if (tab === 'balance-sheet') {
        setBs(await statementService.balanceSheet({ asOf: bsAsOf, showZero }));
      } else if (tab === 'receivables-ageing') {
        setAr(await partyReportService.receivablesAgeing(arAsOf));
      } else if (tab === 'payables-ageing') {
        setAp(await partyReportService.payablesAgeing());
      } else if (tab === 'party-statement') {
        if (partyId) {
          setParty(
            await partyReportService.statement({
              type: partyType,
              id: partyId,
              from: partyFrom || undefined,
              to: partyTo || undefined,
            }),
          );
        }
      } else if (tab === 'trial-balance') {
        setTrial(await journalService.trialBalance(asOf));
      } else if (tab === 'day-book') {
        setBook(await journalService.dayBook(from, to));
      } else if (ledgerId) {
        setStatement(await journalService.ledgerStatement(ledgerId, { from, to }));
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not run this report');
    } finally {
      setLoading(false);
    }
  }, [tab, asOf, from, to, ledgerId, plFrom, plTo, compare, bsAsOf, showZero, arAsOf, partyType, partyId, partyFrom, partyTo]);

  useEffect(() => {
    if (tab === 'ledger-statement' && !ledgerId) return;
    if (tab === 'party-statement' && !partyId) return;
    run();
  }, [run, tab, ledgerId, partyId]);

  /** From a statement line to that account's statement over the same months. */
  const openLedger = (fromPeriod: string, toPeriod: string) => (id: string) => {
    if (!canViewReport('finance.ledger-statement')) {
      toast.info('You do not have the Account Statement report, so this account cannot be opened.');
      return;
    }
    setLedgerId(id);
    setFrom(`${fromPeriod}-01`);
    setTo(lastDayOf(toPeriod));
    setTab('ledger-statement');
  };

  const openParty = (type: PartyType, id: string) => {
    if (!canViewReport('finance.party-statement')) {
      toast.info('You do not have the statements report, so this account cannot be opened.');
      return;
    }
    setPartyType(type);
    setPartyId(id);
    setPartyFrom('');
    setPartyTo('');
    setTab('party-statement');
  };

  if (visibleTabs.length === 0) {
    return (
      <Layout>
        <div className={listStyles.container}>
          <FinanceNav />
          <p className={styles.muted}>No finance reports have been enabled for your account.</p>
        </div>
      </Layout>
    );
  }

  const isStatement = tab === 'profit-and-loss' || tab === 'balance-sheet';

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Finance Reports</h1>
        </div>

        <FinanceNav />

        <div className={styles.tabBar}>
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.filterRow}>
          {tab === 'profit-and-loss' && (
            <>
              <label className={styles.settingLabel} htmlFor="plFrom">From</label>
              <input
                id="plFrom"
                type="month"
                className={listStyles.searchSelect}
                value={plFrom}
                onChange={(e) => setPlFrom(e.target.value)}
                title="Leave blank for the start of the fiscal year"
              />
              <label className={styles.settingLabel} htmlFor="plTo">to</label>
              <input
                id="plTo"
                type="month"
                className={listStyles.searchSelect}
                value={plTo}
                onChange={(e) => setPlTo(e.target.value)}
              />
              <label className={styles.settingLabel} style={{ display: 'flex', gap: '0.4rem' }}>
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                Compare with the months before
              </label>
            </>
          )}

          {tab === 'balance-sheet' && (
            <>
              <label className={styles.settingLabel} htmlFor="bsAsOf">As at the end of</label>
              <input
                id="bsAsOf"
                type="month"
                className={listStyles.searchSelect}
                value={bsAsOf}
                onChange={(e) => setBsAsOf(e.target.value)}
              />
            </>
          )}

          {isStatement && (
            <label className={styles.settingLabel} style={{ display: 'flex', gap: '0.4rem' }}>
              <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
              Show accounts with nothing on them
            </label>
          )}

          {tab === 'receivables-ageing' && (
            <>
              <label className={styles.settingLabel} htmlFor="arAsOf">As at</label>
              <input
                id="arAsOf"
                type="date"
                className={listStyles.searchSelect}
                value={arAsOf}
                onChange={(e) => setArAsOf(e.target.value)}
              />
            </>
          )}

          {tab === 'party-statement' && (
            <>
              <select
                className={listStyles.searchSelect}
                value={partyType}
                onChange={(e) => {
                  setPartyType(e.target.value as PartyType);
                  setPartyId('');
                  setParty(null);
                }}
                aria-label="Shop or supplier"
              >
                <option value="dealer">A shop</option>
                <option value="vendor">A supplier</option>
              </select>
              <select
                className={listStyles.searchSelect}
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                aria-label="Which one"
              >
                <option value="">{partyType === 'dealer' ? 'Choose a shop…' : 'Choose a supplier…'}</option>
                {partyList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.detail ? ` · ${p.detail}` : ''}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className={listStyles.searchSelect}
                value={partyFrom}
                onChange={(e) => setPartyFrom(e.target.value)}
                aria-label="From"
                title="Leave blank for the whole account"
              />
              <input
                type="date"
                className={listStyles.searchSelect}
                value={partyTo}
                onChange={(e) => setPartyTo(e.target.value)}
                aria-label="To"
              />
            </>
          )}

          {tab === 'trial-balance' && (
            <>
              <label className={styles.settingLabel} htmlFor="asOf">
                Balances as at
              </label>
              <input
                id="asOf"
                type="date"
                className={listStyles.searchSelect}
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </>
          )}

          {tab === 'ledger-statement' && (
            <select
              className={listStyles.searchSelect}
              value={ledgerId}
              onChange={(e) => setLedgerId(e.target.value)}
              aria-label="Account"
            >
              <option value="">Choose an account…</option>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          )}

          {(tab === 'day-book' || tab === 'ledger-statement') && (
            <>
              <input
                type="date"
                className={listStyles.searchSelect}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From"
              />
              <input
                type="date"
                className={listStyles.searchSelect}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To"
              />
            </>
          )}

          <button type="button" className={formStyles.cancelButton} onClick={run}>
            Refresh
          </button>
        </div>

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            {loading && <Loader />}

            {/* --- Profit & Loss --- */}
            {!loading && tab === 'profit-and-loss' && pl && (
              <>
                <div className={`${styles.banner} ${pl.netProfit >= 0 ? styles.bannerOk : styles.bannerBad}`}>
                  <span className={styles.bannerTitle}>
                    {pl.netProfit >= 0 ? 'Profit' : 'Loss'} of {statementMoney(Math.abs(pl.netProfit))}
                  </span>
                  {monthName(pl.from)} to {monthName(pl.to)} · fiscal year {pl.fiscalYear}.
                  {pl.compare && (
                    <>
                      {' '}The same length of time before: {pl.compare.netProfit >= 0 ? 'profit' : 'loss'} of{' '}
                      {statementMoney(Math.abs(pl.compare.netProfit))}.
                    </>
                  )}
                </div>

                {pl.warnings.map((w) => (
                  <div key={w} className={`${styles.banner} ${styles.bannerBad}`}>
                    <span className={styles.bannerTitle}>Check this first</span>
                    {w}
                  </div>
                ))}

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th style={{ textAlign: 'right' }}>
                          {monthName(pl.from)} – {monthName(pl.to)}
                        </th>
                        {pl.compare && (
                          <th style={{ textAlign: 'right' }}>
                            {monthName(pl.compareFrom!)} – {monthName(pl.compareTo!)}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      <StatementTable sections={pl.income} showCompare={Boolean(pl.compare)} onLedger={openLedger(pl.from, pl.to)} />
                      <SummaryRow label="Total income" value={pl.incomeTotal} compare={pl.compare?.incomeTotal} />

                      <StatementTable sections={pl.costOfSales} showCompare={Boolean(pl.compare)} onLedger={openLedger(pl.from, pl.to)} />
                      <SummaryRow label="Gross profit" value={pl.grossProfit} compare={pl.compare?.grossProfit} strong />

                      <StatementTable sections={pl.operatingExpenses} showCompare={Boolean(pl.compare)} onLedger={openLedger(pl.from, pl.to)} />
                      <SummaryRow label="Total operating expenses" value={pl.operatingExpensesTotal} compare={pl.compare?.operatingExpensesTotal} />
                    </tbody>
                    <tfoot>
                      <SummaryRow
                        label={pl.netProfit >= 0 ? 'Net profit' : 'Net loss'}
                        value={pl.netProfit}
                        compare={pl.compare?.netProfit}
                        strong
                        totals
                      />
                    </tfoot>
                  </table>
                </div>
                <p className={styles.readonlyNote}>
                  Figures in brackets reduce the line they sit in — sales returns and discounts reduce
                  income. Waiting and draft documents are not included; only what has been posted.
                </p>
              </>
            )}

            {/* --- Balance Sheet --- */}
            {!loading && tab === 'balance-sheet' && bs && (
              <>
                <div className={`${styles.banner} ${bs.balanced ? styles.bannerOk : styles.bannerBad}`}>
                  <span className={styles.bannerTitle}>
                    {bs.balanced
                      ? 'What the business owns equals what it owes plus what it is worth'
                      : `The Balance Sheet is out by ${statementMoney(Math.abs(bs.difference))}`}
                  </span>
                  As at the end of {monthName(bs.asOf)} · fiscal year {bs.fiscalYear}.
                  {!bs.balanced && ' This should not be possible through normal use — check the warnings below.'}
                </div>

                {bs.warnings.map((w) => (
                  <div key={w} className={`${styles.banner} ${styles.bannerBad}`}>
                    <span className={styles.bannerTitle}>Check this first</span>
                    {w}
                  </div>
                ))}

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th style={{ textAlign: 'right' }}>{monthName(bs.asOf)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <StatementTable sections={bs.assets} onLedger={openLedger(bs.fiscalYearStart, bs.asOf)} />
                      <SummaryRow label="Total assets" value={bs.totalAssets} strong />

                      <StatementTable sections={bs.liabilities} onLedger={openLedger(bs.fiscalYearStart, bs.asOf)} />
                      <SummaryRow label="Total liabilities" value={bs.totalLiabilities} />

                      <StatementTable sections={bs.equity} onLedger={openLedger(bs.fiscalYearStart, bs.asOf)} />
                      <tr>
                        <td style={{ paddingLeft: '1.6rem' }}>Profit brought forward from earlier years</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{statementMoney(bs.profitBroughtForward)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: '1.6rem' }}>
                          Profit for {bs.fiscalYear} so far
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{statementMoney(bs.profitThisYear)}</span>
                        </td>
                      </tr>
                      <SummaryRow label="Total equity" value={bs.totalEquity} />
                    </tbody>
                    <tfoot>
                      <SummaryRow
                        label="Total liabilities and equity"
                        value={Math.round((bs.totalLiabilities + bs.totalEquity) * 100) / 100}
                        strong
                        totals
                      />
                    </tfoot>
                  </table>
                </div>
                <p className={styles.readonlyNote}>
                  Profit stays in the income and expense accounts until a year is closed, so it is shown
                  here as two lines of equity. That is why this statement balances whether or not a year
                  has ever been closed.
                </p>
              </>
            )}

            {/* --- Receivables ageing --- */}
            {!loading && tab === 'receivables-ageing' && ar && (
              <>
                <div className={`${styles.banner} ${styles.bannerInfo}`}>
                  <span className={styles.bannerTitle}>
                    Shops owe {statementMoney(ar.totalOwed)}
                    {ar.bucketTotals[ar.bucketTotals.length - 1] > 0
                      && ` — ${statementMoney(ar.bucketTotals[ar.bucketTotals.length - 1])} of it ${ar.buckets[ar.buckets.length - 1].label.toLowerCase()} days old`}
                  </span>
                  As at {dayName(ar.asOf)}. Aged by when the credit was taken; every recovery and return
                  is set against the shop&apos;s oldest credit first.
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Shop</th>
                        {ar.buckets.map((b) => (
                          <th key={b.label} style={{ textAlign: 'right' }}>
                            {b.label} days
                          </th>
                        ))}
                        <th style={{ textAlign: 'right' }}>Owes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ar.rows.map((r) => (
                        <tr key={r.dealerId}>
                          <td>
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                openParty('dealer', r.dealerId);
                              }}
                            >
                              {r.shopName || r.name}
                            </a>
                            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
                              {[r.shopName ? r.name : null, r.city, r.oldestDay ? `oldest ${dayName(r.oldestDay)}` : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </td>
                          {r.amounts.map((a, i) => (
                            <td key={i} style={{ textAlign: 'right' }}>
                              <span
                                className={`${styles.amount} ${
                                  i === r.amounts.length - 1 && a > 0 ? styles.amountNegative : ''
                                }`}
                              >
                                {money(a)}
                              </span>
                            </td>
                          ))}
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount} style={{ fontWeight: 600 }}>{money(r.total)}</span>
                          </td>
                        </tr>
                      ))}
                      {ar.rows.length === 0 && (
                        <tr>
                          <td colSpan={ar.buckets.length + 2} className={styles.muted}>
                            No shop owed anything on this date.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className={styles.reportTotals}>
                        <td>Total</td>
                        {ar.bucketTotals.map((t, i) => (
                          <td key={i} style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(t)}</span>
                          </td>
                        ))}
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{money(ar.totalOwed)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {ar.inCredit.length > 0 && (
                  <div className={styles.panel}>
                    <h2 className={styles.panelTitle}>Shops holding credit with us</h2>
                    <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
                      They have paid or returned more than they owed. It is set against their next
                      delivery on credit.
                    </p>
                    <table className={styles.roleTable}>
                      <tbody>
                        {ar.inCredit.map((c) => (
                          <tr key={c.dealerId}>
                            <td>
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  openParty('dealer', c.dealerId);
                                }}
                              >
                                {c.shopName || c.name}
                              </a>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span className={styles.amount}>{money(c.amount)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className={styles.settingsGrid}>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Owed by shops</span>
                    <span className={styles.settingValue}>{statementMoney(ar.totalOwed)}</span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Less credit held</span>
                    <span className={styles.settingValue}>{statementMoney(ar.totalInCredit)}</span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Receivables in the books</span>
                    <span className={styles.settingValue}>{statementMoney(ar.netReceivable)}</span>
                  </div>
                </div>
              </>
            )}

            {/* --- Payables ageing --- */}
            {!loading && tab === 'payables-ageing' && ap && (
              <>
                {ap.disagreements > 0 ? (
                  <div className={`${styles.banner} ${styles.bannerBad}`}>
                    <span className={styles.bannerTitle}>
                      {ap.disagreements} supplier{ap.disagreements === 1 ? '’s' : 's’'} bills and payments
                      do not add up to the ledger
                    </span>
                    Something reached their account that is not a bill or a payment. Their rows are
                    flagged below; open their statement to find it.
                  </div>
                ) : (
                  <div className={`${styles.banner} ${styles.bannerOk}`}>
                    <span className={styles.bannerTitle}>
                      We owe suppliers {statementMoney(ap.totals.total)}
                      {ap.totals.overdue.some((n) => n > 0)
                        && ` — ${statementMoney(ap.totals.overdue.reduce((s, n) => s + n, 0))} of it overdue`}
                    </span>
                    As at today. Overdue is counted from each bill&apos;s due date, most overdue suppliers first.
                  </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th style={{ textAlign: 'right' }}>Not yet due</th>
                        {ap.buckets.map((b) => (
                          <th key={b.label} style={{ textAlign: 'right' }}>
                            {b.label} days late
                          </th>
                        ))}
                        <th style={{ textAlign: 'right' }}>Paid on account</th>
                        <th style={{ textAlign: 'right' }}>We owe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ap.rows.map((r) => (
                        <tr key={r.vendorId}>
                          <td>
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                openParty('vendor', r.vendorId);
                              }}
                            >
                              {r.name}
                            </a>
                            {!r.agrees && (
                              <div className={styles.amountNegative} style={{ fontSize: '0.76rem' }}>
                                Ledger says {money(r.ledgerBalance)}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(r.notDue)}</span>
                          </td>
                          {r.overdue.map((a, i) => (
                            <td key={i} style={{ textAlign: 'right' }}>
                              <span className={`${styles.amount} ${a > 0 ? styles.amountNegative : ''}`}>
                                {money(a)}
                              </span>
                            </td>
                          ))}
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{statementMoney(r.onAccount)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount} style={{ fontWeight: 600 }}>{statementMoney(r.total)}</span>
                          </td>
                        </tr>
                      ))}
                      {ap.rows.length === 0 && (
                        <tr>
                          <td colSpan={ap.buckets.length + 4} className={styles.muted}>
                            Nothing is owed to any supplier.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className={styles.reportTotals}>
                        <td>Total</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{money(ap.totals.notDue)}</span>
                        </td>
                        {ap.totals.overdue.map((t, i) => (
                          <td key={i} style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(t)}</span>
                          </td>
                        ))}
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{statementMoney(ap.totals.onAccount)}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{statementMoney(ap.totals.total)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}

            {/* --- Party statement --- */}
            {!loading && tab === 'party-statement' && !partyId && (
              <p className={styles.muted}>
                Choose a {partyType === 'dealer' ? 'shop' : 'supplier'} to see their statement.
              </p>
            )}

            {!loading && tab === 'party-statement' && partyId && party && (
              <>
                <div className={styles.settingsGrid}>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>{party.party.type === 'dealer' ? 'Shop' : 'Supplier'}</span>
                    <span className={styles.settingValue}>
                      {party.party.name}
                      {party.party.detail ? ` · ${party.party.detail}` : ''}
                    </span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>
                      {party.from ? `Balance before ${dayName(party.from)}` : 'Opening'}
                    </span>
                    <span className={styles.settingValue}>{statementMoney(party.opening)}</span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>
                      {party.party.type === 'dealer' ? 'Owes us' : 'We owe them'}
                    </span>
                    <span className={styles.settingValue}>{statementMoney(party.closing)}</span>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>#</th>
                        <th>Reference</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Debit</th>
                        <th style={{ textAlign: 'right' }}>Credit</th>
                        <th style={{ textAlign: 'right' }}>
                          {party.party.type === 'dealer' ? 'Owes us' : 'We owe'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {party.rows.map((row, i) => (
                        <tr key={i}>
                          <td>{dayName(row.day)}</td>
                          <td>
                            <a className={styles.code} href={`/finance/journal/${row.entryId}`}>
                              {row.entryNo ?? '—'}
                            </a>
                          </td>
                          <td className={styles.muted}>{row.referenceNo || '—'}</td>
                          <td>{row.narration || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.debit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.credit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={`${styles.amount} ${row.balance < 0 ? styles.amountNegative : ''}`}>
                              {statementMoney(row.balance)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {party.rows.length === 0 && (
                        <tr>
                          <td colSpan={7} className={styles.muted}>Nothing in these dates.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {party.truncated && (
                  <p className={styles.readonlyNote}>
                    Only the first 2,000 lines are shown. Narrow the dates to see the rest.
                  </p>
                )}
              </>
            )}

            {/* --- Trial balance --- */}
            {!loading && tab === 'trial-balance' && trial && (
              <>
                <div
                  className={`${styles.banner} ${trial.balanced ? styles.bannerOk : styles.bannerBad}`}
                >
                  <span className={styles.bannerTitle}>
                    {trial.balanced
                      ? 'The books balance'
                      : `The books are out by ${money(Math.abs(trial.difference))}`}
                  </span>
                  {trial.balanced
                    ? 'Every entry has an equal and opposite side. This is the check that proves the '
                      + 'ledger is internally consistent.'
                    : 'This should not be possible through normal use. Contact your developer before '
                      + 'relying on any other figure.'}
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Account</th>
                        <th>Group</th>
                        <th style={{ textAlign: 'right' }}>Debit</th>
                        <th style={{ textAlign: 'right' }}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trial.rows.map((row: any) => (
                        <tr key={row.ledgerId}>
                          <td>
                            <span className={styles.code}>{row.code}</span>
                          </td>
                          <td>{row.name}</td>
                          <td className={styles.muted}>{row.groupName}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.closingDebit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.closingCredit)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={styles.reportTotals}>
                        <td colSpan={3}>Totals</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{money(trial.totalDebit)}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={styles.amount}>{money(trial.totalCredit)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}

            {/* --- Day book --- */}
            {!loading && tab === 'day-book' && book && (
              <div style={{ overflowX: 'auto' }}>
                {book.entries.length === 0 ? (
                  <p className={styles.muted}>Nothing was posted in this range.</p>
                ) : (
                  book.entries.map((entry: any) => (
                    <div key={entry.id} className={styles.panel} style={{ marginBottom: '0.75rem' }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.75rem',
                          alignItems: 'baseline',
                          flexWrap: 'wrap',
                          marginBottom: '0.5rem',
                        }}
                      >
                        <span className={styles.code}>#{entry.entryNo ?? '—'}</span>
                        <strong>{entry.narration || '—'}</strong>
                        <span className={styles.muted}>
                          {new Date(entry.date).toLocaleDateString()}
                        </span>
                        <span className={`${styles.status} ${styles[`status_${entry.status}`]}`}>
                          {entry.status}
                        </span>
                      </div>
                      <table className={styles.roleTable}>
                        <tbody>
                          {entry.lines.map((line: any, i: number) => (
                            <tr key={i}>
                              <td>
                                <span className={styles.code}>{line.ledgerCode}</span>{' '}
                                {line.ledgerName}
                              </td>
                              <td style={{ textAlign: 'right', width: '9rem' }}>
                                <span className={styles.amount}>{money(line.debit)}</span>
                              </td>
                              <td style={{ textAlign: 'right', width: '9rem' }}>
                                <span className={styles.amount}>{money(line.credit)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* --- Account statement --- */}
            {!loading && tab === 'ledger-statement' && !ledgerId && (
              <p className={styles.muted}>Choose an account to see its statement.</p>
            )}

            {!loading && tab === 'ledger-statement' && ledgerId && statement && (
              <>
                <div className={styles.settingsGrid}>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Account</span>
                    <span className={styles.settingValue}>
                      {statement.ledger.code} · {statement.ledger.name}
                    </span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Opening</span>
                    <span className={styles.settingValue}>{money(statement.opening)}</span>
                  </div>
                  <div className={styles.settingCard}>
                    <span className={styles.settingLabel}>Closing</span>
                    <span className={styles.settingValue}>{money(statement.closing)}</span>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.roleTable}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>#</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Debit</th>
                        <th style={{ textAlign: 'right' }}>Credit</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.rows.map((row: any, i: number) => (
                        <tr key={i}>
                          <td>{new Date(row.date).toLocaleDateString()}</td>
                          <td>
                            <span className={styles.code}>{row.entryNo ?? '—'}</span>
                          </td>
                          <td>{row.narration || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.debit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>{money(row.credit)}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span
                              className={`${styles.amount} ${
                                row.runningBalance < 0 ? styles.amountNegative : ''
                              }`}
                            >
                              {row.runningBalance.toLocaleString('en-PK', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

/** A totals line inside a statement: gross profit, total assets, net profit. */
const SummaryRow: React.FC<{
  label: string;
  value: number;
  compare?: number;
  strong?: boolean;
  totals?: boolean;
}> = ({ label, value, compare, strong, totals }) => (
  <tr className={totals ? styles.reportTotals : undefined}>
    <td style={{ fontWeight: strong ? 700 : 600 }}>{label}</td>
    <td style={{ textAlign: 'right', borderTop: '2px solid #d1d5db' }}>
      <span className={`${styles.amount} ${value < 0 ? styles.amountNegative : ''}`} style={{ fontWeight: strong ? 700 : 600 }}>
        {statementMoney(value)}
      </span>
    </td>
    {compare !== undefined && (
      <td style={{ textAlign: 'right', borderTop: '2px solid #d1d5db' }}>
        <span className={`${styles.amount} ${styles.muted}`}>{statementMoney(compare)}</span>
      </td>
    )}
  </tr>
);

export default function FinanceReportsPageWrapper() {
  return (
    <ProtectedRoute reportPrefix="finance.">
      <FinanceReportsPage />
    </ProtectedRoute>
  );
}
