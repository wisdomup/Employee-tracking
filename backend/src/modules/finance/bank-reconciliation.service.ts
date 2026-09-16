import { Types } from 'mongoose';
import { BankReconciliationModel, IBankReconciliation } from '../../models/bank-reconciliation.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { round2, MONEY_EPSILON } from './finance.rules';
import { withFinanceLocks } from './finance-locks';

/**
 * Proving a bank account against the bank's own statement.
 *
 * ## Why this check is different from all the others
 *
 * Every other control in this module proves our books against another part of OUR system — the
 * warehouse counts, the collections records. Those catch a posting bug, but they cannot catch a
 * mistake made consistently on both sides. This one compares against a record the business does
 * not control, which is the only check that a bug in our own code cannot talk its way past.
 *
 * ## The rule everything here exists to protect
 *
 * A reconciliation may only be completed when the difference is nil. Completing one that still
 * has an unexplained gap is worse than never reconciling at all: it puts a signed-off record on
 * file saying the bank agreed, when it did not, and the next person has no reason to look again.
 *
 * ## It posts nothing
 *
 * See the model. Ticking a line means the bank agrees it happened; it changes no figure. A bank
 * charge the books have never heard of is recorded as an expense, by somebody who chose to, on
 * the screen built for it.
 */

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

interface LedgerContext {
  _id: Types.ObjectId;
  code: string;
  name: string;
  openingBalance: number;
  isDebitNatured: boolean;
}

/**
 * Load the account and work out which way round its balance runs.
 *
 * Read through the group rather than assumed, because the chart is genuinely editable — somebody
 * may add a second bank account under a group of their own, and hardcoding "a bank is an asset"
 * would silently invert every figure on this screen if they filed it elsewhere.
 */
async function loadCashLedger(ledgerId: string): Promise<LedgerContext> {
  if (!Types.ObjectId.isValid(ledgerId)) throw badRequest('That is not an account id.');

  const ledger = await LedgerModel.findById(ledgerId).lean().exec();
  if (!ledger) throw notFound('Account not found');

  if (!ledger.isCashEquivalent) {
    throw badRequest(
      `"${ledger.code} ${ledger.name}" is not a cash or bank account, so there is no statement to `
        + 'check it against. Mark it as cash on the chart of accounts if it is one.',
    );
  }

  const group = await AccountGroupModel.findById(ledger.groupId).select('accountType').lean().exec();
  if (!group) {
    throw badRequest(
      `"${ledger.code} ${ledger.name}" sits in a group that no longer exists, so its balance `
        + 'cannot be worked out.',
    );
  }

  return {
    _id: ledger._id,
    code: ledger.code,
    name: ledger.name,
    openingBalance: round2(ledger.openingBalance?.amount ?? 0),
    isDebitNatured: group.accountType === 'asset' || group.accountType === 'expense',
  };
}

/** The end of the statement day, so a line posted that afternoon is not left out by an hour. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * What a line does to this account's balance.
 *
 * `signedAmount` is always `debit − credit`. On a debit-natured account that IS the movement; on
 * a credit-natured one it is its opposite. Same conversion the ledger statement makes, and it
 * has to agree with it or the two screens would disagree about the same account.
 */
function effectOf(signedAmount: number, isDebitNatured: boolean): number {
  return isDebitNatured ? signedAmount : -signedAmount;
}

/**
 * Every line id already claimed by a COMPLETED reconciliation on this account.
 *
 * Drafts claim nothing. Two people may tick the same deposit on two drafts and neither is wrong
 * yet — whichever completes first takes it, and the second is told at the moment it matters.
 */
