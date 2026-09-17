import { Types } from 'mongoose';
import {
  VoucherModel,
  IVoucher,
  IVoucherLine,
  VoucherCategory,
  ContraSubtype,
  VOUCHER_CATEGORIES,
  VOUCHER_CATEGORY_LABELS,
  CONTRA_SUBTYPES,
} from '../../models/voucher.model';
import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { DealerModel } from '../../models/dealer.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { allocateNextFinanceNo, FinanceDocumentKind } from './finance-counters';
import { AccountType, MONEY_EPSILON, buildIdempotencyKey, round2 } from './finance.rules';
import { postEntry, reverseEntry } from './posting.service';
import { withFinanceLocks } from './finance-locks';

/**
 * The six manual vouchers.
 *
 * ## The rule that shapes everything here
 *
 * Every other finance screen owns a balance: bills and payments own what we owe suppliers, expenses
 * own the approval limits on spending, payroll owns what is owed to staff, collections own what
 * riders are carrying, the warehouse owns stock. A voucher that could post to those accounts would
 * be a second way to the same figure, and the day somebody used the wrong one the two would
 * disagree with nothing to say which was right.
 *
 * So this module refuses those accounts BY NAME and says which screen to use instead. What is left
 * is the voucher menu's own work, and it is real work that had no home before: moving money between
 * the business's own cash and bank accounts, taking money from a shop at the office rather than
 * through a rider, refunding a shop, loans and capital, drawings, paying a tax bill, and correcting
 * the books.
 *
 * ## Receivables are the one exception
 *
 * A shop paying at the office, or being refunded, has no other route in — a rider collection needs a
 * rider. So a receipt or payment voucher may name a shop and reach Accounts Receivable, and the
 * nightly receivables check counts what vouchers have taken from shops so it stays provable.
 */

const SERIES: Record<VoucherCategory, FinanceDocumentKind> = {
  CPV: 'voucherCpvNo',
  CRV: 'voucherCrvNo',
  BPV: 'voucherBpvNo',
  BRV: 'voucherBrvNo',
  CV: 'voucherCvNo',
  JV: 'voucherJvNo',
};

const MONEY_IN: VoucherCategory[] = ['CRV', 'BRV'];
const MONEY_OUT: VoucherCategory[] = ['CPV', 'BPV'];
const CASH_CATEGORIES: VoucherCategory[] = ['CPV', 'CRV'];
const BANK_CATEGORIES: VoucherCategory[] = ['BPV', 'BRV'];

export function voucherReference(category: VoucherCategory, no?: number): string {
  return no ? `${category}-${String(no).padStart(4, '0')}` : 'Draft';
}

/**
 * Accounts another part of the system keeps, and where that work belongs.
 *
 * Named by engine role rather than by code, so renumbering the chart cannot quietly open a back
 * door into somebody else's balance.
 */
const MODULE_OWNED: { role: string; screen: string }[] = [
  { role: 'apTrade', screen: 'Supplier Payments, which settles the bills and keeps what we owe them right' },
  { role: 'grni', screen: 'Supplier Bills — goods received are cleared by matching a bill to them' },
  { role: 'inventorySellable', screen: 'the warehouse screens, which move stock and its value together' },
  { role: 'inventoryInTransit', screen: 'the warehouse transfer screens' },
  { role: 'inventoryOutForDelivery', screen: 'the order and delivery screens' },
  { role: 'riderCash', screen: 'Collections — a rider handing cash over is a settlement' },
  { role: 'onlineInTransit', screen: 'Collections' },
  { role: 'staffAdvances', screen: 'Payroll, where advances are handed out and recovered from pay' },
  { role: 'salaryPayable', screen: 'Payroll, where wages are paid against the month they belong to' },
  { role: 'chequesIssued', screen: 'the screen that issued the cheque, which also clears it' },
  { role: 'chequesInHand', screen: 'the screen that received the cheque' },
];

// ---------------------------------------------------------------------------
// The chart, as this module needs to see it
// ---------------------------------------------------------------------------

interface AccountInfo {
  id: string;
  code: string;
  name: string;
  label: string;
  accountType: AccountType;
  isActive: boolean;
  isControl: boolean;
  isCashEquivalent: boolean;
}

interface Context {
  roles: Record<string, string>;
  account: (id: string | undefined, what: string) => AccountInfo;
}

