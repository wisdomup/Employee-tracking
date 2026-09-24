import { Types, FilterQuery } from 'mongoose';
import { JournalEntryModel, JournalSourceType } from '../../models/journal-entry.model';
import { JournalLineModel, IJournalLine } from '../../models/journal-line.model';
import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { DealerModel } from '../../models/dealer.model';
import { VendorModel } from '../../models/vendor.model';
import { UserModel } from '../../models/user.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { badRequest, notFound } from '../../utils/app-error';
import { SubledgerType, naturalBalance, round2 } from './finance.rules';
import { balanceSheet, profitAndLoss } from './financial-statements.service';

/**
 * The back-trail behind any figure in the finance module.
 *
 * Every report in this module used to end at a number. This answers the two questions a number
 * cannot: what is it made of, and what was on the other side of each movement. One resolver per
 * kind of figure, all returning the SAME shape, because the client then needs no per-report
 * knowledge — it renders rows and follows `drill` until it reaches a document.
 *
 * Three rules hold everywhere in here:
 *
 *  1. **Statuses are `posted` AND `reversed`.** A reversed line still happened; the reversing
 *     line cancels it. Counting only `posted` drops the original half of every reversed pair and
 *     the trail then disagrees with the report it was opened from. Because every trail below
 *     queries LINES this way — and a reversal contributes its own posted lines — a corrected
 *     document nets to nil here without any `reversalOf` filter. The entry-level
 *     `NOT_A_REVERSAL` guard belongs to queries keyed on `sourceType`/`sourceId`, which is why
 *     none of these resolvers needs it; `sourceTrail` says out loud why it wants both halves.
 *  2. **Direction follows the account.** For an asset or an expense a debit increases the figure,
 *     for everything else a credit does. Without that the trail on a liability prints every row
 *     with the sign flipped from the report that opened it.
 *  3. **Totals are derived from the rows shown.** Never summed separately. If the cap truncates
 *     the rows, the total says so rather than quietly disagreeing with them.
 */

// ---------------------------------------------------------------------------
// The reference
// ---------------------------------------------------------------------------

export type TrailRef =
  | { kind: 'ledger'; ledgerId: string; from?: string; to?: string }
  | { kind: 'group'; groupId: string; from?: string; to?: string }
  | {
    kind: 'party';
    partyType: SubledgerType;
    partyId: string;
    ledgerId?: string;
    from?: string;
    to?: string;
  }
  | { kind: 'entry'; entryId: string }
  | { kind: 'source'; sourceId: string }
  | {
    kind: 'derived';
    report: 'profit-and-loss' | 'balance-sheet' | 'cash-flow' | 'tax-summary';
    figure: string;
    from?: string;
    to?: string;
  };

export const TRAIL_KINDS = ['ledger', 'group', 'party', 'entry', 'source', 'derived'] as const;

/** The cap `ledgerStatement` already uses. Kept identical so the two never disagree. */
const ROW_CAP = 2000;

const LIVE_STATUSES = ['posted', 'reversed'] as const;

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

/** Where a row came from outside finance, and whether there is a screen for it. */
export interface TrailDocument {
  sourceType: JournalSourceType | string;
  sourceModel: string | null;
  sourceId: string;
  /**
   * Admin route for the document, or null when this kind of document has no screen of its own.
   * Null is deliberate and is rendered as text: a link to an unfiltered list page answers
   * nothing, and a dead link is worse than an honest full stop.
   */
  href: string | null;
}

export interface TrailRow {
  date: Date | null;
  /** What happened, in the words the entry itself used. */
  label: string;
  reference: string | null;
  entryNo: number | null;
  party: { type: SubledgerType; id: string; name: string } | null;
  debit: number;
  credit: number;
  /** Signed in the direction of the figure being explained, so the rows add up to the total. */
  amount: number;
  runningBalance: number | null;
  status: string;
  drill: TrailRef | null;
  document: TrailDocument | null;
}

/** One side of the arithmetic behind a derived figure. */
export interface TrailPart {
  label: string;
  amount: number;
  operator: '+' | '-' | '=';
  drill: TrailRef | null;
}

export interface TrailCounterpart {
  ledgerId: string;
  code: string;
  name: string;
  amount: number;
  drill: TrailRef;
}

