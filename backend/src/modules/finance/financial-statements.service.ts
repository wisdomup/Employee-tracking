import { Types } from 'mongoose';
import { AccountGroupModel } from '../../models/account-group.model';
import { LedgerModel } from '../../models/ledger.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { badRequest } from '../../utils/app-error';
import {
  AccountType,
  MONEY_EPSILON,
  fiscalYearFor,
  isValidPeriodKey,
  periodKeyFor,
  round2,
} from './finance.rules';

/**
 * The Profit & Loss statement and the Balance Sheet.
 *
 * ## These are queries, not machinery
 *
 * Both are sums over the posting lines, grouped by the chart. No figure here is stored, and no
 * posting happens to produce them — which is what makes them trustworthy: they cannot drift from
 * the ledger because they ARE the ledger, read a particular way.
 *
 * ## Months, not days
 *
 * Both filter on `postingPeriod`, the `YYYY-MM` each line was stamped with in the business's own
 * timezone. A date-range filter on the raw timestamp would put the last evening of a month into
 * the next one whenever the server's clock is not in Pakistan — silently, on exactly the entries
 * an accountant looks at hardest at month-end.
 *
 * ## Reversed lines are counted
 *
 * A reversal leaves the original lines in place, marked `reversed`, and posts opposite lines of
 * its own. Only counting both makes the pair net to zero — the trial balance counts them the same
 * way, and these statements must agree with it to the paisa.
 *
 * ## No year-end close is needed for the Balance Sheet to balance
 *
 * Profit sits in the income and expense accounts until a year is closed into retained earnings,
 * and no close has ever run. So the equity section adds two computed lines — profit brought
 * forward from earlier years, and profit for this year so far — taken from those same accounts.
 * Assets then equal liabilities plus equity by construction, whether or not a close ever happens.
 */

const COUNTED = { $in: ['posted', 'reversed'] };

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

function assertPeriod(value: string, label: string): void {
  if (!isValidPeriodKey(value)) throw badRequest(`${label} "${value}" is not a month. Use YYYY-MM.`);
}

function periodIndex(period: string): number {
  return Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;
}

function periodFromIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The first month of the fiscal year a period falls in: 2026-03 with a July start → 2025-07. */
export function fiscalYearStartPeriod(period: string, startMonth: number): string {
  const fiscalYear = fiscalYearFor(period, startMonth);
  return `${fiscalYear.slice(0, 4)}-${String(startMonth).padStart(2, '0')}`;
}

async function fiscalStartMonth(): Promise<number> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('fiscalYearStartMonth')
    .lean()
    .exec();
  return settings?.fiscalYearStartMonth ?? 7;
}

async function ledgerForRole(role: string): Promise<string | null> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('ledgerMap')
    .lean()
    .exec();
  const map = settings?.ledgerMap as unknown as Record<string, Types.ObjectId> | undefined;
  return map?.[role] ? String(map[role]) : null;
}

// ---------------------------------------------------------------------------
// The chart, and sums over it
// ---------------------------------------------------------------------------

interface ChartGroup {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  parentId: string | null;
  sortOrder: number;
}

interface ChartLedger {
  id: string;
  code: string;
  name: string;
  groupId: string;
}

interface Chart {
  groups: ChartGroup[];
  ledgers: ChartLedger[];
  groupById: Map<string, ChartGroup>;
}

type Sums = Map<string, { debit: number; credit: number }>;

async function loadChart(): Promise<Chart> {
  // Inactive groups and ledgers included: a deactivated account can still carry history, and a
  // statement that dropped it would stop agreeing with the trial balance.
  const [groups, ledgers] = await Promise.all([
    AccountGroupModel.find().select('_id code name accountType parentGroupId sortOrder').lean().exec(),
    LedgerModel.find().select('_id code name groupId').lean().exec(),
  ]);

  const chartGroups: ChartGroup[] = groups.map((g) => ({
    id: String(g._id),
    code: g.code,
    name: g.name,
    accountType: g.accountType as AccountType,
    parentId: g.parentGroupId ? String(g.parentGroupId) : null,
    sortOrder: g.sortOrder ?? 0,
  }));

  return {
    groups: chartGroups,
    ledgers: ledgers.map((l) => ({
      id: String(l._id),
      code: l.code,
      name: l.name,
      groupId: String(l.groupId),
    })),
    groupById: new Map(chartGroups.map((g) => [g.id, g])),
  };
}

