import { Types } from 'mongoose';
import { JournalEntryModel, IJournalEntry } from '../../models/journal-entry.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { badRequest, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { checkPostable } from './period.service';
import {
  JournalLineInput,
  assertBalanced,
  naturalBalance,
  normaliseLines,
  periodKeyFor,
  round2,
} from './finance.rules';

/**
 * Journal entries: drafting, reading, and the reports built directly on the posting ledger.
 *
 * Everything that MOVES money lives in `posting.service.ts`. This file only writes drafts,
 * which move nothing.
 */

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface DraftInput {
  date: string | Date;
  narration?: string;
  referenceNo?: string;
  lines: JournalLineInput[];
  attachments?: string[];
}

/** Shape a draft's lines for storage, validating them but moving nothing. */
function toDraftLines(lines: JournalLineInput[]) {
  const normalised = normaliseLines(lines);
  // Balance is checked on a draft too — but as guidance, not a refusal. An accountant builds an
  // entry a line at a time and a half-written draft is a normal state, so the totals come back
  // in the response and Post is what enforces the rule.
  return normalised.map((l) => ({
    ledgerId: new Types.ObjectId(l.ledgerId),
    debit: l.debit,
    credit: l.credit,
    lineNarration: l.lineNarration,
    subledgerRef: l.subledgerRef
      ? { type: l.subledgerRef.type, id: new Types.ObjectId(l.subledgerRef.id) }
      : null,
  }));
}

export async function createDraft(input: DraftInput, actorId?: string): Promise<IJournalEntry> {
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) throw badRequest('Enter a valid date.');
  if (!input.narration?.trim()) {
    // Required on a manual entry and only on a manual entry: a system posting explains itself
    // through its source document, but a hand-typed entry with no description is unreadable to
    // whoever finds it in six months.
    throw badRequest('Describe what this entry is for.');
  }

  const draftLines = toDraftLines(input.lines);
  const totals = assertBalancedPreview(input.lines);

  const entry = await JournalEntryModel.create({
    date,
    postingPeriod: periodKeyFor(date),
    narration: input.narration.trim(),
    referenceNo: input.referenceNo,
    sourceType: 'manual',
    status: 'draft',
    isSystemGenerated: false,
    totalDebit: totals.totalDebit,
    totalCredit: totals.totalCredit,
    draftLines,
    attachments: input.attachments ?? [],
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'journal_entry',
    entityId: String(entry._id),
    action: 'created',
    meta: { narration: entry.narration, totalDebit: entry.totalDebit },
  });

  return entry;
}

/** Totals without throwing on an imbalance — a draft is allowed to be mid-thought. */
function assertBalancedPreview(lines: JournalLineInput[]) {
  const normalised = normaliseLines(lines);
  const totalDebit = round2(normalised.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(normalised.reduce((s, l) => s + l.credit, 0));
  return { totalDebit, totalCredit };
}

export async function updateDraft(
  id: string,
  input: Partial<DraftInput>,
  actorId?: string,
): Promise<IJournalEntry> {
  const entry = await JournalEntryModel.findById(id).exec();
  if (!entry) throw notFound('Entry not found');

  if (entry.status !== 'draft') {
    throw badRequest(
      `This entry is ${entry.status}. A posted entry is never edited — reverse it and post a `
        + 'corrected one, so both remain readable.',
    );
  }

  if (input.date !== undefined) {
    const date = new Date(input.date);
    if (Number.isNaN(date.getTime())) throw badRequest('Enter a valid date.');
    entry.date = date;
    entry.postingPeriod = periodKeyFor(date);
  }
  if (input.narration !== undefined) entry.narration = input.narration.trim();
  if (input.referenceNo !== undefined) entry.referenceNo = input.referenceNo;
  if (input.attachments !== undefined) entry.attachments = input.attachments;

  if (input.lines !== undefined) {
    entry.draftLines = toDraftLines(input.lines);
    const totals = assertBalancedPreview(input.lines);
    entry.totalDebit = totals.totalDebit;
    entry.totalCredit = totals.totalCredit;
  }

  entry.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await entry.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'journal_entry',
    entityId: String(entry._id),
    action: 'updated',
    meta: { narration: entry.narration },
  });

  return entry;
}