export interface Trail {
  ref: TrailRef;
  title: string;
  subtitle: string;
  total: number;
  /**
   * The same movement as `total` but raw — debit minus credit, with no account direction applied.
   *
   * Carried because it is the figure the counterparts sum to the negative of, whatever kind of
   * account this is. `total` alone cannot serve: it is already flipped for income, liabilities and
   * equity, so a caller checking the two sides against each other would be right half the time.
   */
  signedTotal: number | null;
  opening: number | null;
  rows: TrailRow[];
  parts: TrailPart[];
  counterparts: TrailCounterpart[];
  parent: TrailRef | null;
  truncated: boolean;
  /** Said out loud when it applies, so a short trail does not read as a missing one. */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Source documents
// ---------------------------------------------------------------------------

/**
 * `sourceModel` to the admin screen that shows that document.
 *
 * Keyed on `sourceModel` rather than `sourceType` on purpose: several source types share one
 * document (a transfer posts `transfer_out`, `transfer_in` and `transfer_shrinkage`, all against
 * one `StockTransfer`), and a reversal carries the original's `sourceType`, so the type is not
 * the reliable key. `sourceModel` is stamped on every posted entry.
 *
 * `null` means the document is real but has no screen of its own — today collections, credit
 * recoveries, rider settlements and staff advances are reachable only as list rows, and those
 * lists take no filter, so sending someone to one would lose them rather than help.
 */
const DOCUMENT_ROUTES: Record<string, { label: string; path: ((id: string) => string) | null }> = {
  Order: { label: 'Order', path: (id) => `/orders/${id}` },
  DeliveryCollection: { label: 'Delivery collection', path: null },
  CreditRecovery: { label: 'Credit recovery', path: null },
  Settlement: { label: 'Rider settlement', path: null },
  StockReceipt: { label: 'Goods receipt', path: (id) => `/warehouse/stock-in/${id}` },
  Return: { label: 'Return', path: (id) => `/returns/${id}` },
  DamageClaim: { label: 'Damage claim', path: (id) => `/warehouse/damage/${id}` },
  StockTransfer: { label: 'Stock transfer', path: (id) => `/warehouse/transfers/${id}` },
  StockCount: { label: 'Stock count', path: (id) => `/warehouse/stock-count/${id}` },
  PurchaseBill: { label: 'Supplier bill', path: (id) => `/finance/bills/${id}` },
  SupplierPayment: { label: 'Supplier payment', path: (id) => `/finance/payments/${id}` },
  Expense: { label: 'Expense', path: (id) => `/finance/expenses/${id}` },
  Voucher: { label: 'Voucher', path: (id) => `/finance/vouchers/${id}` },
  PayrollRun: { label: 'Payroll run', path: (id) => `/finance/payroll/${id}` },
  StaffAdvance: { label: 'Staff advance', path: null },
};

/** Every `sourceModel` the posting services stamp. Exported so a test can assert completeness. */
export const KNOWN_SOURCE_MODELS = Object.keys(DOCUMENT_ROUTES);

export function documentFor(entry: {
  sourceType?: string;
  sourceModel?: string | null;
  sourceId?: Types.ObjectId | null;
}): TrailDocument | null {
  if (!entry.sourceId) return null;
  const model = entry.sourceModel ?? null;
  const route = model ? DOCUMENT_ROUTES[model] : undefined;
  const id = String(entry.sourceId);
  return {
    sourceType: entry.sourceType ?? 'manual',
    sourceModel: model,
    sourceId: id,
    href: route?.path ? route.path(id) : null,
  };
}

export function documentLabel(sourceModel: string | null): string | null {
  if (!sourceModel) return null;
  return DOCUMENT_ROUTES[sourceModel]?.label ?? sourceModel;
}

// ---------------------------------------------------------------------------
// Party names
// ---------------------------------------------------------------------------

/**
 * Resolve the shops, suppliers, riders, warehouses and staff named on a set of lines, in one
 * round trip per kind rather than one per line.
 */
async function resolveParties(
  lines: Pick<IJournalLine, 'subledgerRef'>[],
): Promise<Map<string, string>> {
  const byType = new Map<SubledgerType, Set<string>>();
  for (const line of lines) {
    const ref = line.subledgerRef;
    if (!ref) continue;
    const type = ref.type as SubledgerType;
    if (!byType.has(type)) byType.set(type, new Set());
    byType.get(type)!.add(String(ref.id));
  }

  const names = new Map<string, string>();
  const key = (type: string, id: string) => `${type}:${id}`;

  const ids = (type: SubledgerType) =>
    [...(byType.get(type) ?? [])].map((id) => new Types.ObjectId(id));

  if (byType.has('dealer')) {
    const rows = await DealerModel.find({ _id: { $in: ids('dealer') } })
      .select('_id name shopName')
      .lean()
      .exec();
    rows.forEach((r) => names.set(key('dealer', String(r._id)), r.shopName || r.name));
  }
  if (byType.has('vendor')) {
    const rows = await VendorModel.find({ _id: { $in: ids('vendor') } })
      .select('_id name')
      .lean()
      .exec();
    rows.forEach((r) => names.set(key('vendor', String(r._id)), r.name));
  }
  if (byType.has('warehouse')) {
    const rows = await WarehouseModel.find({ _id: { $in: ids('warehouse') } })
      .select('_id name')
      .lean()
      .exec();
    rows.forEach((r) => names.set(key('warehouse', String(r._id)), r.name));
  }
  // Riders and employees are both users; one query covers them.
  const userIds = [...ids('rider'), ...ids('employee')];
  if (userIds.length > 0) {
    const rows = await UserModel.find({ _id: { $in: userIds } })
      .select('_id username fullName')
      .lean()
      .exec();
    rows.forEach((r) => {
      const name = r.fullName || r.username;
      names.set(key('rider', String(r._id)), name);
      names.set(key('employee', String(r._id)), name);
    });
  }

  return names;
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function dateWindow(from?: string, to?: string): Record<string, Date> | null {
  const range: Record<string, Date> = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return Object.keys(range).length > 0 ? range : null;
}

function windowLabel(from?: string, to?: string): string {
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return 'every entry to date';
}

/**
 * The other side of the money.
 *
 * Given the lines that make up a figure, sum the SIBLING lines of the same entries per account.
 * "Sales 3,900,000" then reads as Accounts Receivable 3,480,000 and Cash 420,000 — which is the
 * question a person looking at a total is actually asking.
 *
 * Amounts are the counterpart's OWN movement, debit minus credit, and are deliberately not
 * re-signed against the figure being explained. That is what makes both directions read correctly
 * from one rule: rent of 12,000 paid in cash shows Cash −12,000 (money left it), and a sale of
 * 125,000 received in cash shows Cash +125,000 (money arrived). Re-signing against the subject
 * gets one of those two backwards, whichever way it is done, because an expense and an income
 * account read in opposite directions.
 *
 * The invariant this preserves is the one double-entry actually guarantees: these sum to the
 * negative of the subject's own signed movement, whatever kind of account the subject is.
 */
async function counterpartsFor(
  lines: Pick<IJournalLine, '_id' | 'journalEntryId'>[],
  windowRef: { from?: string; to?: string },
): Promise<TrailCounterpart[]> {
  if (lines.length === 0) return [];

  const entryIds = [...new Set(lines.map((l) => String(l.journalEntryId)))]
    .map((id) => new Types.ObjectId(id));
  const ownLineIds = lines.map((l) => l._id);

  /*
   * Summed by the database rather than by loading the sibling lines.
   *
   * The row cap bounds how many rows are SHOWN; it does not bound how many lines those rows'
   * entries hold between them. Loading them to add them up put an unbounded fetch behind a bounded
   * screen. Grouping in Mongo returns at most one document per account however many lines there
   * were, so nothing here grows with the size of the entries.
   */
  const grouped = await JournalLineModel.aggregate<{ _id: Types.ObjectId; flow: number }>([
    {
      $match: {
        journalEntryId: { $in: entryIds },
        _id: { $nin: ownLineIds },
        status: { $in: LIVE_STATUSES as unknown as string[] },
      },
    },
    { $group: { _id: '$ledgerId', flow: { $sum: '$signedAmount' } } },
  ]).exec();

  const byLedger = new Map<string, number>(
    grouped.map((row) => [String(row._id), round2(row.flow)]),
  );
  if (byLedger.size === 0) return [];

  const ledgers = await LedgerModel.find({
    _id: { $in: [...byLedger.keys()].map((id) => new Types.ObjectId(id)) },
  })
    .select('_id code name')
    .lean()
    .exec();

  return ledgers
    .map((ledger) => {
      const id = String(ledger._id);
      return {
        ledgerId: id,
        code: ledger.code,
        name: ledger.name,
        amount: round2(byLedger.get(id) ?? 0),
        drill: { kind: 'ledger' as const, ledgerId: id, from: windowRef.from, to: windowRef.to },
      };
    })
    .filter((c) => Math.abs(c.amount) > 0.004)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/**
 * Turn a matched set of lines into rows, in the direction the account itself reads.
 *
 * `debitNatured` decides the sign: for an asset or an expense a debit increases the figure, for
 * everything else a credit does. Without that the trail on a liability prints every row negative.
 */
async function rowsFrom(
  lines: (IJournalLine & { _id: Types.ObjectId })[],
  debitNatured: boolean,
  opening: number | null,
): Promise<{ rows: TrailRow[]; total: number; signedTotal: number }> {
  const entryIds = [...new Set(lines.map((l) => String(l.journalEntryId)))];
  const [entries, parties] = await Promise.all([
    JournalEntryModel.find({ _id: { $in: entryIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id entryNo narration referenceNo sourceType sourceId sourceModel status')
      .lean()
      .exec(),
    resolveParties(lines),
  ]);
  const entryById = new Map(entries.map((e) => [String(e._id), e]));

  let running = opening ?? 0;
  let movement = 0;
  let signed = 0;

  const rows: TrailRow[] = lines.map((line) => {
    const entry = entryById.get(String(line.journalEntryId));
    const amount = round2(debitNatured ? line.signedAmount : -line.signedAmount);
    movement = round2(movement + amount);
    signed = round2(signed + line.signedAmount);
    running = round2(running + amount);

    const ref = line.subledgerRef;
    const party = ref
      ? {
        type: ref.type as SubledgerType,
        id: String(ref.id),
        name: parties.get(`${ref.type}:${String(ref.id)}`) ?? 'Not on file',
      }
      : null;

    return {
      date: line.date ?? null,
      label: line.lineNarration || entry?.narration || 'No description',
      reference: entry?.referenceNo ?? null,
      entryNo: entry?.entryNo ?? null,
      party,
      debit: round2(line.debit),
      credit: round2(line.credit),
      amount,
      runningBalance: opening === null ? null : running,
      status: line.status,
      drill: { kind: 'entry', entryId: String(line.journalEntryId) },
      document: entry ? documentFor(entry) : null,
    };
  });

  return { rows, total: round2((opening ?? 0) + movement), signedTotal: signed };
}

// ---------------------------------------------------------------------------
// ledger
// ---------------------------------------------------------------------------

async function ledgerTrail(ref: Extract<TrailRef, { kind: 'ledger' }>): Promise<Trail> {
  if (!Types.ObjectId.isValid(ref.ledgerId)) throw badRequest('That is not an account id.');
  const ledger = await LedgerModel.findById(ref.ledgerId).lean().exec();
  if (!ledger) throw notFound('Account not found');
  const group = await AccountGroupModel.findById(ledger.groupId)
    .select('_id name accountType')
    .lean()
    .exec();
  if (!group) throw notFound('This account sits in a group that no longer exists');

  const match: FilterQuery<IJournalLine> = {
    ledgerId: new Types.ObjectId(ref.ledgerId),
    status: { $in: LIVE_STATUSES as unknown as string[] },
  };
  const window = dateWindow(ref.from, ref.to);
  if (window) match.date = window;

  const debitNatured = group.accountType === 'asset' || group.accountType === 'expense';

  // Everything before the window collapsed into one figure, so the running balance is right in a
  // filtered view. Mirrors `ledgerStatement`, which would otherwise disagree with this screen.
  let opening = round2(ledger.openingBalance?.amount ?? 0);
  if (ref.from) {
    const before = await JournalLineModel.aggregate<{ debit: number; credit: number }>([
      {
        $match: {
          ledgerId: new Types.ObjectId(ref.ledgerId),
          status: { $in: LIVE_STATUSES as unknown as string[] },
          date: { $lt: new Date(ref.from) },
        },
      },
      { $group: { _id: null, debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
    ]).exec();
    const net = round2((before[0]?.debit ?? 0) - (before[0]?.credit ?? 0));
    opening = round2(
      opening
      + naturalBalance(group.accountType as never, net > 0 ? net : 0, net < 0 ? -net : 0),
    );
  }

  const lines = await JournalLineModel.find(match)
    .sort({ date: 1, createdAt: 1 })
    .limit(ROW_CAP)
    .lean()
    .exec();

  const [{ rows, total, signedTotal }, counterparts] = await Promise.all([
    rowsFrom(lines as never, debitNatured, opening),
    counterpartsFor(lines as never, ref),
  ]);

  return {
    ref,
    title: `${ledger.code} · ${ledger.name}`,
    subtitle: `${group.name} · ${windowLabel(ref.from, ref.to)}`,
    total,
    signedTotal,
    opening,
    rows,
    parts: [],
    counterparts,
    parent: { kind: 'group', groupId: String(group._id), from: ref.from, to: ref.to },
    truncated: lines.length === ROW_CAP,
    note: lines.length === ROW_CAP
      ? `Only the first ${ROW_CAP} movements are shown, so the closing figure here is not the `
        + 'account balance. Narrow the dates to see a complete trail.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// group
// ---------------------------------------------------------------------------

/**
 * A group subtotal on the P&L or Balance Sheet: which accounts make it up.
 *
 * One level at a time, deliberately. A group four deep flattened into its leaf accounts hides the
 * structure the reader is using to navigate, and the structure is the point of the chart.
 */
async function groupTrail(ref: Extract<TrailRef, { kind: 'group' }>): Promise<Trail> {
  if (!Types.ObjectId.isValid(ref.groupId)) throw badRequest('That is not a group id.');
  const group = await AccountGroupModel.findById(ref.groupId).lean().exec();
  if (!group) throw notFound('Account group not found');

  const debitNatured = group.accountType === 'asset' || group.accountType === 'expense';
  const window = dateWindow(ref.from, ref.to);

  /*
   * A fixed number of queries whatever the size of the group.
   *
   * This used to ask for each sub-group's figure separately and each account's separately, in turn:
   * about three round trips per sub-group and one per account, one after another. Now the whole
   * subtree is fetched a level at a time (four levels at most), then every account under it, then
   * ONE aggregate grouped by account — and each figure is rolled up to the sub-group it sits under
   * in memory.
   */
  const tree = await groupTree(group._id);
  const ledgers = await LedgerModel.find({ groupId: { $in: tree.ids } })
    .select('_id code name groupId')
    .sort({ code: 1 })
    .lean()
    .exec();

  const netByLedger = new Map<string, number>();
  if (ledgers.length > 0) {
    const match: Record<string, unknown> = {
      ledgerId: { $in: ledgers.map((l) => l._id) },
      status: { $in: LIVE_STATUSES as unknown as string[] },
    };
    if (window) match.date = window;
    const sums = await JournalLineModel.aggregate<{ _id: Types.ObjectId; net: number }>([
      { $match: match },
      { $group: { _id: '$ledgerId', net: { $sum: '$signedAmount' } } },
    ]).exec();
    for (const row of sums) {
      const net = round2(row.net);
      netByLedger.set(String(row._id), round2(debitNatured ? net : -net));
    }
  }

  // Which of this group's own children each descendant group rolls up into.
  const rootId = String(group._id);
  const childOf = (groupId: string): string | null => {
    let current = groupId;
    for (let guard = 0; guard < 8; guard += 1) {
      const parent = tree.parentOf.get(current);
      if (!parent) return null;
      if (parent === rootId) return current;
      current = parent;
    }
    return null;
  };

  const childTotals = new Map<string, number>();
  const parts: TrailPart[] = [];
  const directLedgerParts: TrailPart[] = [];

  for (const ledger of ledgers) {
    const amount = netByLedger.get(String(ledger._id)) ?? 0;
    const home = String(ledger.groupId);
    if (home === rootId) {
      directLedgerParts.push({
        label: `${ledger.code} · ${ledger.name}`,
        amount,
        operator: '+',
        drill: { kind: 'ledger', ledgerId: String(ledger._id), from: ref.from, to: ref.to },
      });
      continue;
    }
    const child = childOf(home);
    if (child) childTotals.set(child, round2((childTotals.get(child) ?? 0) + amount));
  }

  for (const child of tree.children) {
    parts.push({
      label: `${child.code} · ${child.name}`,
      amount: childTotals.get(String(child._id)) ?? 0,
      operator: '+',
      drill: { kind: 'group', groupId: String(child._id), from: ref.from, to: ref.to },
    });
  }
  parts.push(...directLedgerParts);

  const total = round2(parts.reduce((sum, p) => sum + p.amount, 0));

  return {
    ref,
    title: `${group.code} · ${group.name}`,
    subtitle: `${group.accountType} group · ${windowLabel(ref.from, ref.to)}`,
    total,
    signedTotal: null,
    opening: null,
    rows: [],
    parts,
    counterparts: [],
    parent: group.parentGroupId
      ? { kind: 'group', groupId: String(group.parentGroupId), from: ref.from, to: ref.to }
      : null,
    truncated: false,
    note: parts.length === 0
      ? 'This group holds no accounts and no sub-groups, so there is nothing behind the figure.'
      : null,
  };
}

/**
 * A group's whole subtree, fetched one level per query. The chart nests four levels deep at most,
 * so this is bounded; the guard stops at eight in case a bad write ever made a cycle.
 */
async function groupTree(root: Types.ObjectId): Promise<{
  ids: Types.ObjectId[];
  parentOf: Map<string, string>;
  children: { _id: Types.ObjectId; code: string; name: string }[];
}> {
  const ids: Types.ObjectId[] = [root];
  const parentOf = new Map<string, string>();
  let children: { _id: Types.ObjectId; code: string; name: string }[] = [];
  let frontier = [root];

  for (let depth = 0; depth < 8 && frontier.length > 0; depth += 1) {
    const level = await AccountGroupModel.find({ parentGroupId: { $in: frontier } })
      .select('_id code name parentGroupId sortOrder')
      .sort({ sortOrder: 1, code: 1 })
      .lean()
      .exec();
    const fresh = level.filter((g) => !parentOf.has(String(g._id)) && String(g._id) !== String(root));
    for (const g of fresh) parentOf.set(String(g._id), String(g.parentGroupId));
    if (depth === 0) children = fresh.map((g) => ({ _id: g._id, code: g.code, name: g.name }));
    frontier = fresh.map((g) => g._id);
    ids.push(...frontier);
  }

  return { ids, parentOf, children };
}

// ---------------------------------------------------------------------------
// party
// ---------------------------------------------------------------------------

/**
 * One shop, supplier, rider, warehouse or member of staff, across a control account.
 *
 * `subledgerRef` has been on every line and indexed since the posting engine was built, and until
 * now nothing could read it. This is what turns "Accounts Receivable 3,480,000" into a list of
 * shops instead of a list of amounts.
 */
async function partyTrail(ref: Extract<TrailRef, { kind: 'party' }>): Promise<Trail> {
  if (!Types.ObjectId.isValid(ref.partyId)) throw badRequest('That is not a party id.');

  const match: FilterQuery<IJournalLine> = {
    'subledgerRef.type': ref.partyType,
    'subledgerRef.id': new Types.ObjectId(ref.partyId),
    status: { $in: LIVE_STATUSES as unknown as string[] },
  };
  if (ref.ledgerId) {
    if (!Types.ObjectId.isValid(ref.ledgerId)) throw badRequest('That is not an account id.');
    match.ledgerId = new Types.ObjectId(ref.ledgerId);
  }
  const window = dateWindow(ref.from, ref.to);
  if (window) match.date = window;

  const lines = await JournalLineModel.find(match)
    .sort({ date: 1, createdAt: 1 })
    .limit(ROW_CAP)
    .lean()
    .exec();

  // Direction from the account the lines sit on when one was named, otherwise from the first
  // line's account — a party's lines on a single control account all share one direction.
  const anchorLedgerId = ref.ledgerId ?? (lines[0] ? String(lines[0].ledgerId) : null);
  let debitNatured = true;
  let ledgerLabel = 'across every account';
  if (anchorLedgerId) {
    const ledger = await LedgerModel.findById(anchorLedgerId).select('code name groupId').lean().exec();
    const group = ledger
      ? await AccountGroupModel.findById(ledger.groupId).select('accountType').lean().exec()
      : null;
    if (group) debitNatured = group.accountType === 'asset' || group.accountType === 'expense';
    if (ledger) ledgerLabel = `${ledger.code} · ${ledger.name}`;
  }

  const [{ rows, total, signedTotal }, counterparts, names] = await Promise.all([
    rowsFrom(lines as never, debitNatured, 0),
    counterpartsFor(lines as never, ref),
    resolveParties([{ subledgerRef: { type: ref.partyType, id: new Types.ObjectId(ref.partyId) } }] as never),
  ]);

  const name = names.get(`${ref.partyType}:${ref.partyId}`) ?? 'Not on file';

  return {
    ref,
    title: name,
    subtitle: `${ref.partyType} · ${ledgerLabel} · ${windowLabel(ref.from, ref.to)}`,
    total,
    signedTotal,
    opening: 0,
    rows,
    parts: [],
    counterparts,
    parent: ref.ledgerId
      ? { kind: 'ledger', ledgerId: ref.ledgerId, from: ref.from, to: ref.to }
      : null,
    truncated: lines.length === ROW_CAP,
    note: lines.length === 0
      ? 'Nothing has been posted against this party in the accounts for this period.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/** One journal entry: both sides of it, and the document that caused it. */
async function entryTrail(ref: Extract<TrailRef, { kind: 'entry' }>): Promise<Trail> {
  if (!Types.ObjectId.isValid(ref.entryId)) throw badRequest('That is not an entry id.');
  const entry = await JournalEntryModel.findById(ref.entryId).lean().exec();
  if (!entry) throw notFound('Entry not found');

  const lines = await JournalLineModel.find({ journalEntryId: entry._id })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const ledgers = await LedgerModel.find({ _id: { $in: lines.map((l) => l.ledgerId) } })
    .select('_id code name')
    .lean()
    .exec();
  const ledgerById = new Map(ledgers.map((l) => [String(l._id), l]));
  const parties = await resolveParties(lines);

  const rows: TrailRow[] = lines.map((line) => {
    const ledger = ledgerById.get(String(line.ledgerId));
    const partyRef = line.subledgerRef;
    return {
      date: line.date ?? entry.date ?? null,
      label: ledger ? `${ledger.code} · ${ledger.name}` : 'Account no longer on file',
      reference: line.lineNarration || null,
      entryNo: entry.entryNo ?? null,
      party: partyRef
        ? {
          type: partyRef.type as SubledgerType,
          id: String(partyRef.id),
          name: parties.get(`${partyRef.type}:${String(partyRef.id)}`) ?? 'Not on file',
        }
        : null,
      debit: round2(line.debit),
      credit: round2(line.credit),
      amount: round2(line.signedAmount),
      runningBalance: null,
      status: line.status,
      // From a line of an entry the useful next hop is the ACCOUNT, not the entry we are already
      // looking at. This is the hop that makes the trail walkable in both directions.
      drill: { kind: 'ledger', ledgerId: String(line.ledgerId) },
      document: null,
    };
  });

  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));

  return {
    ref,
    title: entry.entryNo ? `Entry #${entry.entryNo}` : 'Draft entry',
    subtitle: `${entry.postingPeriod} · ${entry.narration || 'No description'}`,
    total: totalDebit,
    signedTotal: null,
    opening: null,
    rows,
    parts: [],
    counterparts: [],
    parent: entry.sourceId ? { kind: 'source', sourceId: String(entry.sourceId) } : null,
    truncated: false,
    note: entry.status === 'reversed'
      ? 'This entry has been reversed. Both it and its reversal stay on the record, so the '
        + 'account it sits on shows the pair and a net effect of nil.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// source
// ---------------------------------------------------------------------------

/**
 * A document, and every entry it produced.
 *
 * Deliberately NOT filtered by `NOT_A_REVERSAL`: asked "what did this document do to the books",
 * a cancellation is part of the answer and hiding it makes a reversed document look untouched.
 * Contrast the control queries, which mean "what is live" and must exclude reversals.
 */
async function sourceTrail(ref: Extract<TrailRef, { kind: 'source' }>): Promise<Trail> {
  if (!Types.ObjectId.isValid(ref.sourceId)) throw badRequest('That is not a document id.');

  const entries = await JournalEntryModel.find({ sourceId: new Types.ObjectId(ref.sourceId) })
    .sort({ date: 1, entryNo: 1 })
    .lean()
    .exec();

  if (entries.length === 0) {
    return {
      ref,
      title: 'Nothing in the accounts',
      subtitle: 'This document has not posted anything',
      total: 0,
      signedTotal: null,
      opening: null,
      rows: [],
      parts: [],
      counterparts: [],
      parent: null,
      truncated: false,
      note: 'Automatic posting is switched on one event at a time. A document raised while its '
        + 'switch was off posted nothing, and that is not a fault.',
    };
  }

  const lines = await JournalLineModel.find({
    journalEntryId: { $in: entries.map((e) => e._id) },
  })
    .lean()
    .exec();
  const ledgers = await LedgerModel.find({ _id: { $in: lines.map((l) => l.ledgerId) } })
    .select('_id code name')
    .lean()
    .exec();
  const ledgerById = new Map(ledgers.map((l) => [String(l._id), l]));
  const linesByEntry = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = String(line.journalEntryId);
    if (!linesByEntry.has(key)) linesByEntry.set(key, []);
    linesByEntry.get(key)!.push(line);
  }

  /*
   * A reversal is `status: 'posted'` and COPIES the original's `sourceId`, so it arrives here as
   * one of this document's own entries. `isReversal` is what keeps it out of the total: filtering
   * on status alone counts the cancellation instead of the thing it cancelled, which lands on the
   * same magnitude with the opposite meaning and makes a cancelled document look like a live one.
   */
  const rows: (TrailRow & { isReversal: boolean })[] = entries.map((entry) => {
    const own = linesByEntry.get(String(entry._id)) ?? [];
    // Each summed from its own lines rather than one copied into the other. They agree for a
    // balanced entry, which every posted entry is — so a row where they differ is a real finding.
    const debit = round2(own.reduce((s, l) => s + l.debit, 0));
    const credit = round2(own.reduce((s, l) => s + l.credit, 0));
    const accounts = own
      .map((l) => ledgerById.get(String(l.ledgerId))?.code)
      .filter(Boolean)
      .join(', ');
    const isReversal = Boolean(entry.reversalOf);
    return {
      date: entry.date ?? null,
      label: entry.narration || 'No description',
      reference: accounts || null,
      entryNo: entry.entryNo ?? null,
      party: null,
      debit,
      credit,
      // The size of the entry, signed: a reversal took the money back out, so it reads negative
      // against the document it undoes and the rows show the round trip.
      amount: isReversal ? round2(-debit) : debit,
      runningBalance: null,
      status: entry.status,
      drill: { kind: 'entry', entryId: String(entry._id) },
      document: null,
      isReversal,
    };
  });

  const first = entries[0];
  const label = documentLabel(first.sourceModel ?? null) ?? 'Document';
  const cancelled = rows.filter((r) => r.isReversal).length;

  return {
    ref,
    title: `${label} · what it did to the accounts`,
    subtitle: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
    /*
     * What this document is still doing to the books: posted, and not itself a reversal.
     *
     * A cancelled document therefore totals nil, which is what its accounts read. The halves are
     * both listed below because both happened; neither counts, because together they cancel.
     */
    total: round2(
      rows
        .filter((r) => r.status === 'posted' && !r.isReversal)
        .reduce((s, r) => s + r.debit, 0),
    ),
    signedTotal: null,
    opening: null,
    rows: rows.map(({ isReversal, ...row }) => row),
    parts: [],
    counterparts: [],
    parent: null,
    truncated: false,
    note: cancelled > 0
      ? 'Some of this was reversed. Both halves are listed because both happened, and neither is '
        + 'in the total because together they cancel — which is why the accounts read nil for them.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// derived
// ---------------------------------------------------------------------------

/**
 * A figure worked out in code rather than held on an account: gross profit, net profit, total
 * assets, total equity, net change in cash.
 *
 * These are the numbers people question first and the only ones that could not be explained at all,
 * because there is no account to open. Answered by showing the ARITHMETIC — the figures it is made
 * of, each with its operator and each drillable in turn — rather than by flattening it into a list
 * of accounts. Flattening loses the sign: "net profit" as one list of income and expense accounts
 * reads as a jumble, and the reader cannot see which side each one is on.
 *
 * `total` is recomputed from the parts under their own operators rather than copied from the
 * statement, so a trail that does not add up fails here instead of being presented as an
 * explanation.
 */
async function derivedTrail(ref: Extract<TrailRef, { kind: 'derived' }>): Promise<Trail> {
  const parts: TrailPart[] = [];
  let title = ref.figure;
  let subtitle = '';

  /** Section subtotals become one part each, so the reader can keep going down. */
  const fromSections = (
    sections: { groupId: string; code: string; name: string; total: number }[],
    operator: '+' | '-',
    window: { from?: string; to?: string },
  ) => sections.map((s) => ({
    label: `${s.code} · ${s.name}`,
    amount: s.total,
    operator,
    drill: { kind: 'group' as const, groupId: s.groupId, from: window.from, to: window.to },
  }));

  if (ref.report === 'profit-and-loss') {
    const statement = await profitAndLoss({ from: ref.from, to: ref.to });
    // Month keys on the statement, day keys on a trail: an account is filtered by date.
    const window = { from: `${statement.from}-01`, to: endOfMonth(statement.to) };
    subtitle = `${statement.from} to ${statement.to}`;

    if (ref.figure === 'incomeTotal' || ref.figure === 'grossProfit' || ref.figure === 'netProfit') {
      parts.push(...fromSections(statement.income, '+', window));
    }
    if (
      ref.figure === 'costOfSalesTotal'
      || ref.figure === 'grossProfit'
      || ref.figure === 'netProfit'
    ) {
      parts.push(...fromSections(statement.costOfSales, '-', window));
    }
    if (ref.figure === 'operatingExpensesTotal' || ref.figure === 'netProfit') {
      parts.push(...fromSections(statement.operatingExpenses, '-', window));
    }
    title = P_AND_L_TITLES[ref.figure] ?? ref.figure;
    if (parts.length === 0) throw badRequest(`"${ref.figure}" is not a figure on the Profit & Loss.`);
  } else if (ref.report === 'balance-sheet') {
    const statement = await balanceSheet({ asOf: ref.to ?? ref.from });
    const window = { to: endOfMonth(statement.asOf) };
    subtitle = `as at ${statement.asOf}`;

    switch (ref.figure) {
      case 'totalAssets':
        parts.push(...fromSections(statement.assets, '+', window));
        title = 'Total assets';
        break;
      case 'totalLiabilities':
        parts.push(...fromSections(statement.liabilities, '+', window));
        title = 'Total liabilities';
        break;
      case 'equityAccountsTotal':
        parts.push(...fromSections(statement.equity, '+', window));
        title = 'Equity accounts';
        break;
      case 'totalEquity':
        parts.push(...fromSections(statement.equity, '+', window));
        // Profit is not on an equity account until a year-end close runs, and no year-end close
        // exists in this system. It is derived from the income and expense accounts every time the
        // Balance Sheet is built, which is exactly why it needs saying here.
        parts.push({
          label: 'Profit brought forward from earlier years',
          amount: statement.profitBroughtForward,
          operator: '+',
          drill: null,
        });
        parts.push({
          label: 'Profit so far this financial year',
          amount: statement.profitThisYear,
          operator: '+',
          drill: {
            kind: 'derived',
            report: 'profit-and-loss',
            figure: 'netProfit',
            from: statement.fiscalYearStart,
            to: statement.asOf,
          },
        });
        title = 'Total equity';
        break;
      default:
        throw badRequest(`"${ref.figure}" is not a figure on the Balance Sheet.`);
    }
  } else {
    throw badRequest(`Figures on the ${ref.report} report cannot be broken down yet.`);
  }

  const total = round2(
    parts.reduce((sum, p) => (p.operator === '-' ? sum - p.amount : sum + p.amount), 0),
  );

  return {
    ref,
    title,
    subtitle,
    total,
    signedTotal: null,
    opening: null,
    rows: [],
    parts,
    counterparts: [],
    parent: null,
    truncated: false,
    note: 'This figure is worked out rather than held on an account. Each line below adds or '
      + 'subtracts as shown, and opens in turn.',
  };
}

const P_AND_L_TITLES: Record<string, string> = {
  incomeTotal: 'Total income',
  costOfSalesTotal: 'Cost of sales',
  grossProfit: 'Gross profit',
  operatingExpensesTotal: 'Operating expenses',
  netProfit: 'Net profit',
};

/** "2026-09" → "2026-09-30". A trail filters accounts by day; a statement works in months. */
function endOfMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function resolveTrail(ref: TrailRef): Promise<Trail> {
  switch (ref.kind) {
    case 'ledger':
      return ledgerTrail(ref);
    case 'group':
      return groupTrail(ref);
    case 'party':
      return partyTrail(ref);
    case 'entry':
      return entryTrail(ref);
    case 'source':
      return sourceTrail(ref);
    case 'derived':
      return derivedTrail(ref);
    default:
      throw badRequest('That is not a kind of figure this can explain.');
  }
}