async function loadContext(ledgerIds: string[]): Promise<Context> {
  const unique = [...new Set(ledgerIds.filter(Boolean))];
  for (const id of unique) {
    if (!Types.ObjectId.isValid(id)) throw badRequest('One of the accounts chosen is not an account.');
  }

  const [ledgers, settings] = await Promise.all([
    LedgerModel.find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select('_id code name groupId isActive isControl isCashEquivalent')
      .lean()
      .exec(),
    FinanceSettingsModel.findOne({ key: 'singleton' }).select('ledgerMap').lean().exec(),
  ]);

  const groups = await AccountGroupModel.find({ _id: { $in: ledgers.map((l) => l.groupId) } })
    .select('_id accountType')
    .lean()
    .exec();
  const typeByGroup = new Map(groups.map((g) => [String(g._id), g.accountType as AccountType]));

  const byId = new Map(
    ledgers.map((l) => [
      String(l._id),
      {
        id: String(l._id),
        code: l.code,
        name: l.name,
        label: `"${l.code} ${l.name}"`,
        accountType: typeByGroup.get(String(l.groupId)) as AccountType,
        isActive: l.isActive,
        isControl: l.isControl,
        isCashEquivalent: l.isCashEquivalent,
      },
    ]),
  );

  const rawMap = (settings?.ledgerMap ?? {}) as unknown as Record<string, Types.ObjectId>;
  const roles = Object.fromEntries(Object.entries(rawMap).map(([k, v]) => [k, String(v)]));

  return {
    roles,
    account: (id, what) => {
      if (!id) throw badRequest(`Say which account ${what}.`);
      const info = byId.get(id);
      if (!info) throw badRequest('One of the accounts chosen no longer exists.');
      if (!info.accountType) {
        throw badRequest(`${info.label} sits in a group that no longer exists, so nothing can be posted to it.`);
      }
      return info;
    },
  };
}

/** Every account on a voucher has to clear these, whichever category it is. */
function assertUsable(info: AccountInfo, ctx: Context): void {
  if (!info.isActive) {
    throw badRequest(`${info.label} is deactivated and cannot be used.`);
  }

  const owned = MODULE_OWNED.find((m) => ctx.roles[m.role] === info.id);
  if (owned) {
    throw badRequest(
      `${info.label} is kept by another part of the system, so a voucher may not post to it. `
        + `Record this on ${owned.screen}.`,
    );
  }

  // Receivables is the one control account a voucher may reach, and only with a shop named — the
  // posting engine then insists on the subledger reference itself.
  if (info.isControl && info.id !== ctx.roles.arTrade) {
    throw badRequest(
      `${info.label} is a control account, posted to by the module it summarises rather than by `
        + 'hand.',
    );
  }
}