async function claimedLineIds(
  ledgerId: Types.ObjectId,
  options: { excludeId?: string } = {},
): Promise<Set<string>> {
  const query: Record<string, unknown> = { ledgerId, status: 'completed' };
  if (options.excludeId && Types.ObjectId.isValid(options.excludeId)) {
    query._id = { $ne: new Types.ObjectId(options.excludeId) };
  }

  const done = await BankReconciliationModel.find(query).select('clearedLineIds').lean().exec();

  const claimed = new Set<string>();
  for (const rec of done) {
    for (const id of rec.clearedLineIds) claimed.add(String(id));
  }
  return claimed;
}

/** The account's balance on the statement date, by the books. */
async function bookBalanceAsOf(ledger: LedgerContext, statementDate: Date): Promise<number> {
  const rows = await JournalLineModel.aggregate<{ signed: number }>([
    {
      $match: {
        ledgerId: ledger._id,
        // A reversed line and the line that reversed it both count; together they net to nil.
        // Dropping the original would leave only the reversal and show the balance backwards.
        status: { $in: ['posted', 'reversed'] },
        date: { $lte: endOfDay(statementDate) },
      },
    },
    { $group: { _id: null, signed: { $sum: '$signedAmount' } } },
  ]).exec();

  return round2(ledger.openingBalance + effectOf(rows[0]?.signed ?? 0, ledger.isDebitNatured));
}

// ---------------------------------------------------------------------------
// The worksheet
// ---------------------------------------------------------------------------

export interface WorksheetLine {
  lineId: string;
  date: Date;
  entryNo: number | null;
  entryId: string;
  referenceNo: string | null;
  narration: string;
  sourceType: string;
  debit: number;
  credit: number;
  /** Signed the way this account runs: positive puts money in, negative takes it out. */
  effect: number;
  cleared: boolean;
}

export interface ReconciliationView {
  id: string;
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  statementDate: Date;
  statementClosingBalance: number;
  status: 'draft' | 'completed';
  bookBalance: number;
  clearedTotal: number;
  unclearedTotal: number;
  /** What the bank ought to be showing, if every unticked item is simply still in flight. */
  expectedStatementBalance: number;
  difference: number;
  balances: boolean;
  clearedCount: number;
  unclearedCount: number;
  notes?: string;
  completedAt?: Date;
  reopenReason?: string;
  createdAt: Date;
}

export interface ReconciliationDetail extends ReconciliationView {
  lines: WorksheetLine[];
  truncated: boolean;
}

/** How many lines one worksheet will carry. Beyond this the statement period is too wide. */
const LINE_LIMIT = 1000;

