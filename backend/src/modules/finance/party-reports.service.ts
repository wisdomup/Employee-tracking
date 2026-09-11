import { Types } from 'mongoose';
import { JournalLineModel } from '../../models/journal-line.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { LedgerModel } from '../../models/ledger.model';
import { DealerModel } from '../../models/dealer.model';
import { VendorModel } from '../../models/vendor.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { SupplierPaymentModel } from '../../models/supplier-payment.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { badRequest, notFound } from '../../utils/app-error';
import { MONEY_EPSILON, REPORT_TIMEZONE, round2 } from './finance.rules';
import { localDayKey } from '../region-sales/region-sales.rules';
import { paidByBill } from './payments.service';
import { payableByVendor } from './vendors.service';

/**
 * Who owes us, who we owe, and how long it has been — plus the statement for any one of them.
 *
 * ## Receivables are aged from the ledger; payables from the bills
 *
 * A shop's credit has no due date — it is taken on delivery and recovered when the rider next
 * calls — so the only honest age is how long ago it was taken. That comes straight from the shop's
 * lines on Accounts Receivable, applying every recovery and return to the OLDEST credit first.
 * Because it is the ledger, it can be run as at any past day and it always totals to the AR
 * balance.
 *
 * A supplier's bill does have a due date, and "how overdue" is the question a payment run asks.
 * So payables are aged from the bills against their due dates, with money paid on account shown
 * as its own column — and each supplier's figure is checked against their share of the ledger, so
 * a disagreement is visible rather than trusted.
 */

const COUNTED = { $in: ['posted', 'reversed'] };
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Days and buckets
// ---------------------------------------------------------------------------

function assertDay(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(`${label} "${value}" is not a date. Use YYYY-MM-DD.`);
  }
}

/** Whole calendar days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export interface AgeingBucket {
  label: string;
  /** Inclusive lower bound in days. */
  from: number;
  /** Inclusive upper bound in days, or null for the last, open-ended bucket. */
  to: number | null;
}

/** [30, 60, 90] → 0–30, 31–60, 61–90, Over 90. */
function bucketsFrom(limits: number[], startAt: number): AgeingBucket[] {
  const sorted = [...limits].filter((n) => n > 0).sort((a, b) => a - b);
  const out: AgeingBucket[] = [];
  let lower = startAt;
  for (const upper of sorted) {
    out.push({ label: `${lower}–${upper}`, from: lower, to: upper });
    lower = upper + 1;
  }
  out.push({ label: `Over ${sorted[sorted.length - 1] ?? 0}`, from: lower, to: null });
  return out;
}

function bucketIndex(buckets: AgeingBucket[], days: number): number {
  const i = buckets.findIndex((b) => days >= b.from && (b.to === null || days <= b.to));
  return i === -1 ? buckets.length - 1 : i;
}

async function settingsFor(): Promise<{ limits: number[]; map: Record<string, Types.ObjectId> }> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('agingBuckets ledgerMap')
    .lean()
    .exec();
  return {
    limits: settings?.agingBuckets?.length ? settings.agingBuckets : [30, 60, 90],
    map: (settings?.ledgerMap ?? {}) as unknown as Record<string, Types.ObjectId>,
  };
}

// ---------------------------------------------------------------------------
// Receivables ageing
// ---------------------------------------------------------------------------

interface DayAmount {
  day: string;
  amount: number;
}

/**
 * Apply every credit to the oldest open debit first.
 *
 * Returns what is still open, by the day it arose, and any credit left over once every debit is
 * cleared — a shop that has paid in advance, or returned more than it still owed.
 */
