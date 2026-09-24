import { Types } from 'mongoose';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { SettlementModel } from '../../models/settlement.model';
import { UserModel } from '../../models/user.model';
import { badRequest } from '../../utils/app-error';
import { round2 } from './finance.rules';
import { NOT_A_REVERSAL } from './posting.service';
import { TrailDocument, documentFor } from './trail.service';

/**
 * The two registers of things that were undone or given up on: reversals, and rider cash written
 * off.
 *
 * Both are the acts a finance manager most needs to see in one place, because both are how money
 * leaves the books without a sale or a payment behind it. Each is its own read, gated on its own
 * row's view action — the rows existed before this did, and granting that view cell used to do
 * nothing at all.
 *
 * Both are read-only. Undoing an undo is its own act on the document it belongs to.
 */

/** Newest first, and no more than this, so a busy year cannot turn the register into a download. */
const REGISTER_CAP = 500;

function dayWindow(from?: string, to?: string): Record<string, Date> | null {
  const range: Record<string, Date> = {};
  for (const [label, value] of [['The start date', from], ['The end date', to]] as const) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw badRequest(`${label} "${value}" is not a date. Use YYYY-MM-DD.`);
    }
  }
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    throw badRequest('The start date is after the end date.');
  }
  return Object.keys(range).length > 0 ? range : null;
}

async function namesOf(ids: (Types.ObjectId | undefined | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id)))];
  if (unique.length === 0) return new Map();
  const users = await UserModel.find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
    .select('_id username fullName')
    .lean()
    .exec();
  return new Map(users.map((u) => [String(u._id), u.fullName || u.username]));
}

// ---------------------------------------------------------------------------
// Reversals
// ---------------------------------------------------------------------------

export interface ReversalRow {
  /** The entry that was undone. */
  entryId: string;
  entryNo: number | null;
  /** The entry that undid it. */
  reversalEntryId: string | null;
  reversalEntryNo: number | null;
  /** The business date of what was undone. */
  date: Date;
  reversedAt: Date | null;
  reversedBy: string | null;
  reason: string;
  amount: number;
  narration: string;
  sourceType: string;
  document: TrailDocument | null;
}

export interface ReversalRegister {
  rows: ReversalRow[];
  count: number;
  total: number;
  truncated: boolean;
}

/**
 * Every posted entry that was later reversed — the original, not the reversal, because the
 * original is what somebody decided should not stand, and it carries who decided, when and why.
 *
 * Filtered on WHEN it was reversed, not on the original's date: the question this answers is "what
 * has been undone this month", and an old entry undone today belongs to today.
 */