async function sumsByLedger(postingPeriod: Record<string, string>): Promise<Sums> {
  const rows = await JournalLineModel.aggregate<{ _id: Types.ObjectId; debit: number; credit: number }>([
    { $match: { status: COUNTED, postingPeriod } },
    { $group: { _id: '$ledgerId', debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
  ]).exec();
  return new Map(rows.map((r) => [String(r._id), { debit: r.debit, credit: r.credit }]));
}

/** A balance on the side its account type normally sits: assets and expenses as debits, the rest as credits. */
function natural(type: AccountType, sums?: { debit: number; credit: number }): number {
  if (!sums) return 0;
  const net = sums.debit - sums.credit;
  return round2(type === 'asset' || type === 'expense' ? net : -net);
}

/** Income less expenses over whichever lines `sums` holds. */
function profitOf(chart: Chart, sums: Sums): number {
  let profit = 0;
  for (const ledger of chart.ledgers) {
    const group = chart.groupById.get(ledger.groupId);
    if (!group) continue;
    if (group.accountType === 'income') profit += natural('income', sums.get(ledger.id));
    if (group.accountType === 'expense') profit -= natural('expense', sums.get(ledger.id));
  }
  return round2(profit);
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface StatementLine {
  ledgerId: string;
  code: string;
  name: string;
  amount: number;
  /** The same account over the comparison window, when one was asked for. */
  compare?: number;
}

export interface StatementSection {
  groupId: string;
  code: string;
  name: string;
  lines: StatementLine[];
  sections: StatementSection[];
  total: number;
  compareTotal?: number;
}

function byOrder(a: ChartGroup, b: ChartGroup): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
}

/**
 * Nest the chart's groups into statement sections, each carrying its accounts and its sub-groups.
 *
 * Built from the chart as the accountant has shaped it, not from fixed codes, so a group they add
 * appears in the right place with no change here. Accounts with nothing on them are left out
 * unless asked for — a statement listing sixty zeroes hides the six figures that matter.
 */
function buildSections(
  chart: Chart,
  topGroups: ChartGroup[],
  sums: Sums,
  compareSums: Sums | null,
  showZero: boolean,
): StatementSection[] {
  const childrenOf = new Map<string, ChartGroup[]>();
  for (const g of chart.groups) {
    if (!g.parentId) continue;
    childrenOf.set(g.parentId, [...(childrenOf.get(g.parentId) ?? []), g]);
  }
  const ledgersOf = new Map<string, ChartLedger[]>();
  for (const l of chart.ledgers) {
    ledgersOf.set(l.groupId, [...(ledgersOf.get(l.groupId) ?? []), l]);
  }

  const hasFigure = (value?: number) => value !== undefined && Math.abs(value) >= MONEY_EPSILON;

  const build = (group: ChartGroup): StatementSection => {
    const lines = (ledgersOf.get(group.id) ?? [])
      .map((l) => ({
        ledgerId: l.id,
        code: l.code,
        name: l.name,
        amount: natural(group.accountType, sums.get(l.id)),
        compare: compareSums ? natural(group.accountType, compareSums.get(l.id)) : undefined,
      }))
      .filter((l) => showZero || hasFigure(l.amount) || hasFigure(l.compare))
      .sort((a, b) => a.code.localeCompare(b.code));

    const sections = (childrenOf.get(group.id) ?? [])
      .sort(byOrder)
      .map(build)
      .filter((s) => showZero || s.lines.length > 0 || s.sections.length > 0);

    const total = round2(
      lines.reduce((s, l) => s + l.amount, 0) + sections.reduce((s, c) => s + c.total, 0),
    );
    const compareTotal = compareSums
      ? round2(
        lines.reduce((s, l) => s + (l.compare ?? 0), 0)
          + sections.reduce((s, c) => s + (c.compareTotal ?? 0), 0),
      )
      : undefined;

    return { groupId: group.id, code: group.code, name: group.name, lines, sections, total, compareTotal };
  };

  return topGroups
    .sort(byOrder)
    .map(build)
    .filter((s) => showZero || s.lines.length > 0 || s.sections.length > 0);
}

function topGroupsOf(chart: Chart, type: AccountType): ChartGroup[] {
  return chart.groups.filter((g) => !g.parentId && g.accountType === type);
}

function sumTotals(sections: StatementSection[]): { total: number; compareTotal: number } {
  return {
    total: round2(sections.reduce((s, x) => s + x.total, 0)),
    compareTotal: round2(sections.reduce((s, x) => s + (x.compareTotal ?? 0), 0)),
  };
}

/**
 * The top-level group holding Cost of Goods Sold, found through the engine's `cogs` role.
 *
 * By role rather than by code, for the same reason the posting engine resolves accounts by role:
 * an accountant who renumbers "Cost of Sales" must not silently turn gross profit into net.
 */
async function costOfSalesGroupId(chart: Chart): Promise<string | null> {
  const cogsLedgerId = await ledgerForRole('cogs');
  const ledger = cogsLedgerId ? chart.ledgers.find((l) => l.id === cogsLedgerId) : undefined;
  let group = ledger ? chart.groupById.get(ledger.groupId) : undefined;
  while (group?.parentId) group = chart.groupById.get(group.parentId);
  return group?.accountType === 'expense' ? group.id : null;
}

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------

export interface ProfitAndLoss {
  from: string;
  to: string;
  fiscalYear: string;
  compareFrom?: string;
  compareTo?: string;
  income: StatementSection[];
  incomeTotal: number;
  costOfSales: StatementSection[];
  costOfSalesTotal: number;
  grossProfit: number;
  operatingExpenses: StatementSection[];
  operatingExpensesTotal: number;
  netProfit: number;
  compare: {
    incomeTotal: number;
    costOfSalesTotal: number;
    grossProfit: number;
    operatingExpensesTotal: number;
    netProfit: number;
  } | null;
  warnings: string[];
}

export async function profitAndLoss(
  input: { from?: string; to?: string; compare?: boolean; showZero?: boolean } = {},
): Promise<ProfitAndLoss> {
  const startMonth = await fiscalStartMonth();

  // Default: this fiscal year to date — the question an owner actually asks.
  const to = input.to || periodKeyFor(new Date());
  assertPeriod(to, 'The end month');
  const from = input.from || fiscalYearStartPeriod(to, startMonth);
  assertPeriod(from, 'The start month');
  if (periodIndex(from) > periodIndex(to)) throw badRequest('The start month is after the end month.');

  // The comparison is the window of the same length immediately before, so "Jul–Sep" is set
  // beside "Apr–Jun" rather than beside a period of a different length.
  const span = periodIndex(to) - periodIndex(from) + 1;
  const compareFrom = input.compare ? periodFromIndex(periodIndex(from) - span) : undefined;
  const compareTo = input.compare ? periodFromIndex(periodIndex(from) - 1) : undefined;

  const [chart, sums, compareSums] = await Promise.all([
    loadChart(),
    sumsByLedger({ $gte: from, $lte: to }),
    compareFrom && compareTo
      ? sumsByLedger({ $gte: compareFrom, $lte: compareTo })
      : Promise.resolve(null),
  ]);
  const showZero = Boolean(input.showZero);
  const cosGroupId = await costOfSalesGroupId(chart);

  const expenseTop = topGroupsOf(chart, 'expense');
  const income = buildSections(chart, topGroupsOf(chart, 'income'), sums, compareSums, showZero);
  const costOfSales = buildSections(
    chart,
    expenseTop.filter((g) => g.id === cosGroupId),
    sums,
    compareSums,
    showZero,
  );
  const operatingExpenses = buildSections(
    chart,
    expenseTop.filter((g) => g.id !== cosGroupId),
    sums,
    compareSums,
    showZero,
  );

  const inc = sumTotals(income);
  const cos = sumTotals(costOfSales);
  const opex = sumTotals(operatingExpenses);

  const grossProfit = round2(inc.total - cos.total);
  const netProfit = round2(grossProfit - opex.total);

  const warnings: string[] = [];
  if (!cosGroupId) {
    warnings.push(
      'No account is set for Cost of Goods Sold, so gross profit cannot be separated from net '
        + 'profit. Every expense is shown as an operating expense.',
    );
  }
  // Every income and expense account is reached through the tree above. One that was not — sitting
  // in a group that no longer exists — would leave net profit wrong, and that is worth saying.
  const direct = profitOf(chart, sums);
  if (Math.abs(direct - netProfit) >= MONEY_EPSILON) {
    warnings.push(
      `Some income or expense accounts sit outside the chart's groups, and ${Math.abs(round2(direct - netProfit)).toFixed(2)} `
        + 'is missing from this statement because of it. Fix the account groups before relying on it.',
    );
  }

  return {
    from,
    to,
    fiscalYear: fiscalYearFor(to, startMonth),
    compareFrom,
    compareTo,
    income,
    incomeTotal: inc.total,
    costOfSales,
    costOfSalesTotal: cos.total,
    grossProfit,
    operatingExpenses,
    operatingExpensesTotal: opex.total,
    netProfit,
    compare: compareSums
      ? {
        incomeTotal: inc.compareTotal,
        costOfSalesTotal: cos.compareTotal,
        grossProfit: round2(inc.compareTotal - cos.compareTotal),
        operatingExpensesTotal: opex.compareTotal,
        netProfit: round2(inc.compareTotal - cos.compareTotal - opex.compareTotal),
      }
      : null,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------

export interface BalanceSheet {
  asOf: string;
  fiscalYear: string;
  fiscalYearStart: string;
  assets: StatementSection[];
  totalAssets: number;
  liabilities: StatementSection[];
  totalLiabilities: number;
  equity: StatementSection[];
  equityAccountsTotal: number;
  /** Profit from every fiscal year before this one that has not been closed into equity. */
  profitBroughtForward: number;
  /** Profit from the start of this fiscal year to the end of `asOf`. */
  profitThisYear: number;
  totalEquity: number;
  balanced: boolean;
  difference: number;
  warnings: string[];
}

export async function balanceSheet(
  input: { asOf?: string; showZero?: boolean } = {},
): Promise<BalanceSheet> {
  const startMonth = await fiscalStartMonth();
  const asOf = input.asOf || periodKeyFor(new Date());
  assertPeriod(asOf, 'The month');
  const fyStart = fiscalYearStartPeriod(asOf, startMonth);
  const showZero = Boolean(input.showZero);

  const [chart, toDate, beforeYear, thisYear, openingEquityId, suspenseId] = await Promise.all([
    loadChart(),
    sumsByLedger({ $lte: asOf }),
    sumsByLedger({ $lt: fyStart }),
    sumsByLedger({ $gte: fyStart, $lte: asOf }),
    ledgerForRole('openingEquity'),
    ledgerForRole('suspense'),
  ]);

  const assets = buildSections(chart, topGroupsOf(chart, 'asset'), toDate, null, showZero);
  const liabilities = buildSections(chart, topGroupsOf(chart, 'liability'), toDate, null, showZero);
  const equity = buildSections(chart, topGroupsOf(chart, 'equity'), toDate, null, showZero);

  const totalAssets = sumTotals(assets).total;
  const totalLiabilities = sumTotals(liabilities).total;
  const equityAccountsTotal = sumTotals(equity).total;
  const profitBroughtForward = profitOf(chart, beforeYear);
  const profitThisYear = profitOf(chart, thisYear);
  const totalEquity = round2(equityAccountsTotal + profitBroughtForward + profitThisYear);
  const difference = round2(totalAssets - totalLiabilities - totalEquity);

  const warnings: string[] = [];

  const balanceOf = (ledgerId: string | null) => {
    if (!ledgerId) return 0;
    const ledger = chart.ledgers.find((l) => l.id === ledgerId);
    const group = ledger ? chart.groupById.get(ledger.groupId) : undefined;
    return group ? natural(group.accountType, toDate.get(ledgerId)) : 0;
  };

  const openingEquity = balanceOf(openingEquityId);
  if (Math.abs(openingEquity) >= MONEY_EPSILON) {
    warnings.push(
      `Opening Balance Equity reads ${openingEquity.toFixed(2)}. It must be zero once the opening `
        + 'balances are complete — until it is, the opening figures do not agree with each other.',
    );
  }

  const suspense = balanceOf(suspenseId);
  if (Math.abs(suspense) >= MONEY_EPSILON) {
    warnings.push(
      `Suspense reads ${suspense.toFixed(2)}. Something was posted there that belongs in a real `
        + 'account, and this Balance Sheet is wrong by that much until it is moved.',
    );
  }

  const orphaned = chart.ledgers.filter(
    (l) => !chart.groupById.has(l.groupId) && toDate.has(l.id),
  );
  if (orphaned.length > 0) {
    warnings.push(
      `${orphaned.map((l) => `${l.code} ${l.name}`).join(', ')} sit in a group that no longer `
        + 'exists and are missing from this statement.',
    );
  }

  return {
    asOf,
    fiscalYear: fiscalYearFor(asOf, startMonth),
    fiscalYearStart: fyStart,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    equityAccountsTotal,
    profitBroughtForward,
    profitThisYear,
    totalEquity,
    balanced: Math.abs(difference) < MONEY_EPSILON,
    difference,
    warnings,
  };
}