async function buildDetail(rec: IBankReconciliation): Promise<ReconciliationDetail> {
  const ledger = await loadCashLedger(String(rec.ledgerId));

  const [bookBalance, claimed] = await Promise.all([
    bookBalanceAsOf(ledger, rec.statementDate),
    claimedLineIds(ledger._id, { excludeId: String(rec._id) }),
  ]);

  const lines = await JournalLineModel.find({
    ledgerId: ledger._id,
    status: { $in: ['posted', 'reversed'] },
    date: { $lte: endOfDay(rec.statementDate) },
  })
    .sort({ date: 1, createdAt: 1 })
    .limit(LINE_LIMIT + 1)
    .lean()
    .exec();

  const truncated = lines.length > LINE_LIMIT;
  // Anything a previous statement already accounted for is out of this one's hands entirely.
  const candidates = lines.slice(0, LINE_LIMIT).filter((l) => !claimed.has(String(l._id)));

  const entryIds = [...new Set(candidates.map((l) => String(l.journalEntryId)))];
  const entries = await JournalEntryModel.find({ _id: { $in: entryIds } })
    .select('_id entryNo narration referenceNo sourceType')
    .lean()
    .exec();
  const entryById = new Map(entries.map((e) => [String(e._id), e]));

  const clearedHere = new Set(rec.clearedLineIds.map((id) => String(id)));

  let clearedTotal = 0;
  let unclearedTotal = 0;

  const worksheet: WorksheetLine[] = candidates.map((line) => {
    const entry = entryById.get(String(line.journalEntryId));
    const effect = round2(effectOf(line.signedAmount, ledger.isDebitNatured));
    const cleared = clearedHere.has(String(line._id));

    if (cleared) clearedTotal = round2(clearedTotal + effect);
    else unclearedTotal = round2(unclearedTotal + effect);

    return {
      lineId: String(line._id),
      date: line.date,
      entryNo: entry?.entryNo ?? null,
      entryId: String(line.journalEntryId),
      referenceNo: entry?.referenceNo ?? null,
      narration: line.lineNarration || entry?.narration || '',
      sourceType: entry?.sourceType ?? 'manual',
      debit: round2(line.debit),
      credit: round2(line.credit),
      effect,
      cleared,
    };
  });

  /*
   * The bank has seen everything except what is still in flight.
   *
   * Written as book MINUS uncleared rather than as "opening plus cleared" so that lines settled
   * by an earlier statement — which the bank's running balance still carries — are included
   * without having to be re-added here.
   */
  const expectedStatementBalance = round2(bookBalance - unclearedTotal);
  const difference = round2(rec.statementClosingBalance - expectedStatementBalance);

  return {
    id: String(rec._id),
    ledgerId: String(ledger._id),
    ledgerCode: ledger.code,
    ledgerName: ledger.name,
    statementDate: rec.statementDate,
    statementClosingBalance: round2(rec.statementClosingBalance),
    status: rec.status,
    bookBalance,
    clearedTotal,
    unclearedTotal,
    expectedStatementBalance,
    difference,
    balances: Math.abs(difference) < MONEY_EPSILON,
    clearedCount: worksheet.filter((l) => l.cleared).length,
    unclearedCount: worksheet.filter((l) => !l.cleared).length,
    notes: rec.notes,
    completedAt: rec.completedAt,
    reopenReason: rec.reopenReason,
    createdAt: rec.createdAt,
    lines: worksheet,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ReconcilableAccount {
  ledgerId: string;
  code: string;
  name: string;
  currentBalance: number;
  lastStatementDate: Date | null;
  lastReconciledAt: Date | null;
  openDraftId: string | null;
}

/** The accounts there is any point reconciling, and how far each one has got. */
export async function reconcilableAccounts(): Promise<ReconcilableAccount[]> {
  const ledgers = await LedgerModel.find({ isCashEquivalent: true, isActive: true })
    .select('_id code name cachedBalance')
    .sort({ code: 1 })
    .lean()
    .exec();

  const recs = await BankReconciliationModel.find({
    ledgerId: { $in: ledgers.map((l) => l._id) },
  })
    .select('ledgerId statementDate status completedAt')
    .sort({ statementDate: -1 })
    .lean()
    .exec();

  return ledgers.map((ledger) => {
    const mine = recs.filter((r) => String(r.ledgerId) === String(ledger._id));
    const lastDone = mine.find((r) => r.status === 'completed');
    const draft = mine.find((r) => r.status === 'draft');

    return {
      ledgerId: String(ledger._id),
      code: ledger.code,
      name: ledger.name,
      currentBalance: round2(ledger.cachedBalance),
      lastStatementDate: lastDone?.statementDate ?? null,
      lastReconciledAt: lastDone?.completedAt ?? null,
      openDraftId: draft ? String(draft._id) : null,
    };
  });
}

export async function listReconciliations(filters: {
  ledgerId?: string;
  status?: 'draft' | 'completed' | 'all';
} = {}): Promise<ReconciliationView[]> {
  const query: Record<string, unknown> = {};
  if (filters.ledgerId && Types.ObjectId.isValid(filters.ledgerId)) {
    query.ledgerId = new Types.ObjectId(filters.ledgerId);
  }
  if (filters.status && filters.status !== 'all') query.status = filters.status;

  const recs = await BankReconciliationModel.find(query)
    .sort({ statementDate: -1 })
    .limit(200)
    .exec();

  const ledgers = await LedgerModel.find({ _id: { $in: recs.map((r) => r.ledgerId) } })
    .select('_id code name')
    .lean()
    .exec();
  const byId = new Map(ledgers.map((l) => [String(l._id), l]));

  /*
   * A COMPLETED row reports the figures frozen at completion; only a draft is recomputed.
   *
   * A signed-off reconciliation whose numbers move the next time somebody back-dates an entry
   * into the period is not evidence of anything — and the reader would have no way of telling
   * that what they are looking at is no longer what was signed off.
   */
  return recs.map((rec) => {
    const ledger = byId.get(String(rec.ledgerId));
    const bookBalance = round2(rec.closedBookBalance ?? 0);
    const unclearedTotal = round2(rec.closedUnclearedTotal ?? 0);
    const expected = round2(bookBalance - unclearedTotal);

    return {
      id: String(rec._id),
      ledgerId: String(rec.ledgerId),
      ledgerCode: ledger?.code ?? '',
      ledgerName: ledger?.name ?? 'Unknown account',
      statementDate: rec.statementDate,
      statementClosingBalance: round2(rec.statementClosingBalance),
      status: rec.status,
      bookBalance,
      clearedTotal: round2(bookBalance - unclearedTotal),
      unclearedTotal,
      expectedStatementBalance: expected,
      difference: rec.status === 'completed' ? 0 : round2(rec.statementClosingBalance - expected),
      balances: rec.status === 'completed',
      clearedCount: rec.clearedLineIds.length,
      unclearedCount: 0,
      notes: rec.notes,
      completedAt: rec.completedAt,
      reopenReason: rec.reopenReason,
      createdAt: rec.createdAt,
    };
  });
}

export async function getReconciliation(id: string): Promise<ReconciliationDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Reconciliation not found');
  const rec = await BankReconciliationModel.findById(id).exec();
  if (!rec) throw notFound('Reconciliation not found');
  return buildDetail(rec);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface ReconciliationInput {
  ledgerId: string;
  statementDate: Date | string;
  statementClosingBalance: number;
  notes?: string;
}

export async function createReconciliation(
  input: ReconciliationInput,
  actorId?: string,
): Promise<ReconciliationDetail> {
  const ledger = await loadCashLedger(input.ledgerId);

  const statementDate = new Date(input.statementDate);
  if (Number.isNaN(statementDate.getTime())) throw badRequest('The statement date is not a date.');

  /*
   * Statements are worked in order, and going back behind a completed one is refused.
   *
   * Reconciling August after September has been signed off would tick off lines September has
   * already claimed, and September's frozen figures would no longer describe anything. Reopen
   * September first, which is a deliberate act that says so.
   */
  const laterDone = await BankReconciliationModel.findOne({
    ledgerId: ledger._id,
    status: 'completed',
    statementDate: { $gte: statementDate },
  })
    .select('statementDate')
    .lean()
    .exec();

  if (laterDone) {
    throw badRequest(
      `This account has already been reconciled up to `
        + `${laterDone.statementDate.toISOString().slice(0, 10)}. Reopen that reconciliation if `
        + 'you need to go back behind it.',
    );
  }

  const existing = await BankReconciliationModel.findOne({
    ledgerId: ledger._id,
    statementDate,
  })
    .select('_id')
    .lean()
    .exec();

  if (existing) {
    throw conflict(
      `There is already a reconciliation for ${ledger.name} dated `
        + `${statementDate.toISOString().slice(0, 10)}. Open that one instead of starting a second.`,
    );
  }

  const rec = await BankReconciliationModel.create({
    ledgerId: ledger._id,
    statementDate,
    statementClosingBalance: round2(input.statementClosingBalance),
    notes: input.notes?.trim() || undefined,
    status: 'draft',
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'bank_reconciliation',
    entityId: String(rec._id),
    action: 'created',
    meta: { account: ledger.name, statementBalance: round2(input.statementClosingBalance) },
  });

  return buildDetail(rec);
}

/** Correct the statement figure or the note on a draft. The date is fixed once it exists. */
export async function updateReconciliation(
  id: string,
  input: { statementClosingBalance?: number; notes?: string },
  actorId?: string,
): Promise<ReconciliationDetail> {
  const rec = await loadDraft(id);

  if (typeof input.statementClosingBalance === 'number') {
    rec.statementClosingBalance = round2(input.statementClosingBalance);
  }
  if (input.notes !== undefined) rec.notes = input.notes.trim() || undefined;
  rec.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await rec.save();

  return buildDetail(rec);
}

/**
 * Tick lines on, or back off again.
 *
 * Takes a set rather than one line at a time so that "tick everything the bank listed" is one
 * request — on a busy month that is a hundred lines, and a hundred round trips would make the
 * screen feel broken.
 */
export async function setClearedLines(
  id: string,
  lineIds: string[],
  cleared: boolean,
  actorId?: string,
): Promise<ReconciliationDetail> {
  const rec = await loadDraft(id);

  const ids = lineIds.map((lineId) => {
    if (!Types.ObjectId.isValid(lineId)) throw badRequest('That is not a posting line id.');
    return new Types.ObjectId(lineId);
  });

  if (cleared) {
    const valid = await JournalLineModel.countDocuments({
      _id: { $in: ids },
      ledgerId: rec.ledgerId,
      status: { $in: ['posted', 'reversed'] },
      date: { $lte: endOfDay(rec.statementDate) },
    }).exec();

    if (valid !== ids.length) {
      throw badRequest(
        'One of those lines is not on this account, or is dated after the statement. Only what '
          + 'the statement could have covered can be ticked off against it.',
      );
    }

    const claimed = await claimedLineIds(rec.ledgerId, { excludeId: id });
    const taken = ids.find((lineId) => claimed.has(String(lineId)));
    if (taken) {
      throw conflict(
        'One of those lines was already accounted for by an earlier statement, so ticking it '
          + 'here would count it twice.',
      );
    }

    const have = new Set(rec.clearedLineIds.map((x) => String(x)));
    for (const lineId of ids) {
      if (!have.has(String(lineId))) rec.clearedLineIds.push(lineId);
    }
  } else {
    const drop = new Set(ids.map((x) => String(x)));
    rec.clearedLineIds = rec.clearedLineIds.filter((x) => !drop.has(String(x)));
  }

  rec.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await rec.save();

  return buildDetail(rec);
}

/**
 * Sign the reconciliation off.
 *
 * Refuses unless the difference is nil. That refusal is the entire value of the screen: a
 * completed reconciliation is a statement that the bank agreed, and one that completes with a
 * gap still open says that falsely to everybody who reads it afterwards.
 *
 * Taken under a lock on the account so that two people finishing two statements at the same
 * moment cannot both claim the same deposit — each would balance alone, and between them they
 * would prove nothing.
 */
export async function completeReconciliation(
  id: string,
  actorId?: string,
): Promise<ReconciliationDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Reconciliation not found');

  const preview = await BankReconciliationModel.findById(id).select('ledgerId').lean().exec();
  if (!preview) throw notFound('Reconciliation not found');

  return withFinanceLocks(
    [`bank-rec:${String(preview.ledgerId)}`],
    async () => {
      const rec = await loadDraft(id);
      const detail = await buildDetail(rec);

      if (!detail.balances) {
        const over = detail.difference > 0;
        throw badRequest(
          `This does not balance yet. The bank says ${detail.statementClosingBalance.toFixed(2)} `
            + `and the books work out to ${detail.expectedStatementBalance.toFixed(2)} — a `
            + `difference of ${Math.abs(detail.difference).toFixed(2)} `
            + `${over ? 'that the bank has and the books do not' : 'that the books have and the bank does not'}. `
            + 'Either something on the statement has not been recorded yet, or a line here should '
            + 'be ticked. Record what is missing rather than signing this off with a gap.',
        );
      }

      // Re-checked inside the lock. The set could have been claimed between the worksheet being
      // built and this moment, which is precisely the race the lock is here for.
      const claimed = await claimedLineIds(rec.ledgerId, { excludeId: id });
      const taken = rec.clearedLineIds.find((lineId) => claimed.has(String(lineId)));
      if (taken) {
        throw conflict(
          'Another statement claimed one of these lines a moment ago. Reopen the worksheet and '
            + 'check what is left.',
        );
      }

      rec.status = 'completed';
      rec.closedBookBalance = detail.bookBalance;
      rec.closedUnclearedTotal = detail.unclearedTotal;
      rec.completedAt = new Date();
      rec.completedBy = actorId ? new Types.ObjectId(actorId) : undefined;
      rec.reopenReason = undefined;
      await rec.save();

      logActivityAsync({
        employeeId: actorId,
        module: 'bank_reconciliation',
        entityId: id,
        action: 'closed',
        meta: {
          account: detail.ledgerName,
          statementDate: detail.statementDate,
          statementBalance: detail.statementClosingBalance,
          stillInFlight: detail.unclearedTotal,
        },
      });

      return buildDetail(rec);
    },
    'Somebody else is finishing a reconciliation on this account. Try again in a moment.',
  );
}

/**
 * Reopen a completed reconciliation.
 *
 * Needs a reason, for the same purpose reversing an entry does: the record has been signed off,
 * and taking that back should say who did it and why. Refused when a later statement has been
 * completed on top of it — that one's figures were worked out from what this one left behind.
 */
export async function reopenReconciliation(
  id: string,
  reason: string,
  actorId?: string,
): Promise<ReconciliationDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Reconciliation not found');
  if (!reason?.trim()) throw badRequest('Say why this reconciliation is being reopened.');

  const rec = await BankReconciliationModel.findById(id).exec();
  if (!rec) throw notFound('Reconciliation not found');
  if (rec.status !== 'completed') throw badRequest('This reconciliation is not signed off yet.');

  const later = await BankReconciliationModel.findOne({
    ledgerId: rec.ledgerId,
    status: 'completed',
    statementDate: { $gt: rec.statementDate },
  })
    .select('statementDate')
    .lean()
    .exec();

  if (later) {
    throw badRequest(
      `The statement dated ${later.statementDate.toISOString().slice(0, 10)} was reconciled after `
        + 'this one and was worked out from what it left outstanding. Reopen that one first.',
    );
  }

  rec.status = 'draft';
  rec.reopenedAt = new Date();
  rec.reopenedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  rec.reopenReason = reason.trim();
  rec.closedBookBalance = undefined;
  rec.closedUnclearedTotal = undefined;
  await rec.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'bank_reconciliation',
    entityId: id,
    action: 'reopened',
    meta: { statementDate: rec.statementDate, reason: reason.trim() },
  });

  return buildDetail(rec);
}

export async function deleteReconciliation(
  id: string,
  actorId?: string,
): Promise<{ message: string }> {
  const rec = await loadDraft(id);
  await BankReconciliationModel.deleteOne({ _id: rec._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'bank_reconciliation',
    entityId: id,
    action: 'deleted',
    meta: { statementDate: rec.statementDate },
  });

  return { message: 'Reconciliation discarded' };
}

async function loadDraft(id: string): Promise<IBankReconciliation> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Reconciliation not found');

  const rec = await BankReconciliationModel.findById(id).exec();
  if (!rec) throw notFound('Reconciliation not found');

  if (rec.status !== 'draft') {
    throw badRequest(
      'This reconciliation has been signed off. Reopen it first if it genuinely needs changing.',
    );
  }

  return rec;
}