export async function listReversals(
  input: { from?: string; to?: string } = {},
): Promise<ReversalRegister> {
  const window = dayWindow(input.from, input.to);
  const match: Record<string, unknown> = { status: 'reversed' };
  if (window) match.reversedAt = window;

  const originals = await JournalEntryModel.find(match)
    .sort({ reversedAt: -1, _id: -1 })
    .limit(REGISTER_CAP + 1)
    .select(
      '_id entryNo date reversedAt reversedBy reversalReason reversedByEntryId totalDebit '
      + 'narration sourceType sourceId sourceModel',
    )
    .lean()
    .exec();

  const truncated = originals.length > REGISTER_CAP;
  const shown = originals.slice(0, REGISTER_CAP);

  const reversalIds = shown.map((e) => e.reversedByEntryId).filter(Boolean);
  const [reversals, names] = await Promise.all([
    JournalEntryModel.find({ _id: { $in: reversalIds } }).select('_id entryNo').lean().exec(),
    namesOf(shown.map((e) => e.reversedBy)),
  ]);
  const reversalNo = new Map(reversals.map((r) => [String(r._id), r.entryNo ?? null]));

  const rows: ReversalRow[] = shown.map((entry) => ({
    entryId: String(entry._id),
    entryNo: entry.entryNo ?? null,
    reversalEntryId: entry.reversedByEntryId ? String(entry.reversedByEntryId) : null,
    reversalEntryNo: entry.reversedByEntryId
      ? reversalNo.get(String(entry.reversedByEntryId)) ?? null
      : null,
    date: entry.date,
    reversedAt: entry.reversedAt ?? null,
    reversedBy: entry.reversedBy ? names.get(String(entry.reversedBy)) ?? 'Not on file' : null,
    reason: entry.reversalReason ?? '',
    amount: round2(entry.totalDebit ?? 0),
    narration: entry.narration ?? '',
    sourceType: entry.sourceType,
    document: documentFor(entry),
  }));

  return {
    rows,
    count: rows.length,
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Write-offs
// ---------------------------------------------------------------------------

export interface WriteOffRow {
  settlementId: string;
  riderId: string;
  rider: string;
  mode: 'cash' | 'online';
  amount: number;
  reason: string;
  at: Date;
  by: string | null;
  /** A voided write-off put the money back on the rider — listed, never counted. */
  voided: boolean;
  voidReason: string | null;
  /** The live posting, when the settlement switch was on at the time. */
  entryId: string | null;
  entryNo: number | null;
}

export interface WriteOffRegister {
  rows: WriteOffRow[];
  count: number;
  /** Written off and still standing. Voided rows are excluded. */
  total: number;
  /** Standing write-offs with no entry in the books: written off while posting was switched off. */
  unposted: number;
  truncated: boolean;
}

/**
 * Every shortfall written off a rider.
 *
 * Read from the SETTLEMENTS, not from the journal. A write-off is recorded operationally whether or
 * not the settlement posting switch was on, and a register built from journal entries would show
 * nothing at all for every write-off made while it was off — which is every one so far. The entry
 * is attached where one exists, and `unposted` says how many have none.
 */
export async function listWriteOffs(
  input: { from?: string; to?: string } = {},
): Promise<WriteOffRegister> {
  const window = dayWindow(input.from, input.to);
  const match: Record<string, unknown> = { kind: 'writeoff' };
  if (window) match.submittedAt = window;

  const settlements = await SettlementModel.find(match)
    .sort({ submittedAt: -1, _id: -1 })
    .limit(REGISTER_CAP + 1)
    .select('_id riderId mode amount writeoffReason submittedAt receivedAt receivedBy voidedAt voidReason')
    .lean()
    .exec();

  const truncated = settlements.length > REGISTER_CAP;
  const shown = settlements.slice(0, REGISTER_CAP);

  const [names, entries] = await Promise.all([
    namesOf([...shown.map((s) => s.riderId), ...shown.map((s) => s.receivedBy)]),
    JournalEntryModel.find({
      sourceId: { $in: shown.map((s) => s._id) },
      sourceType: 'settlement_variance',
      status: 'posted',
      // The live posting only. A reversal carries the same source and is itself posted.
      ...NOT_A_REVERSAL,
    })
      .select('_id entryNo sourceId')
      .lean()
      .exec(),
  ]);
  const entryBySettlement = new Map(entries.map((e) => [String(e.sourceId), e]));

  const rows: WriteOffRow[] = shown.map((s) => {
    const entry = entryBySettlement.get(String(s._id));
    return {
      settlementId: String(s._id),
      riderId: String(s.riderId),
      rider: names.get(String(s.riderId)) ?? 'Not on file',
      mode: s.mode,
      amount: round2(s.amount),
      reason: s.writeoffReason ?? '',
      at: s.receivedAt ?? s.submittedAt,
      by: s.receivedBy ? names.get(String(s.receivedBy)) ?? 'Not on file' : null,
      voided: Boolean(s.voidedAt),
      voidReason: s.voidReason ?? null,
      entryId: entry ? String(entry._id) : null,
      entryNo: entry?.entryNo ?? null,
    };
  });

  const standing = rows.filter((r) => !r.voided);
  return {
    rows,
    count: rows.length,
    total: round2(standing.reduce((s, r) => s + r.amount, 0)),
    unposted: standing.filter((r) => !r.entryId).length,
    truncated,
  };
}