export function applyOldestFirst(days: DayAmount[]): { open: DayAmount[]; unapplied: number } {
  const open: DayAmount[] = [];
  let unapplied = 0;

  for (const { day, amount } of days) {
    if (amount > MONEY_EPSILON) {
      let remaining = amount;
      // An advance already sitting there pays the new credit before anything is left open.
      const used = Math.min(unapplied, remaining);
      remaining = round2(remaining - used);
      unapplied = round2(unapplied - used);
      if (remaining > MONEY_EPSILON) open.push({ day, amount: remaining });
    } else if (amount < -MONEY_EPSILON) {
      let payment = -amount;
      while (payment > MONEY_EPSILON && open.length > 0) {
        const oldest = open[0];
        const used = Math.min(oldest.amount, payment);
        oldest.amount = round2(oldest.amount - used);
        payment = round2(payment - used);
        if (oldest.amount <= MONEY_EPSILON) open.shift();
      }
      unapplied = round2(unapplied + payment);
    }
  }

  return { open, unapplied };
}

export interface ReceivablesAgeingRow {
  dealerId: string;
  name: string;
  shopName?: string;
  phone?: string;
  city?: string;
  total: number;
  /** Amount in each bucket, in the order of `buckets`. */
  amounts: number[];
  /** The day the oldest credit still open was taken. */
  oldestDay?: string;
}

export interface ReceivablesAgeing {
  asOf: string;
  buckets: AgeingBucket[];
  rows: ReceivablesAgeingRow[];
  bucketTotals: number[];
  totalOwed: number;
  /** Shops that owe nothing and have credit with us instead. */
  inCredit: { dealerId: string; name: string; shopName?: string; amount: number }[];
  totalInCredit: number;
  /** Owed less credit held — equal to the Accounts Receivable balance on `asOf`. */
  netReceivable: number;
}

async function dealerDetails(ids: string[]) {
  const dealers = await DealerModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select('_id name shopName phone address.city')
    .lean()
    .exec();
  return new Map(
    dealers.map((d) => [
      String(d._id),
      {
        name: d.name,
        shopName: d.shopName,
        phone: d.phone,
        city: (d as { address?: { city?: string } }).address?.city,
      },
    ]),
  );
}

export async function receivablesAgeing(input: { asOf?: string } = {}): Promise<ReceivablesAgeing> {
  const asOf = input.asOf || localDayKey(new Date());
  assertDay(asOf, 'The date');

  const { limits, map } = await settingsFor();
  const buckets = bucketsFrom(limits, 0);
  if (!map.arTrade) throw badRequest('No account is set for receivables, so there is nothing to age.');

  // Grouped by shop and by the business's own calendar day, so a delivery at 11pm and its
  // recovery the next morning land on the days the rider would say they happened.
  const grouped = await JournalLineModel.aggregate<{ _id: { dealer: Types.ObjectId; day: string }; amount: number }>([
    {
      $match: {
        ledgerId: new Types.ObjectId(String(map.arTrade)),
        status: COUNTED,
        'subledgerRef.type': 'dealer',
      },
    },
    {
      $project: {
        dealer: '$subledgerRef.id',
        day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: REPORT_TIMEZONE } },
        signed: { $subtract: ['$debit', '$credit'] },
      },
    },
    { $match: { day: { $lte: asOf } } },
    { $group: { _id: { dealer: '$dealer', day: '$day' }, amount: { $sum: '$signed' } } },
    { $sort: { '_id.day': 1 } },
  ]).exec();

  const byDealer = new Map<string, DayAmount[]>();
  for (const g of grouped) {
    const id = String(g._id.dealer);
    byDealer.set(id, [...(byDealer.get(id) ?? []), { day: g._id.day, amount: round2(g.amount) }]);
  }

  const details = await dealerDetails([...byDealer.keys()]);
  const rows: ReceivablesAgeingRow[] = [];
  const inCredit: ReceivablesAgeing['inCredit'] = [];

  for (const [dealerId, days] of byDealer) {
    const { open, unapplied } = applyOldestFirst(days);
    const who = details.get(dealerId) ?? { name: 'Unknown shop' };

    if (open.length === 0) {
      if (unapplied > MONEY_EPSILON) {
        inCredit.push({ dealerId, name: who.name, shopName: (who as { shopName?: string }).shopName, amount: unapplied });
      }
      continue;
    }

    const amounts = buckets.map(() => 0);
    for (const o of open) {
      const i = bucketIndex(buckets, daysBetween(o.day, asOf));
      amounts[i] = round2(amounts[i] + o.amount);
    }

    rows.push({
      dealerId,
      ...who,
      total: round2(open.reduce((s, o) => s + o.amount, 0)),
      amounts,
      oldestDay: open[0].day,
    });
  }

  rows.sort((a, b) => b.total - a.total);
  inCredit.sort((a, b) => b.amount - a.amount);

  const bucketTotals = buckets.map((_, i) => round2(rows.reduce((s, r) => s + r.amounts[i], 0)));
  const totalOwed = round2(rows.reduce((s, r) => s + r.total, 0));
  const totalInCredit = round2(inCredit.reduce((s, c) => s + c.amount, 0));

  return {
    asOf,
    buckets,
    rows,
    bucketTotals,
    totalOwed,
    inCredit,
    totalInCredit,
    netReceivable: round2(totalOwed - totalInCredit),
  };
}