export async function deleteDraft(id: string, actorId?: string): Promise<{ message: string }> {
  const entry = await JournalEntryModel.findById(id).exec();
  if (!entry) throw notFound('Entry not found');

  if (entry.status !== 'draft') {
    throw badRequest(
      `This entry is ${entry.status} and cannot be deleted. Reverse it instead — a deleted `
        + 'posted entry is an unauditable one.',
    );
  }

  await entry.deleteOne();

  logActivityAsync({
    employeeId: actorId,
    module: 'journal_entry',
    entityId: id,
    action: 'deleted',
    meta: { narration: entry.narration },
  });

  return { message: 'Draft deleted' };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface EntryFilters {
  status?: string;
  sourceType?: string;
  period?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  skip?: number;
}

export async function listEntries(filters: EntryFilters = {}) {
  const query: Record<string, unknown> = {};

  if (filters.status) query.status = filters.status;
  if (filters.sourceType) query.sourceType = filters.sourceType;
  if (filters.period) query.postingPeriod = filters.period;

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) {
      const to = new Date(filters.to);
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    query.date = range;
  }

  if (filters.search) {
    const safe = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asNumber = Number(filters.search);
    query.$or = [
      { narration: new RegExp(safe, 'i') },
      { referenceNo: new RegExp(safe, 'i') },
      ...(Number.isInteger(asNumber) ? [{ entryNo: asNumber }] : []),
    ];
  }

  const limit = Math.min(filters.limit ?? 100, 500);
  const skip = filters.skip ?? 0;

  const [entries, total] = await Promise.all([
    JournalEntryModel.find(query).sort({ date: -1, entryNo: -1 }).skip(skip).limit(limit).lean().exec(),
    JournalEntryModel.countDocuments(query).exec(),
  ]);

  return { entries, total, limit, skip };
}