function assertCashOrBank(info: AccountInfo, ctx: Context, category: VoucherCategory): void {
  assertUsable(info, ctx);

  if (!info.isCashEquivalent) {
    throw badRequest(
      `${info.label} is not a cash or bank account, so money cannot move through it. Mark it as a `
        + 'cash account on the chart if that is what it is.',
    );
  }

  // Only the certain mistakes are refused. An accountant who adds a second cash box or a second
  // bank knows which is which; the system only knows the two it was told about.
  if (CASH_CATEGORIES.includes(category) && info.id === ctx.roles.bank) {
    throw badRequest(
      `${info.label} is the bank account. Use a Bank ${category === 'CPV' ? 'Payment (BPV)' : 'Receipt (BRV)'} voucher instead.`,
    );
  }
  if (BANK_CATEGORIES.includes(category) && info.id === ctx.roles.officeCash) {
    throw badRequest(
      `${info.label} is the office cash. Use a Cash ${category === 'BPV' ? 'Payment (CPV)' : 'Receipt (CRV)'} voucher instead.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Composing the entry
// ---------------------------------------------------------------------------

export interface VoucherInput {
  category: VoucherCategory;
  subtype?: ContraSubtype;
  voucherDate: Date | string;
  narration: string;
  reference?: string;
  attachments?: string[];
  cashBankLedgerId?: string;
  counterLedgerId?: string;
  partyType?: 'dealer';
  partyId?: string;
  amount?: number;
  fromLedgerId?: string;
  toLedgerId?: string;
  lines?: { ledgerId: string; debit?: number; credit?: number; narration?: string }[];
}

interface Prepared {
  category: VoucherCategory;
  subtype?: ContraSubtype;
  voucherDate: Date;
  narration: string;
  reference?: string;
  attachments: string[];
  partyType?: 'dealer';
  partyId?: Types.ObjectId;
  partyName?: string;
  lines: IVoucherLine[];
  amount: number;
}

function line(
  ledgerId: string,
  side: 'debit' | 'credit',
  amount: number,
  narration?: string,
  subledger?: { type: string; id: string },
): IVoucherLine {
  return {
    ledgerId: new Types.ObjectId(ledgerId),
    debit: side === 'debit' ? amount : 0,
    credit: side === 'credit' ? amount : 0,
    narration,
    subledgerType: subledger?.type,
    subledgerId: subledger ? new Types.ObjectId(subledger.id) : undefined,
  };
}

/**
 * Turn what the form collected into the exact debits and credits the voucher will write.
 *
 * Done when the voucher is SAVED rather than when it posts, so an approver reads the entry itself
 * rather than a promise about one, and posting has no arithmetic left to get wrong.
 */
async function prepare(input: VoucherInput): Promise<Prepared> {
  if (!VOUCHER_CATEGORIES.includes(input.category)) {
    throw badRequest('Choose one of the six voucher categories.');
  }

  const voucherDate = new Date(input.voucherDate);
  if (Number.isNaN(voucherDate.getTime())) throw badRequest('The voucher date is not a date.');

  const narration = input.narration?.trim();
  if (!narration || narration.length < 3) throw badRequest('Say what this voucher is for.');

  const attachments = (input.attachments ?? []).map((a) => a.trim()).filter(Boolean);
  const base = {
    category: input.category,
    voucherDate,
    narration,
    reference: input.reference?.trim() || undefined,
    attachments,
  };

  if (input.category === 'JV') return { ...base, ...(await prepareJournal(input)) };
  if (input.category === 'CV') return { ...base, ...(await prepareContra(input)) };
  return { ...base, ...(await prepareMoney(input)) };
}

/** CPV, CRV, BPV, BRV: one cash or bank account, and one other side. */
async function prepareMoney(input: VoucherInput) {
  const amount = round2(input.amount ?? 0);
  if (!(amount > MONEY_EPSILON)) throw badRequest('A voucher has to be for something.');

  const ctx = await loadContext([input.cashBankLedgerId ?? '', input.counterLedgerId ?? '']);
  const cashBank = ctx.account(input.cashBankLedgerId, 'the money moves through');
  assertCashOrBank(cashBank, ctx, input.category);

  const isMoneyIn = MONEY_IN.includes(input.category);
  const hasParty = Boolean(input.partyId);

  if (hasParty && input.counterLedgerId) {
    throw badRequest(
      'Name a shop or an account for the other side, not both — the shop IS the other side.',
    );
  }

  let partyId: Types.ObjectId | undefined;
  let partyName: string | undefined;
  let otherSide: IVoucherLine;

  if (hasParty) {
    if (input.partyType !== 'dealer') {
      throw badRequest(
        'A voucher can only be with a shop. Money to or from a supplier is recorded on the '
          + 'Supplier Payments screen, which also settles their bills.',
      );
    }
    if (!Types.ObjectId.isValid(String(input.partyId))) throw badRequest('That is not a shop.');

    const [dealer, arTrade] = await Promise.all([
      DealerModel.findById(input.partyId).select('_id name shopName').lean().exec(),
      Promise.resolve(ctx.roles.arTrade),
    ]);
    if (!dealer) throw badRequest('That shop does not exist.');
    if (!arTrade) {
      throw badRequest('No account is set for what shops owe, so a voucher cannot be put against one.');
    }

    partyId = dealer._id;
    partyName = dealer.shopName?.trim() || dealer.name;
    otherSide = line(
      arTrade,
      // Money in reduces what the shop owes; money out to a shop is a refund, which increases it.
      isMoneyIn ? 'credit' : 'debit',
      amount,
      isMoneyIn ? `Received from ${partyName}` : `Refunded to ${partyName}`,
      { type: 'dealer', id: String(dealer._id) },
    );
  } else {
    const counter = ctx.account(input.counterLedgerId, 'the other side of this voucher is');
    assertUsable(counter, ctx);

    if (counter.id === cashBank.id) {
      throw badRequest('Both sides are the same account, so nothing would move.');
    }
    if (counter.isCashEquivalent) {
      throw badRequest(
        `${counter.label} is another of our own cash or bank accounts. Moving money between them `
          + 'is a Contra voucher (CV).',
      );
    }
    if (counter.isControl) {
      throw badRequest(`${counter.label} needs a shop named against it. Choose the shop instead.`);
    }
    // Spending against an expense account belongs on the Expenses screen, which carries the
    // approval limit for that kind of spending. A voucher would walk straight past it.
    if (MONEY_OUT.includes(input.category) && counter.accountType === 'expense') {
      throw badRequest(
        `${counter.label} is an expense account. Record spending on the Expenses screen, where the `
          + 'category decides whether it needs approving.',
      );
    }

    otherSide = line(counter.id, isMoneyIn ? 'credit' : 'debit', amount);
  }

  const cashLine = line(
    cashBank.id,
    isMoneyIn ? 'debit' : 'credit',
    amount,
    undefined,
  );

  return {
    partyType: hasParty ? ('dealer' as const) : undefined,
    partyId,
    partyName,
    lines: isMoneyIn ? [cashLine, otherSide] : [otherSide, cashLine],
    amount,
  };
}

/** CV: money between the business's own accounts. Nothing is earned, spent, owed or collected. */
async function prepareContra(input: VoucherInput) {
  const amount = round2(input.amount ?? 0);
  if (!(amount > MONEY_EPSILON)) throw badRequest('A transfer has to be for something.');

  const subtype = input.subtype;
  if (!subtype || !CONTRA_SUBTYPES.includes(subtype)) {
    throw badRequest('Say what kind of transfer this is.');
  }

  const ctx = await loadContext([input.fromLedgerId ?? '', input.toLedgerId ?? '']);
  const from = ctx.account(input.fromLedgerId, 'the money leaves');
  const to = ctx.account(input.toLedgerId, 'the money arrives in');

  assertUsable(from, ctx);
  assertUsable(to, ctx);

  for (const info of [from, to]) {
    if (!info.isCashEquivalent) {
      throw badRequest(
        `${info.label} is not one of our cash or bank accounts. A contra voucher only moves money `
          + 'between those.',
      );
    }
  }
  if (from.id === to.id) {
    throw badRequest('The money would leave and arrive in the same account, so nothing would move.');
  }

  // Only the certain contradictions are refused — see `assertCashOrBank`.
  const { officeCash, bank } = ctx.roles;
  const wrong = (why: string) => badRequest(`${why} Choose another kind of transfer, or other accounts.`);
  if (subtype === 'bank_deposit' && (from.id === bank || to.id === officeCash)) {
    throw wrong('A bank deposit moves cash into a bank account, not the other way.');
  }
  if (subtype === 'cash_withdrawal' && (to.id === bank || from.id === officeCash)) {
    throw wrong('A cash withdrawal takes money out of a bank account into cash.');
  }
  if (subtype === 'bank_to_bank' && (from.id === officeCash || to.id === officeCash)) {
    throw wrong('This is between two bank accounts, and one of these is the office cash.');
  }
  if (subtype === 'cash_to_cash' && (from.id === bank || to.id === bank)) {
    throw wrong('This is between two cash accounts, and one of these is the bank.');
  }

  return {
    subtype,
    lines: [line(to.id, 'debit', amount), line(from.id, 'credit', amount)],
    amount,
  };
}

/** JV: an adjustment. It balances, it touches no control account, and it moves no money. */
async function prepareJournal(input: VoucherInput) {
  const given = input.lines ?? [];
  if (given.length < 2) {
    throw badRequest('A journal voucher needs at least two lines — something debited and something credited.');
  }

  const ctx = await loadContext(given.map((l) => l.ledgerId));

  let totalDebit = 0;
  let totalCredit = 0;
  const lines = given.map((raw, index) => {
    const info = ctx.account(raw.ledgerId, `line ${index + 1} posts to`);
    assertUsable(info, ctx);

    if (info.isControl) {
      throw badRequest(
        `Line ${index + 1}: ${info.label} is a control account. A journal may not adjust one by `
          + 'hand — that is what makes it stop agreeing with the module behind it.',
      );
    }
    if (info.isCashEquivalent) {
      throw badRequest(
        `Line ${index + 1}: ${info.label} is a cash or bank account, and a journal voucher moves no `
          + 'money. Use a payment, receipt or contra voucher.',
      );
    }

    const debit = round2(raw.debit ?? 0);
    const credit = round2(raw.credit ?? 0);
    if (debit > MONEY_EPSILON && credit > MONEY_EPSILON) {
      throw badRequest(`Line ${index + 1} is both debited and credited. It can only be one.`);
    }
    if (debit <= MONEY_EPSILON && credit <= MONEY_EPSILON) {
      throw badRequest(`Line ${index + 1} has no figure on it.`);
    }

    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    return line(info.id, debit > 0 ? 'debit' : 'credit', debit > 0 ? debit : credit, raw.narration?.trim() || undefined);
  });

  if (Math.abs(totalDebit - totalCredit) >= MONEY_EPSILON) {
    throw badRequest(
      `The two sides do not agree: ${totalDebit.toFixed(2)} debited against `
        + `${totalCredit.toFixed(2)} credited. Every entry has an equal and opposite side.`,
    );
  }

  return { lines, amount: totalDebit };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface VoucherLineView {
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  debit: number;
  credit: number;
  narration?: string;
  partyName?: string;
}

export interface VoucherView {
  id: string;
  voucherNo?: number;
  reference: string;
  category: VoucherCategory;
  categoryLabel: string;
  subtype?: ContraSubtype;
  voucherDate: Date;
  narration: string;
  paymentReference?: string;
  attachments: string[];
  partyType?: 'dealer';
  partyId?: string;
  partyName?: string;
  amount: number;
  status: IVoucher['status'];
  submittedAt?: Date;
  submittedBy?: string;
  approvedAt?: Date;
  approvedBy?: string;
  rejectionReason?: string;
  journalEntryId?: string;
  cancelReason?: string;
  createdBy?: string;
  createdAt: Date;
}

export interface VoucherDetail extends VoucherView {
  lines: VoucherLineView[];
}

function toView(voucher: IVoucher): VoucherView {
  return {
    id: String(voucher._id),
    voucherNo: voucher.voucherNo,
    reference: voucherReference(voucher.category, voucher.voucherNo),
    category: voucher.category,
    categoryLabel: VOUCHER_CATEGORY_LABELS[voucher.category],
    subtype: voucher.subtype,
    voucherDate: voucher.voucherDate,
    narration: voucher.narration,
    paymentReference: voucher.reference,
    attachments: voucher.attachments ?? [],
    partyType: voucher.partyType,
    partyId: voucher.partyId ? String(voucher.partyId) : undefined,
    partyName: voucher.partyName,
    amount: round2(voucher.amount),
    status: voucher.status,
    submittedAt: voucher.submittedAt,
    submittedBy: voucher.submittedBy ? String(voucher.submittedBy) : undefined,
    approvedAt: voucher.approvedAt,
    approvedBy: voucher.approvedBy ? String(voucher.approvedBy) : undefined,
    rejectionReason: voucher.rejectionReason,
    journalEntryId: voucher.journalEntryId ? String(voucher.journalEntryId) : undefined,
    cancelReason: voucher.cancelReason,
    createdBy: voucher.createdBy ? String(voucher.createdBy) : undefined,
    createdAt: voucher.createdAt,
  };
}

async function toDetail(voucher: IVoucher): Promise<VoucherDetail> {
  const ledgers = await LedgerModel.find({ _id: { $in: voucher.lines.map((l) => l.ledgerId) } })
    .select('_id code name')
    .lean()
    .exec();
  const byId = new Map(ledgers.map((l) => [String(l._id), l]));

  return {
    ...toView(voucher),
    lines: voucher.lines.map((l) => {
      const ledger = byId.get(String(l.ledgerId));
      return {
        ledgerId: String(l.ledgerId),
        ledgerCode: ledger?.code ?? '',
        ledgerName: ledger?.name ?? 'Unknown account',
        debit: round2(l.debit),
        credit: round2(l.credit),
        narration: l.narration,
        partyName: l.subledgerType === 'dealer' ? voucher.partyName : undefined,
      };
    }),
  };
}

export interface VoucherFilters {
  category?: VoucherCategory;
  status?: IVoucher['status'] | 'all';
  from?: string;
  to?: string;
  partyId?: string;
  search?: string;
}

export async function listVouchers(filters: VoucherFilters = {}): Promise<VoucherView[]> {
  const query: Record<string, unknown> = {};

  if (filters.category && VOUCHER_CATEGORIES.includes(filters.category)) {
    query.category = filters.category;
  }
  if (filters.status && filters.status !== 'all') query.status = filters.status;
  if (filters.partyId && Types.ObjectId.isValid(filters.partyId)) {
    query.partyId = new Types.ObjectId(filters.partyId);
  }

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) {
      const to = new Date(filters.to);
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    query.voucherDate = range;
  }

  if (filters.search?.trim()) {
    // Escaped, so a reference typed with a dot in it does not become a wildcard.
    const safe = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(safe, 'i');
    query.$or = [{ narration: pattern }, { reference: pattern }, { partyName: pattern }];
  }

  const vouchers = await VoucherModel.find(query)
    .sort({ voucherDate: -1, createdAt: -1 })
    .limit(500)
    .exec();

  return vouchers.map(toView);
}

export interface ShopOption {
  id: string;
  name: string;
  shopName?: string;
}

/**
 * The shops a voucher can be raised against.
 *
 * Finance has no business holding the Clients permission, and a receipt taken at the counter needs
 * a shop named on it. So the picker lives here, behind the voucher permission, and returns only
 * what a dropdown needs.
 */
export async function voucherShops(search?: string): Promise<ShopOption[]> {
  const query: Record<string, unknown> = { status: 'active', isTrashed: { $ne: true } };
  const term = search?.trim();
  if (term) {
    query.$or = [
      { name: { $regex: term, $options: 'i' } },
      { shopName: { $regex: term, $options: 'i' } },
    ];
  }

  const shops = await DealerModel.find(query)
    .select('_id name shopName')
    .sort({ name: 1 })
    .limit(500)
    .lean()
    .exec();

  return shops.map((s) => ({ id: String(s._id), name: s.name, shopName: s.shopName }));
}

export async function getVoucher(id: string): Promise<VoucherDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');
  const voucher = await VoucherModel.findById(id).exec();
  if (!voucher) throw notFound('Voucher not found');
  return toDetail(voucher);
}

/**
 * What vouchers have taken from shops, or given back to them.
 *
 * The nightly receivables check needs this: a shop paying at the office is not a rider collection,
 * so without this term the ledger and the collections module would disagree by exactly the amount
 * the office took.
 */
export async function dealerNetFromVouchers(): Promise<number> {
  const rows = await VoucherModel.aggregate<{ net: number }>([
    { $match: { status: 'posted', 'lines.subledgerType': 'dealer' } },
    { $unwind: '$lines' },
    { $match: { 'lines.subledgerType': 'dealer' } },
    { $group: { _id: null, net: { $sum: { $subtract: ['$lines.credit', '$lines.debit'] } } } },
  ]).exec();

  return round2(rows[0]?.net ?? 0);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const EDITABLE: IVoucher['status'][] = ['draft', 'rejected'];

function statusWords(status: IVoucher['status']): string {
  if (status === 'submitted') return 'waiting for approval';
  if (status === 'approved') return 'approved and waiting to be posted';
  return status;
}

export async function createVoucher(input: VoucherInput, actorId?: string): Promise<VoucherDetail> {
  const prepared = await prepare(input);

  // No number yet. The series is allocated at posting, so an abandoned voucher leaves no gap for
  // an auditor to ask about.
  const voucher = await VoucherModel.create({
    ...prepared,
    status: 'draft',
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'voucher',
    entityId: String(voucher._id),
    action: 'created',
    meta: { category: prepared.category, amount: prepared.amount },
  });

  return toDetail(voucher);
}

export async function updateVoucher(
  id: string,
  input: VoucherInput,
  actorId?: string,
): Promise<VoucherDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');
  const voucher = await VoucherModel.findById(id).exec();
  if (!voucher) throw notFound('Voucher not found');

  if (!EDITABLE.includes(voucher.status)) {
    throw badRequest(
      `This voucher is ${statusWords(voucher.status)} and cannot be changed`
        + (voucher.status === 'submitted'
          ? ' under the approver. Ask them to send it back first.'
          : voucher.status === 'posted'
            ? '. Cancel it and raise a corrected one, so both stay on the record.'
            : '.'),
    );
  }

  const prepared = await prepare(input);
  Object.assign(voucher, prepared, { updatedBy: actorId ? new Types.ObjectId(actorId) : undefined });
  // `Object.assign` leaves a field in place when the new version omits it, and all of these are
  // optional — switching a receipt from a shop to a loan would otherwise keep the shop.
  voucher.subtype = prepared.subtype;
  voucher.partyType = prepared.partyType;
  voucher.partyId = prepared.partyId;
  voucher.partyName = prepared.partyName;
  voucher.reference = prepared.reference;
  // A corrected voucher goes back to draft; the reason it came back stays on it.
  voucher.status = 'draft';
  await voucher.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'voucher',
    entityId: id,
    action: 'updated',
    meta: { category: prepared.category, amount: prepared.amount },
  });

  return toDetail(voucher);
}

export async function deleteVoucher(id: string, actorId?: string): Promise<{ message: string }> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');
  const voucher = await VoucherModel.findById(id).lean().exec();
  if (!voucher) throw notFound('Voucher not found');

  if (!EDITABLE.includes(voucher.status)) {
    throw badRequest(
      `This voucher is ${statusWords(voucher.status)} and cannot be deleted. `
        + (voucher.status === 'posted'
          ? 'A posted voucher is cancelled, never deleted.'
          : 'Ask the approver to send it back first.'),
    );
  }

  await VoucherModel.deleteOne({ _id: voucher._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'voucher',
    entityId: id,
    action: 'deleted',
    meta: { category: voucher.category, amount: voucher.amount },
  });

  return { message: 'Voucher deleted' };
}

export async function submitVoucher(id: string, actorId?: string): Promise<VoucherDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');

  return withFinanceLocks([`voucher:${id}`], async () => {
    const voucher = await VoucherModel.findById(id).exec();
    if (!voucher) throw notFound('Voucher not found');
    if (voucher.status === 'submitted') {
      throw conflict('This voucher has already been submitted and is waiting for approval.');
    }
    if (!EDITABLE.includes(voucher.status)) {
      throw badRequest(`This voucher is ${statusWords(voucher.status)} and cannot be submitted.`);
    }

    // Checked again on the way out: an account can be deactivated, or handed to another module,
    // while a voucher sits in someone's drafts.
    await prepare(voucherToInput(voucher));

    voucher.status = 'submitted';
    voucher.submittedAt = new Date();
    voucher.submittedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    await voucher.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'voucher',
      entityId: id,
      action: 'submitted',
      meta: { category: voucher.category, amount: voucher.amount },
    });

    return toDetail(voucher);
  });
}

/** What the document holds, read back as though it had just been typed. */
function voucherToInput(voucher: IVoucher): VoucherInput {
  return {
    category: voucher.category,
    subtype: voucher.subtype,
    voucherDate: voucher.voucherDate,
    narration: voucher.narration,
    reference: voucher.reference,
    attachments: voucher.attachments,
    ...(voucher.category === 'JV'
      ? {
        lines: voucher.lines.map((l) => ({
          ledgerId: String(l.ledgerId),
          debit: l.debit,
          credit: l.credit,
          narration: l.narration,
        })),
      }
      : {}),
    ...(voucher.category === 'CV'
      ? {
        amount: voucher.amount,
        // Debit is where it arrived; credit is where it left.
        toLedgerId: String(voucher.lines.find((l) => l.debit > 0)!.ledgerId),
        fromLedgerId: String(voucher.lines.find((l) => l.credit > 0)!.ledgerId),
      }
      : {}),
    ...(['CPV', 'CRV', 'BPV', 'BRV'].includes(voucher.category)
      ? (() => {
        const isMoneyIn = MONEY_IN.includes(voucher.category);
        const cashLine = voucher.lines.find((l) => (isMoneyIn ? l.debit > 0 : l.credit > 0))!;
        const other = voucher.lines.find((l) => l !== cashLine)!;
        return {
          amount: voucher.amount,
          cashBankLedgerId: String(cashLine.ledgerId),
          partyType: voucher.partyType,
          partyId: voucher.partyId ? String(voucher.partyId) : undefined,
          counterLedgerId: voucher.partyId ? undefined : String(other.ledgerId),
        };
      })()
      : {}),
  };
}

/**
 * Approve a submitted voucher.
 *
 * Refused to whoever raised it. An approval the maker can give themselves is not a second pair of
 * eyes; it is the same pair looking twice — and a voucher is the one document in this module that
 * can be pointed at almost any account.
 */
export async function approveVoucher(id: string, actorId: string): Promise<VoucherDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');

  return withFinanceLocks([`voucher:${id}`], async () => {
    const voucher = await VoucherModel.findById(id).exec();
    if (!voucher) throw notFound('Voucher not found');
    if (voucher.status === 'approved' || voucher.status === 'posted') return toDetail(voucher);
    if (voucher.status !== 'submitted') {
      throw badRequest(
        `This voucher is ${statusWords(voucher.status)}. Only one waiting for approval can be approved.`,
      );
    }

    const raisedBy = voucher.submittedBy ?? voucher.createdBy;
    if (raisedBy && String(raisedBy) === actorId) {
      throw badRequest(
        'You raised this voucher, so somebody else has to approve it. A second person looking at '
          + 'it is the whole point of it waiting.',
      );
    }

    voucher.status = 'approved';
    voucher.approvedAt = new Date();
    voucher.approvedBy = new Types.ObjectId(actorId);
    await voucher.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'voucher',
      entityId: id,
      action: 'approved',
      meta: { category: voucher.category, amount: voucher.amount },
    });

    return toDetail(voucher);
  });
}

export async function rejectVoucher(
  id: string,
  reason: string,
  actorId?: string,
): Promise<VoucherDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');
  const why = reason?.trim() ?? '';
  if (why.length < 3) {
    throw badRequest('Say what needs fixing — whoever raised it will see this.');
  }

  return withFinanceLocks([`voucher:${id}`], async () => {
    const voucher = await VoucherModel.findById(id).exec();
    if (!voucher) throw notFound('Voucher not found');
    if (voucher.status !== 'submitted' && voucher.status !== 'approved') {
      throw badRequest(
        `This voucher is ${statusWords(voucher.status)}. Only one waiting for approval, or approved `
          + 'and not yet posted, can be sent back.',
      );
    }

    voucher.status = 'rejected';
    voucher.rejectedAt = new Date();
    voucher.rejectedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    voucher.rejectionReason = why;
    await voucher.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'voucher',
      entityId: id,
      action: 'rejected',
      meta: { category: voucher.category, reason: why },
    });

    return toDetail(voucher);
  });
}

/**
 * Post an approved voucher to the accounts.
 *
 * It writes exactly the lines already on the document. The entry is written first and the voucher
 * stamped second, as every finance document here does: an interruption between the two leaves it
 * approved, and posting again finds the entry by its idempotency key instead of writing a second.
 */
export async function postVoucher(id: string, actorId?: string): Promise<VoucherDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');

  return withFinanceLocks([`voucher:${id}`], async () => {
    const voucher = await VoucherModel.findById(id).exec();
    if (!voucher) throw notFound('Voucher not found');
    if (voucher.status === 'posted') return toDetail(voucher);
    if (voucher.status !== 'approved') {
      throw badRequest(
        `This voucher is ${statusWords(voucher.status)}. Only an approved voucher can be posted — `
          + 'that is what approval is for.',
      );
    }

    // The world as it is now, not as it was when the voucher was raised.
    await prepare(voucherToInput(voucher));

    const entry = await postEntry(
      {
        date: voucher.voucherDate,
        narration: voucher.narration,
        referenceNo: voucher.reference,
        sourceType: 'voucher',
        sourceId: id,
        sourceModel: 'Voucher',
        // Stable: an approved voucher is posted once, and a moving key would let a double-click
        // write it twice.
        idempotencyKey: buildIdempotencyKey('voucher', id, 'posted'),
        attachments: voucher.attachments,
        lines: voucher.lines.map((l) => ({
          ledgerId: String(l.ledgerId),
          debit: l.debit || undefined,
          credit: l.credit || undefined,
          lineNarration: l.narration,
          subledgerRef: l.subledgerType && l.subledgerId
            ? { type: l.subledgerType, id: String(l.subledgerId) }
            : null,
        })),
      },
      actorId,
    );

    if (!voucher.voucherNo) {
      voucher.voucherNo = await allocateNextFinanceNo(SERIES[voucher.category]);
    }
    voucher.status = 'posted';
    voucher.journalEntryId = entry._id;
    voucher.postedAt = new Date();
    voucher.postedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    await voucher.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'voucher',
      entityId: id,
      action: 'posted',
      meta: {
        reference: voucherReference(voucher.category, voucher.voucherNo),
        category: voucher.category,
        amount: voucher.amount,
      },
    });

    return toDetail(voucher);
  });
}

export async function cancelVoucher(
  id: string,
  reason: string,
  actorId?: string,
): Promise<VoucherDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Voucher not found');

  return withFinanceLocks([`voucher:${id}`], async () => {
    const voucher = await VoucherModel.findById(id).exec();
    if (!voucher) throw notFound('Voucher not found');
    if (voucher.status === 'cancelled') throw conflict('This voucher has already been cancelled.');
    if (voucher.status !== 'posted') {
      throw badRequest('This voucher was never posted. Delete it, or send it back, instead.');
    }

    if (voucher.journalEntryId) {
      const entry = await JournalEntryModel.findById(voucher.journalEntryId)
        .select('status')
        .lean()
        .exec();
      // Already reversed from the journal screen: the accounts are right, so finish the job on the
      // document rather than leaving the two disagreeing.
      if (entry && entry.status === 'posted') {
        await reverseEntry(String(voucher.journalEntryId), { reason }, actorId);
      }
    }

    voucher.status = 'cancelled';
    voucher.cancelledAt = new Date();
    voucher.cancelledBy = actorId ? new Types.ObjectId(actorId) : undefined;
    voucher.cancelReason = reason.trim();
    await voucher.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'voucher',
      entityId: id,
      action: 'cancelled',
      meta: {
        reference: voucherReference(voucher.category, voucher.voucherNo),
        amount: voucher.amount,
        reason: reason.trim(),
      },
    });

    return toDetail(voucher);
  });
}