// ---------------------------------------------------------------------------
// Payables ageing
// ---------------------------------------------------------------------------

export interface PayablesAgeingRow {
  vendorId: string;
  name: string;
  /** Bills whose due date has not arrived. */
  notDue: number;
  /** Overdue amounts, in the order of `buckets`, by days past the due date. */
  overdue: number[];
  /** Posted payments not set against any bill — reduces what is owed. Zero or negative. */
  onAccount: number;
  total: number;
  /** The supplier's share of Accounts Payable in the ledger. */
  ledgerBalance: number;
  /** False when the bills and payments do not add up to the ledger — see the service header. */
  agrees: boolean;
  oldestDueDate?: string;
}

export interface PayablesAgeing {
  asOf: string;
  buckets: AgeingBucket[];
  rows: PayablesAgeingRow[];
  totals: {
    notDue: number;
    overdue: number[];
    onAccount: number;
    total: number;
    ledgerBalance: number;
  };
  disagreements: number;
}

/**
 * What is owed to each supplier today, by how overdue it is.
 *
 * As at today only. Aged from documents, and a document's state is its state now — a bill
 * cancelled last week is not owed, whatever it was a month ago. A past date would need a history
 * of every cancellation, which is what the receivables ageing's ledger method provides and why the
 * two are built differently.
 */
