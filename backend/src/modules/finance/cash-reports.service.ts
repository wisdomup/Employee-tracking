import { Types } from 'mongoose';
import { AccountGroupModel } from '../../models/account-group.model';
import { LedgerModel } from '../../models/ledger.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { badRequest } from '../../utils/app-error';
import {
  AccountType,
  MONEY_EPSILON,
  REPORT_TIMEZONE,
  isValidPeriodKey,
  periodKeyFor,
  round2,
} from './finance.rules';
import { localDayKey } from '../region-sales/region-sales.rules';

/**
 * Where the cash went, and where it is now.
 *
 * ## Cash is what the cash-equivalent accounts hold — nothing else
 *
 * The office cash and the bank accounts, flagged on the chart. Money a rider is carrying is not
 * here, and neither is a cheque somebody has written: the business cannot spend either yet. A rider
 * handing cash over, or a cheque clearing, is the moment it moves.
 *
 * ## How a movement is classed
 *
 * By the account on the OTHER side of the cash, read from the chart rather than from a list of
 * codes: income, expenses and the day-to-day current accounts are operating; any other asset is
 * investing; any other liability, and equity, is financing. "Current" means the group holding the
 * engine's office-cash role for assets, and payables for liabilities — so an accountant who
 * renumbers the chart does not quietly move a loan into operating cash flow.
 *
 * Summing the non-cash side of every entry that touches cash is exact, not an estimate: every entry
 * balances, so what those lines add up to IS the cash that moved. A transfer from cash to bank has
 * no non-cash side at all, so it moves nothing — which is correct, because the business's cash did
 * not change.
 */

const COUNTED = { $in: ['posted', 'reversed'] };

type FlowClass = 'operating' | 'investing' | 'financing';

interface Context {
  cashLedgers: { id: Types.ObjectId; code: string; name: string }[];
  ledgerById: Map<string, { code: string; name: string; groupId: string }>;
  classOf: (ledgerId: string) => FlowClass;
  roles: Record<string, string>;
  warnings: string[];
}