/** One entry with its lines resolved to account names. */
export async function getEntry(id: string) {
  const entry = await JournalEntryModel.findById(id).lean().exec();
  if (!entry) throw notFound('Entry not found');

  const posted = await JournalLineModel.find({ journalEntryId: entry._id })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  // A draft's lines live on the header; a posted entry's live in the ledger. One shape out,
  // either way, so the screen does not need to know which it is looking at.
  const rawLines = posted.length > 0
    ? posted.map((l) => ({
        ledgerId: l.ledgerId,
        debit: l.debit,
        credit: l.credit,
        lineNarration: l.lineNarration,
        subledgerRef: l.subledgerRef,
        balanceAfter: l.balanceAfter,
      }))
    : (entry.draftLines ?? []).map((l) => ({
        ledgerId: l.ledgerId,
        debit: l.debit,
        credit: l.credit,
        lineNarration: l.lineNarration,
        subledgerRef: l.subledgerRef,
        balanceAfter: undefined,
      }));

  const ledgers = await LedgerModel.find({ _id: { $in: rawLines.map((l) => l.ledgerId) } })
    .select('_id code name')
    .lean()
    .exec();
  const byId = new Map(ledgers.map((l) => [String(l._id), l]));

  const postable = await checkPostable(entry.date, { isReversal: Boolean(entry.reversalOf) });

  return {
    ...entry,
    draftLines: undefined,
    lines: rawLines.map((l) => ({
      ledgerId: String(l.ledgerId),
      ledgerCode: byId.get(String(l.ledgerId))?.code ?? '—',
      ledgerName: byId.get(String(l.ledgerId))?.name ?? 'Deleted account',
      debit: l.debit,
      credit: l.credit,
      lineNarration: l.lineNarration,
      subledgerRef: l.subledgerRef ?? null,
      balanceAfter: l.balanceAfter,
    })),
    periodStatus: postable.status,
    canPost: entry.status === 'draft' && postable.ok,
    postBlockedReason: entry.status === 'draft' && !postable.ok ? postable.reason : undefined,
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * Trial Balance: every account with its closing debit or credit, and the two totals that must
 * agree. The primary integrity check of the whole system.
 */
export async function trialBalance(asOf?: string) {
  const match: Record<string, unknown> = { status: { $in: ['posted', 'reversed'] } };
  if (asOf) {
    const to = new Date(asOf);
    to.setHours(23, 59, 59, 999);
    match.date = { $lte: to };
  }

  const sums = await JournalLineModel.aggregate<{
    _id: Types.ObjectId;
    debit: number;
    credit: number;
  }>([
    { $match: match },
    { $group: { _id: '$ledgerId', debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
  ]).exec();

  const [ledgers, groups] = await Promise.all([
    LedgerModel.find().select('_id code name groupId isActive').lean().exec(),
    AccountGroupModel.find().select('_id name accountType').lean().exec(),
  ]);

  const groupById = new Map(groups.map((g) => [String(g._id), g]));
  const sumById = new Map(sums.map((s) => [String(s._id), s]));

  const rows = ledgers
    .map((ledger) => {
      const group = groupById.get(String(ledger.groupId));
      if (!group) return null;

      const sum = sumById.get(String(ledger._id));
      const debit = round2(sum?.debit ?? 0);
      const credit = round2(sum?.credit ?? 0);
      const net = round2(debit - credit);

      // An account sitting against its normal direction reports on the OTHER side rather than
      // as a negative in its usual column. That is what keeps the two totals equal, which is
      // the one property this report exists to demonstrate.
      return {
        ledgerId: String(ledger._id),
        code: ledger.code,
        name: ledger.name,
        groupName: group.name,
        accountType: group.accountType,
        debitTotal: debit,
        creditTotal: credit,
        closingDebit: net > 0 ? net : 0,
        closingCredit: net < 0 ? round2(-net) : 0,
        naturalBalance: naturalBalance(group.accountType as never, debit, credit),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => r.debitTotal !== 0 || r.creditTotal !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = round2(rows.reduce((s, r) => s + r.closingDebit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.closingCredit, 0));

  return {
    asOf: asOf ?? null,
    rows,
    totalDebit,
    totalCredit,
    difference: round2(totalDebit - totalCredit),
    balanced: Math.abs(totalDebit - totalCredit) < 0.005,
  };
}

/** Ledger Statement: one account, in date order, with a running balance. Like a bank statement. */
export async function ledgerStatement(
  ledgerId: string,
  options: { from?: string; to?: string } = {},
) {
  const ledger = await LedgerModel.findById(ledgerId).lean().exec();
  if (!ledger) throw notFound('Account not found');
  const group = await AccountGroupModel.findById(ledger.groupId).select('name accountType').lean().exec();
  if (!group) throw notFound('This account sits in a group that no longer exists');

  const match: Record<string, unknown> = {
    ledgerId: new Types.ObjectId(ledgerId),
    status: { $in: ['posted', 'reversed'] },
  };

  const dateRange: Record<string, Date> = {};
  if (options.from) dateRange.$gte = new Date(options.from);
  if (options.to) {
    const to = new Date(options.to);
    to.setHours(23, 59, 59, 999);
    dateRange.$lte = to;
  }
  if (Object.keys(dateRange).length > 0) match.date = dateRange;

  // Everything before the window, collapsed into one opening figure. Without it the running
  // balance in a filtered view starts from zero and every row is wrong.
  let opening = round2(ledger.openingBalance?.amount ?? 0);
  if (options.from) {
    const before = await JournalLineModel.aggregate<{ debit: number; credit: number }>([
      {
        $match: {
          ledgerId: new Types.ObjectId(ledgerId),
          status: { $in: ['posted', 'reversed'] },
          date: { $lt: new Date(options.from) },
        },
      },
      { $group: { _id: null, debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
    ]).exec();
    const net = round2((before[0]?.debit ?? 0) - (before[0]?.credit ?? 0));
    opening = round2(
      opening + (naturalBalance(group.accountType as never, net > 0 ? net : 0, net < 0 ? -net : 0)),
    );
  }

  const lines = await JournalLineModel.find(match)
    .sort({ date: 1, createdAt: 1 })
    .limit(2000)
    .lean()
    .exec();

  const entryIds = [...new Set(lines.map((l) => String(l.journalEntryId)))];
  const entries = await JournalEntryModel.find({ _id: { $in: entryIds } })
    .select('_id entryNo narration referenceNo sourceType status')
    .lean()
    .exec();
  const entryById = new Map(entries.map((e) => [String(e._id), e]));

  const isDebitNatured = group.accountType === 'asset' || group.accountType === 'expense';
  let running = opening;

  const rows = lines.map((line) => {
    const entry = entryById.get(String(line.journalEntryId));
    running = round2(running + (isDebitNatured ? line.signedAmount : -line.signedAmount));
    return {
      date: line.date,
      entryNo: entry?.entryNo ?? null,
      entryId: String(line.journalEntryId),
      referenceNo: entry?.referenceNo ?? null,
      narration: line.lineNarration || entry?.narration || '',
      sourceType: entry?.sourceType ?? 'manual',
      status: line.status,
      debit: line.debit,
      credit: line.credit,
      runningBalance: running,
    };
  });

  return {
    ledger: {
      id: String(ledger._id),
      code: ledger.code,
      name: ledger.name,
      groupName: group.name,
      accountType: group.accountType,
    },
    opening,
    closing: running,
    rows,
    truncated: lines.length === 2000,
  };
}

/** Day Book: entries in sequence for a date or a range, with their lines. */
export async function dayBook(from: string, to?: string) {
  const start = new Date(from);
  const end = new Date(to ?? from);
  end.setHours(23, 59, 59, 999);

  const entries = await JournalEntryModel.find({
    date: { $gte: start, $lte: end },
    status: { $in: ['posted', 'reversed'] },
  })
    .sort({ date: 1, entryNo: 1 })
    .limit(500)
    .lean()
    .exec();

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

  return {
    from,
    to: to ?? from,
    entries: entries.map((entry) => ({
      id: String(entry._id),
      entryNo: entry.entryNo ?? null,
      date: entry.date,
      referenceNo: entry.referenceNo ?? null,
      narration: entry.narration ?? '',
      sourceType: entry.sourceType,
      status: entry.status,
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
      lines: (linesByEntry.get(String(entry._id)) ?? []).map((l) => ({
        ledgerCode: ledgerById.get(String(l.ledgerId))?.code ?? '—',
        ledgerName: ledgerById.get(String(l.ledgerId))?.name ?? 'Deleted account',
        debit: l.debit,
        credit: l.credit,
      })),
    })),
    truncated: entries.length === 500,
  };
}