export async function payablesAgeing(): Promise<PayablesAgeing> {
  const asOf = localDayKey(new Date());
  const { limits } = await settingsFor();
  const buckets = bucketsFrom(limits, 1);

  const [bills, payments] = await Promise.all([
    PurchaseBillModel.find({ status: 'posted' })
      .select('_id vendorId dueDate totalAmount')
      .lean()
      .exec(),
    SupplierPaymentModel.find({ status: 'posted' })
      .select('vendorId amount allocations')
      .lean()
      .exec(),
  ]);

  const paid = await paidByBill(bills.map((b) => b._id));

  interface Acc {
    notDue: number;
    overdue: number[];
    onAccount: number;
    oldestDueDate?: string;
  }
  const byVendor = new Map<string, Acc>();
  const accFor = (id: string): Acc => {
    let acc = byVendor.get(id);
    if (!acc) {
      acc = { notDue: 0, overdue: buckets.map(() => 0), onAccount: 0 };
      byVendor.set(id, acc);
    }
    return acc;
  };

  for (const bill of bills) {
    const outstanding = round2(bill.totalAmount - (paid.get(String(bill._id)) ?? 0));
    if (outstanding <= MONEY_EPSILON) continue;

    const acc = accFor(String(bill.vendorId));
    const due = localDayKey(bill.dueDate);
    const late = daysBetween(due, asOf);
    if (late <= 0) {
      acc.notDue = round2(acc.notDue + outstanding);
    } else {
      const i = bucketIndex(buckets, late);
      acc.overdue[i] = round2(acc.overdue[i] + outstanding);
    }
    if (!acc.oldestDueDate || due < acc.oldestDueDate) acc.oldestDueDate = due;
  }

  for (const p of payments) {
    const unallocated = round2(p.amount - p.allocations.reduce((s, a) => s + a.amount, 0));
    if (unallocated <= MONEY_EPSILON) continue;
    const acc = accFor(String(p.vendorId));
    acc.onAccount = round2(acc.onAccount - unallocated);
  }

  const vendorIds = [...byVendor.keys()].map((id) => new Types.ObjectId(id));
  const [vendors, ledger] = await Promise.all([
    VendorModel.find({ _id: { $in: vendorIds } }).select('_id name').lean().exec(),
    payableByVendor(vendorIds),
  ]);
  const nameById = new Map(vendors.map((v) => [String(v._id), v.name]));

  const rows: PayablesAgeingRow[] = [...byVendor.entries()]
    .map(([vendorId, acc]) => {
      const total = round2(acc.notDue + acc.overdue.reduce((s, n) => s + n, 0) + acc.onAccount);
      const ledgerBalance = ledger.get(vendorId) ?? 0;
      return {
        vendorId,
        name: nameById.get(vendorId) ?? 'Unknown supplier',
        notDue: acc.notDue,
        overdue: acc.overdue,
        onAccount: acc.onAccount,
        total,
        ledgerBalance,
        agrees: Math.abs(total - ledgerBalance) < MONEY_EPSILON,
        oldestDueDate: acc.oldestDueDate,
      };
    })
    .filter((r) => Math.abs(r.total) >= MONEY_EPSILON || Math.abs(r.ledgerBalance) >= MONEY_EPSILON)
    // Most overdue money first — the order a payment run should be worked in.
    .sort((a, b) => {
      const lateA = a.overdue.reduce((s, n) => s + n, 0);
      const lateB = b.overdue.reduce((s, n) => s + n, 0);
      return lateB - lateA || b.total - a.total;
    });

  return {
    asOf,
    buckets,
    rows,
    totals: {
      notDue: round2(rows.reduce((s, r) => s + r.notDue, 0)),
      overdue: buckets.map((_, i) => round2(rows.reduce((s, r) => s + r.overdue[i], 0))),
      onAccount: round2(rows.reduce((s, r) => s + r.onAccount, 0)),
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
      ledgerBalance: round2(rows.reduce((s, r) => s + r.ledgerBalance, 0)),
    },
    disagreements: rows.filter((r) => !r.agrees).length,
  };
}

// ---------------------------------------------------------------------------
// Party statements
// ---------------------------------------------------------------------------

export type PartyType = 'dealer' | 'vendor';

const PARTY_ROLE: Record<PartyType, string> = { dealer: 'arTrade', vendor: 'apTrade' };

async function controlLedgerFor(type: PartyType) {
  if (type !== 'dealer' && type !== 'vendor') throw badRequest('Say whether this is a shop or a supplier.');
  const { map } = await settingsFor();
  const id = map[PARTY_ROLE[type]];
  if (!id) throw badRequest(`No account is set for ${type === 'dealer' ? 'receivables' : 'payables'}.`);
  const ledger = await LedgerModel.findById(id).select('_id code name').lean().exec();
  if (!ledger) throw badRequest('The control account for this statement no longer exists.');
  return ledger;
}