async function loadContext(): Promise<Context> {
  const [groups, ledgers, settings] = await Promise.all([
    AccountGroupModel.find().select('_id accountType parentGroupId').lean().exec(),
    LedgerModel.find().select('_id code name groupId isCashEquivalent').lean().exec(),
    FinanceSettingsModel.findOne({ key: 'singleton' }).select('ledgerMap').lean().exec(),
  ]);

  const rawMap = (settings?.ledgerMap ?? {}) as unknown as Record<string, Types.ObjectId>;
  const roles = Object.fromEntries(Object.entries(rawMap).map(([k, v]) => [k, String(v)]));

  const groupById = new Map(
    groups.map((g) => [
      String(g._id),
      { type: g.accountType as AccountType, parentId: g.parentGroupId ? String(g.parentGroupId) : null },
    ]),
  );
  const ledgerById = new Map(
    ledgers.map((l) => [String(l._id), { code: l.code, name: l.name, groupId: String(l.groupId) }]),
  );

  const groupOfRole = (role: string) => {
    const ledger = roles[role] ? ledgerById.get(roles[role]) : undefined;
    return ledger?.groupId ?? null;
  };

  const within = (groupId: string, ancestorId: string | null): boolean => {
    if (!ancestorId) return true;
    let current: string | null = groupId;
    while (current) {
      if (current === ancestorId) return true;
      current = groupById.get(current)?.parentId ?? null;
    }
    return false;
  };

  const currentAssets = groupOfRole('officeCash') ?? groupOfRole('arTrade');
  const currentLiabilities = groupOfRole('apTrade');

  const warnings: string[] = [];
  if (!currentAssets || !currentLiabilities) {
    warnings.push(
      'The accounts for office cash or payables are not set, so investing and financing cannot be '
        + 'told apart from operating. Everything is shown as operating.',
    );
  }

  const classOf = (ledgerId: string): FlowClass => {
    const ledger = ledgerById.get(ledgerId);
    const group = ledger ? groupById.get(ledger.groupId) : undefined;
    if (!ledger || !group) return 'operating';
    if (group.type === 'income' || group.type === 'expense') return 'operating';
    if (group.type === 'equity') return 'financing';
    // Suspense sits in the asset block but is not an investment — it is money not yet explained.
    if (ledgerId === roles.suspense) return 'operating';
    if (group.type === 'asset') {
      return !currentAssets || within(ledger.groupId, currentAssets) ? 'operating' : 'investing';
    }
    return !currentLiabilities || within(ledger.groupId, currentLiabilities) ? 'operating' : 'financing';
  };

  return {
    cashLedgers: ledgers
      .filter((l) => l.isCashEquivalent)
      .map((l) => ({ id: l._id, code: l.code, name: l.name })),
    ledgerById,
    classOf,
    roles,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export interface CashFlowRow {
  ledgerId: string;
  code: string;
  name: string;
  /** Positive: cash came in from this account. Negative: cash went out to it. */
  amount: number;
}

export interface CashFlowSection {
  rows: CashFlowRow[];
  total: number;
}

export interface CashFlow {
  from: string;
  to: string;
  cashAccounts: { ledgerId: string; code: string; name: string; opening: number; closing: number }[];
  openingCash: number;
  closingCash: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  /** Opening plus the flows equals closing. Only an entry that does not balance could break it. */
  reconciles: boolean;
  difference: number;
  warnings: string[];
}

export async function cashFlow(input: { from?: string; to?: string } = {}): Promise<CashFlow> {
  const to = input.to || periodKeyFor(new Date());
  const from = input.from || to;
  for (const [value, label] of [[from, 'The start month'], [to, 'The end month']]) {
    if (!isValidPeriodKey(value)) throw badRequest(`${label} "${value}" is not a month. Use YYYY-MM.`);
  }
  if (from > to) throw badRequest('The start month is after the end month.');

  const ctx = await loadContext();
  if (ctx.cashLedgers.length === 0) {
    throw badRequest('No account is marked as cash or bank, so there is no cash to follow.');
  }
  const cashIds = ctx.cashLedgers.map((l) => l.id);

  const [cashEntryIds, balances] = await Promise.all([
    JournalLineModel.distinct('journalEntryId', {
      ledgerId: { $in: cashIds },
      status: COUNTED,
      postingPeriod: { $gte: from, $lte: to },
    }).exec(),
    JournalLineModel.aggregate<{ _id: Types.ObjectId; opening: number; closing: number }>([
      { $match: { ledgerId: { $in: cashIds }, status: COUNTED, postingPeriod: { $lte: to } } },
      {
        $group: {
          _id: '$ledgerId',
          opening: {
            $sum: { $cond: [{ $lt: ['$postingPeriod', from] }, { $subtract: ['$debit', '$credit'] }, 0] },
          },
          closing: { $sum: { $subtract: ['$debit', '$credit'] } },
        },
      },
    ]).exec(),
  ]);

  const counterparts = cashEntryIds.length
    ? await JournalLineModel.aggregate<{ _id: Types.ObjectId; flow: number }>([
      { $match: { journalEntryId: { $in: cashEntryIds }, ledgerId: { $nin: cashIds }, status: COUNTED } },
      { $group: { _id: '$ledgerId', flow: { $sum: { $subtract: ['$credit', '$debit'] } } } },
    ]).exec()
    : [];

  const sections: Record<FlowClass, CashFlowRow[]> = { operating: [], investing: [], financing: [] };
  for (const c of counterparts) {
    const amount = round2(c.flow);
    if (Math.abs(amount) < MONEY_EPSILON) continue;
    const id = String(c._id);
    const ledger = ctx.ledgerById.get(id);
    sections[ctx.classOf(id)].push({
      ledgerId: id,
      code: ledger?.code ?? '',
      name: ledger?.name ?? 'Unknown account',
      amount,
    });
  }

  const section = (rows: CashFlowRow[]): CashFlowSection => ({
    rows: rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
  });

  const balanceById = new Map(balances.map((b) => [String(b._id), b]));
  const cashAccounts = ctx.cashLedgers
    .map((l) => {
      const b = balanceById.get(String(l.id));
      return {
        ledgerId: String(l.id),
        code: l.code,
        name: l.name,
        opening: round2(b?.opening ?? 0),
        closing: round2(b?.closing ?? 0),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const operating = section(sections.operating);
  const investing = section(sections.investing);
  const financing = section(sections.financing);
  const openingCash = round2(cashAccounts.reduce((s, a) => s + a.opening, 0));
  const closingCash = round2(cashAccounts.reduce((s, a) => s + a.closing, 0));
  const netChange = round2(operating.total + investing.total + financing.total);
  const difference = round2(openingCash + netChange - closingCash);

  return {
    from,
    to,
    cashAccounts,
    openingCash,
    closingCash,
    operating,
    investing,
    financing,
    netChange,
    reconciles: Math.abs(difference) < MONEY_EPSILON,
    difference,
    warnings: ctx.warnings,
  };
}

// ---------------------------------------------------------------------------
// Cash & bank position
// ---------------------------------------------------------------------------

export interface CashPositionAccount {
  ledgerId: string;
  code: string;
  name: string;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
}

export interface CashPosition {
  from: string;
  to: string;
  accounts: CashPositionAccount[];
  totals: { opening: number; moneyIn: number; moneyOut: number; closing: number };
  /** Cheques written and not yet on the bank statement on `to`. The bank still shows this money. */
  unclearedCheques: number;
  /** What is left once those cheques clear — the figure that is actually safe to spend. */
  availableAfterCheques: number;
}

function assertDay(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(`${label} "${value}" is not a date. Use YYYY-MM-DD.`);
  }
}

/**
 * Every cash and bank account over a range of days: what it started with, what came in, what went
 * out, what it ended with — and how much of the bank balance is already spoken for by cheques that
 * have not cleared yet.
 */
export async function cashPosition(input: { from?: string; to?: string } = {}): Promise<CashPosition> {
  const to = input.to || localDayKey(new Date());
  const from = input.from || `${to.slice(0, 7)}-01`;
  assertDay(from, 'The start date');
  assertDay(to, 'The end date');
  if (from > to) throw badRequest('The start date is after the end date.');

  const ctx = await loadContext();
  const ids = [...ctx.cashLedgers.map((l) => l.id)];
  const chequesIssued = ctx.roles.chequesIssued ? new Types.ObjectId(ctx.roles.chequesIssued) : null;
  if (chequesIssued) ids.push(chequesIssued);

  const rows = await JournalLineModel.aggregate<{
    _id: Types.ObjectId;
    opening: number;
    moneyIn: number;
    moneyOut: number;
    closing: number;
  }>([
    { $match: { ledgerId: { $in: ids }, status: COUNTED } },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: REPORT_TIMEZONE } },
      },
    },
    { $match: { day: { $lte: to } } },
    {
      $group: {
        _id: '$ledgerId',
        opening: { $sum: { $cond: [{ $lt: ['$day', from] }, { $subtract: ['$debit', '$credit'] }, 0] } },
        moneyIn: { $sum: { $cond: [{ $gte: ['$day', from] }, '$debit', 0] } },
        moneyOut: { $sum: { $cond: [{ $gte: ['$day', from] }, '$credit', 0] } },
        closing: { $sum: { $subtract: ['$debit', '$credit'] } },
      },
    },
  ]).exec();
  const byId = new Map(rows.map((r) => [String(r._id), r]));

  const accounts = ctx.cashLedgers
    .map((l) => {
      const r = byId.get(String(l.id));
      return {
        ledgerId: String(l.id),
        code: l.code,
        name: l.name,
        opening: round2(r?.opening ?? 0),
        moneyIn: round2(r?.moneyIn ?? 0),
        moneyOut: round2(r?.moneyOut ?? 0),
        closing: round2(r?.closing ?? 0),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const totals = {
    opening: round2(accounts.reduce((s, a) => s + a.opening, 0)),
    moneyIn: round2(accounts.reduce((s, a) => s + a.moneyIn, 0)),
    moneyOut: round2(accounts.reduce((s, a) => s + a.moneyOut, 0)),
    closing: round2(accounts.reduce((s, a) => s + a.closing, 0)),
  };

  // Cheques Issued carries a credit balance while cheques are outstanding. Negating a zero balance
  // gives -0, which prints as "(0.00)" on a statement, so nothing-outstanding is normalised to 0.
  const outstanding = chequesIssued ? -(byId.get(String(chequesIssued))?.closing ?? 0) : 0;
  const unclearedCheques = Math.abs(outstanding) < MONEY_EPSILON ? 0 : round2(outstanding);

  return {
    from,
    to,
    accounts,
    totals,
    unclearedCheques,
    availableAfterCheques: round2(totals.closing - unclearedCheques),
  };
}