/** The shops or suppliers that have anything at all on their control account — the statement picker. */
export async function partiesWithActivity(type: PartyType): Promise<{ id: string; name: string; detail?: string }[]> {
  const ledger = await controlLedgerFor(type);
  const ids = await JournalLineModel.distinct('subledgerRef.id', {
    ledgerId: ledger._id,
    'subledgerRef.type': type,
  }).exec();

  if (type === 'dealer') {
    const dealers = await DealerModel.find({ _id: { $in: ids } }).select('_id name shopName').lean().exec();
    return dealers
      .map((d) => ({ id: String(d._id), name: d.name, detail: d.shopName }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const vendors = await VendorModel.find({ _id: { $in: ids } }).select('_id name').lean().exec();
  return vendors
    .map((v) => ({ id: String(v._id), name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PartyStatementRow {
  date: Date;
  day: string;
  entryId: string;
  entryNo: number | null;
  referenceNo: string | null;
  narration: string;
  sourceType: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface PartyStatement {
  party: { type: PartyType; id: string; name: string; detail?: string };
  ledgerCode: string;
  ledgerName: string;
  from?: string;
  to?: string;
  opening: number;
  closing: number;
  rows: PartyStatementRow[];
  truncated: boolean;
}

/**
 * Everything on one shop's or one supplier's account, with a running balance.
 *
 * The balance is shown the way the party would read it: what the shop owes us, or what we owe the
 * supplier. A negative figure means the other way round.
 */
export async function partyStatement(input: {
  type: PartyType;
  id: string;
  from?: string;
  to?: string;
}): Promise<PartyStatement> {
  const ledger = await controlLedgerFor(input.type);
  if (!Types.ObjectId.isValid(input.id)) throw badRequest('That is not a valid shop or supplier.');
  if (input.from) assertDay(input.from, 'The start date');
  if (input.to) assertDay(input.to, 'The end date');
  if (input.from && input.to && input.from > input.to) {
    throw badRequest('The start date is after the end date.');
  }

  const partyId = new Types.ObjectId(input.id);
  let party: PartyStatement['party'];
  if (input.type === 'dealer') {
    const dealer = await DealerModel.findById(partyId).select('name shopName').lean().exec();
    if (!dealer) throw notFound('Shop not found');
    party = { type: 'dealer', id: input.id, name: dealer.name, detail: dealer.shopName };
  } else {
    const vendor = await VendorModel.findById(partyId).select('name').lean().exec();
    if (!vendor) throw notFound('Supplier not found');
    party = { type: 'vendor', id: input.id, name: vendor.name };
  }

  // Receivables are debit-natured, payables credit-natured: each is shown as a positive figure
  // when it is the normal way round.
  const sign = input.type === 'dealer' ? 1 : -1;

  const base = [
    {
      $match: {
        ledgerId: ledger._id,
        status: COUNTED,
        'subledgerRef.type': input.type,
        'subledgerRef.id': partyId,
      },
    },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: REPORT_TIMEZONE } },
      },
    },
  ];

  let opening = 0;
  if (input.from) {
    const before = await JournalLineModel.aggregate<{ debit: number; credit: number }>([
      ...base,
      { $match: { day: { $lt: input.from } } },
      { $group: { _id: null, debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
    ]).exec();
    opening = round2(sign * ((before[0]?.debit ?? 0) - (before[0]?.credit ?? 0)));
  }

  const window: Record<string, string> = {};
  if (input.from) window.$gte = input.from;
  if (input.to) window.$lte = input.to;

  const LIMIT = 2000;
  const lines = await JournalLineModel.aggregate<{
    _id: Types.ObjectId;
    journalEntryId: Types.ObjectId;
    date: Date;
    day: string;
    debit: number;
    credit: number;
    lineNarration?: string;
  }>([
    ...base,
    ...(Object.keys(window).length ? [{ $match: { day: window } }] : []),
    { $sort: { date: 1, createdAt: 1 } },
    { $limit: LIMIT },
  ]).exec();

  const entries = await JournalEntryModel.find({ _id: { $in: lines.map((l) => l.journalEntryId) } })
    .select('_id entryNo narration referenceNo sourceType')
    .lean()
    .exec();
  const entryById = new Map(entries.map((e) => [String(e._id), e]));

  let running = opening;
  const rows = lines.map((line) => {
    const entry = entryById.get(String(line.journalEntryId));
    running = round2(running + sign * (line.debit - line.credit));
    return {
      date: line.date,
      day: line.day,
      entryId: String(line.journalEntryId),
      entryNo: entry?.entryNo ?? null,
      referenceNo: entry?.referenceNo ?? null,
      narration: line.lineNarration || entry?.narration || '',
      sourceType: entry?.sourceType ?? 'manual',
      debit: round2(line.debit),
      credit: round2(line.credit),
      balance: running,
    };
  });

  return {
    party,
    ledgerCode: ledger.code,
    ledgerName: ledger.name,
    from: input.from,
    to: input.to,
    opening,
    closing: running,
    rows,
    truncated: lines.length === LIMIT,
  };
}
