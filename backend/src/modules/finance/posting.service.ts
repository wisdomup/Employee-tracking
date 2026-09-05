import { Types } from 'mongoose';
import { JournalEntryModel, IJournalEntry, JournalSourceType } from '../../models/journal-entry.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { allocateNextFinanceNo } from './finance-counters';
import { assertPostable } from './period.service';
import {
  JournalLineInput,
  MONEY_EPSILON,
  NormalisedLine,
  assertBalanced,
  normalBalanceFor,
  normaliseLines,
  periodKeyFor,
  round2,
} from './finance.rules';

/**
 * The ONLY code in this application permitted to write a `JournalLine` or move a ledger balance.
 *
 * The same single-writer rule `stock-ledger.service.ts` holds over stock, and for the same
 * reason: the moment a second writer exists, the nightly reconciliation stops being evidence of
 * anything.
 *
 * ## Why there is no transaction here
 *
 * `utils/mongo-session.ts` makes transactions opportunistic — production Atlas has them, dev
 * boxes and `mongodb-memory-server` do not, and the file carries a house rule against code that
 * only works inside one. So atomicity comes from idempotency instead:
 *
 *   1. Each line is inserted keyed on `idempotencyKey`, unique-indexed.
 *   2. The ledger balance moves ONLY when that insert was genuinely new.
 *   3. A replay collides on the index, skips the insert, and therefore skips the increment.
 *
 * That makes `postEntry` safe to call twice with the same key, which is what a retry, a
 * double-clicked button and a redelivered webhook all look like.
 */

export interface PostEntryInput {
  date: Date;
  lines: JournalLineInput[];
  narration?: string;
  referenceNo?: string;
  sourceType?: JournalSourceType;
  sourceId?: string;
  sourceModel?: string;
  /** Required for anything the system posts by itself. Absent for a manual entry. */
  idempotencyKey?: string;
  warehouseId?: string;
  cityKey?: string;
  attachments?: string[];
  /** Set when posting a reversal, so a closed period still accepts it. */
  isReversal?: boolean;
}

interface LedgerContext {
  _id: Types.ObjectId;
  code: string;
  name: string;
  isActive: boolean;
  isControl: boolean;
  subledgerType?: string | null;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
}

/**
 * Load and check every ledger the entry touches, in one round trip.
 *
 * `allowControl` is false for a manual entry. Letting a person hand-adjust receivables or
 * inventory is precisely how a control account stops agreeing with the module it mirrors, and
 * the resulting drift has no source document to trace it back to.
 */
async function loadLedgers(
  lines: readonly NormalisedLine[],
  allowControl: boolean,
): Promise<Map<string, LedgerContext>> {
  const ids = [...new Set(lines.map((l) => l.ledgerId))];
  if (ids.some((id) => !Types.ObjectId.isValid(id))) {
    throw badRequest('One of the lines names an account that does not exist.');
  }

  const ledgers = await LedgerModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select('_id code name isActive isControl subledgerType groupId')
    .lean()
    .exec();

  if (ledgers.length !== ids.length) {
    throw badRequest('One of the lines names an account that no longer exists.');
  }

  const groups = await AccountGroupModel.find({
    _id: { $in: ledgers.map((l) => l.groupId) },
  })
    .select('_id accountType')
    .lean()
    .exec();
  const typeByGroup = new Map(groups.map((g) => [String(g._id), g.accountType]));

  const out = new Map<string, LedgerContext>();

  for (const ledger of ledgers) {
    const accountType = typeByGroup.get(String(ledger.groupId));
    if (!accountType) {
      throw badRequest(
        `"${ledger.name}" sits in a group that no longer exists, so nothing can be posted to it.`,
      );
    }

    if (!ledger.isActive) {
      throw badRequest(`"${ledger.code} ${ledger.name}" is deactivated and cannot be posted to.`);
    }

    if (ledger.isControl && !allowControl) {
      throw badRequest(
        `"${ledger.code} ${ledger.name}" is a control account. It is posted to by the module it `
          + 'summarises, never by hand — a manual adjustment here is what makes it stop agreeing.',
      );
    }

    out.set(String(ledger._id), {
      _id: ledger._id,
      code: ledger.code,
      name: ledger.name,
      isActive: ledger.isActive,
      isControl: ledger.isControl,
      subledgerType: ledger.subledgerType ?? null,
      accountType: accountType as LedgerContext['accountType'],
    });
  }

  return out;
}

/** A control line must carry a matching subledger; a plain line must not carry one at all. */
function assertSubledgerRefs(
  lines: readonly NormalisedLine[],
  ledgers: Map<string, LedgerContext>,
): void {
  lines.forEach((line, index) => {
    const ledger = ledgers.get(line.ledgerId)!;
    const at = `Line ${index + 1} (${ledger.code} ${ledger.name})`;

    if (ledger.isControl) {
      if (!line.subledgerRef) {
        throw badRequest(`${at}: say which ${ledger.subledgerType} this is for.`);
      }
      if (line.subledgerRef.type !== ledger.subledgerType) {
        throw badRequest(
          `${at}: expected a ${ledger.subledgerType}, got a ${line.subledgerRef.type}.`,
        );
      }
      if (!Types.ObjectId.isValid(line.subledgerRef.id)) {
        throw badRequest(`${at}: the ${ledger.subledgerType} reference is not valid.`);
      }
    } else if (line.subledgerRef) {
      throw badRequest(`${at}: this is not a control account, so it takes no subledger.`);
    }
  });
}

/**
 * Apply one line and move its ledger balance, exactly once.
 *
 * Returns false when the line was already applied by an earlier attempt. The caller must not
 * increment anything in that case — that skipped increment IS the idempotency.
 */
async function applyLine(
  line: NormalisedLine,
  entry: IJournalEntry,
  lineIndex: number,
  ledger: LedgerContext,
): Promise<boolean> {
  const key = entry.idempotencyKey
    ? `${entry.idempotencyKey}:${lineIndex}`
    : `entry:${String(entry._id)}:${lineIndex}`;

  const existing = await JournalLineModel.findOne({ idempotencyKey: key }).select('_id').lean().exec();
  if (existing) return false;

  // Move the balance FIRST, then record the line with the balance it produced.
  //
  // The other order looks safer but is not: a crash between the two would leave a line claiming
  // a balance the ledger never reached. This order can only leave a moved balance with no line,
  // which the reconciler detects and reports — a discrepancy that announces itself beats one
  // that reads as correct.
  const delta = normalBalanceFor(ledger.accountType) === 'debit'
    ? line.signedAmount
    : round2(-line.signedAmount);

  const updated = await LedgerModel.findByIdAndUpdate(
    ledger._id,
    {
      $inc: {
        cachedBalance: delta,
        cachedDebitTotal: line.debit,
        cachedCreditTotal: line.credit,
      },
    },
    { new: true, projection: { cachedBalance: 1 } },
  ).lean().exec();

  try {
    await JournalLineModel.create({
      journalEntryId: entry._id,
      ledgerId: ledger._id,
      debit: line.debit,
      credit: line.credit,
      signedAmount: line.signedAmount,
      balanceAfter: updated ? round2(updated.cachedBalance) : undefined,
      subledgerRef: line.subledgerRef
        ? { type: line.subledgerRef.type, id: new Types.ObjectId(line.subledgerRef.id) }
        : null,
      date: entry.date,
      postingPeriod: entry.postingPeriod,
      status: 'posted',
      warehouseId: entry.warehouseId,
      cityKey: entry.cityKey,
      lineNarration: line.lineNarration,
      idempotencyKey: key,
    });
  } catch (err: any) {
    // Two requests raced and the other won the unique index. Undo the increment this attempt
    // made, because the winner has already made its own.
    if (err?.code === 11000) {
      await LedgerModel.findByIdAndUpdate(ledger._id, {
        $inc: {
          cachedBalance: -delta,
          cachedDebitTotal: -line.debit,
          cachedCreditTotal: -line.credit,
        },
      }).exec();
      return false;
    }
    throw err;
  }

  return true;
}

/**
 * Post an entry: validate, write the lines, move the balances, stamp the header.
 *
 * Safe to call twice with the same `idempotencyKey` — the second call finds the entry already
 * posted and returns it untouched.
 */
export async function postEntry(
  input: PostEntryInput,
  actorId?: string,
): Promise<IJournalEntry> {
  const isSystem = Boolean(input.idempotencyKey);

  if (input.idempotencyKey) {
    const existing = await JournalEntryModel.findOne({
      idempotencyKey: input.idempotencyKey,
    }).exec();
    if (existing && existing.status !== 'draft') return existing;
  }

  const lines = normaliseLines(input.lines);
  const totals = assertBalanced(lines);

  // A system posting resolves control accounts by design; a person may not touch them.
  const ledgers = await loadLedgers(lines, isSystem);
  assertSubledgerRefs(lines, ledgers);

  const postingPeriod = await assertPostable(input.date, { isReversal: input.isReversal });

  const entry = await JournalEntryModel.create({
    date: input.date,
    postingPeriod,
    referenceNo: input.referenceNo,
    narration: input.narration,
    sourceType: input.sourceType ?? 'manual',
    sourceId: input.sourceId ? new Types.ObjectId(input.sourceId) : undefined,
    sourceModel: input.sourceModel,
    status: 'draft',
    isSystemGenerated: isSystem,
    totalDebit: totals.totalDebit,
    totalCredit: totals.totalCredit,
    idempotencyKey: input.idempotencyKey,
    warehouseId: input.warehouseId ? new Types.ObjectId(input.warehouseId) : undefined,
    cityKey: input.cityKey,
    attachments: input.attachments ?? [],
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  return finishPosting(entry, lines, ledgers, actorId);
}

/**
 * Move a draft to posted.
 *
 * Split out from `postEntry` because a manual entry is written, reviewed and only then posted —
 * often by a different person, which is the point of separating the two matrix cells.
 */
export async function postDraft(entryId: string, actorId?: string): Promise<IJournalEntry> {
  const entry = await JournalEntryModel.findById(entryId).exec();
  if (!entry) throw notFound('Entry not found');
  if (entry.status === 'posted') return entry;
  if (entry.status !== 'draft') {
    throw badRequest(`This entry is ${entry.status} and cannot be posted.`);
  }

  const rawLines = await JournalLineModel.find({ journalEntryId: entry._id }).lean().exec();
  if (rawLines.length > 0) {
    // Lines already exist, so a previous attempt got past step 2 and died before step 3.
    // Completing it is the whole reason `postDraft` is re-runnable.
    return finishPosting(entry, [], new Map(), actorId, { linesAlreadyWritten: true });
  }

  if (!Array.isArray(entry.draftLines) || entry.draftLines.length === 0) {
    throw badRequest('This entry has no lines to post.');
  }

  const lines = normaliseLines(
    entry.draftLines.map((l) => ({
      ledgerId: String(l.ledgerId),
      debit: l.debit,
      credit: l.credit,
      lineNarration: l.lineNarration,
      subledgerRef: l.subledgerRef
        ? { type: l.subledgerRef.type, id: String(l.subledgerRef.id) }
        : null,
    })),
  );
  const totals = assertBalanced(lines);
  const ledgers = await loadLedgers(lines, entry.isSystemGenerated);
  assertSubledgerRefs(lines, ledgers);

  await assertPostable(entry.date, { isReversal: Boolean(entry.reversalOf) });

  entry.totalDebit = totals.totalDebit;
  entry.totalCredit = totals.totalCredit;

  return finishPosting(entry, lines, ledgers, actorId);
}

/** Steps 2 and 3 of the posting sequence, shared by both entry points. */
async function finishPosting(
  entry: IJournalEntry,
  lines: readonly NormalisedLine[],
  ledgers: Map<string, LedgerContext>,
  actorId?: string,
  options: { linesAlreadyWritten?: boolean } = {},
): Promise<IJournalEntry> {
  if (!options.linesAlreadyWritten) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      await applyLine(line, entry, i, ledgers.get(line.ledgerId)!);
    }
  }

  if (!entry.entryNo) {
    // Allocated here, after the lines are down, so an entry that failed validation never burns
    // a voucher number an auditor will later ask about.
    entry.entryNo = await allocateNextFinanceNo('financeJournalNo');
  }
  entry.status = 'posted';
  entry.postedAt = new Date();
  entry.postedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  // Cleared so a posted entry has exactly one representation of its lines. Two would eventually
  // disagree, and the disagreement would surface as a balance nobody could explain.
  entry.draftLines = undefined;
  await entry.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'journal_entry',
    entityId: String(entry._id),
    action: 'posted',
    meta: {
      entryNo: entry.entryNo,
      sourceType: entry.sourceType,
      totalDebit: entry.totalDebit,
      period: entry.postingPeriod,
    },
  });

  return entry;
}

/**
 * Reverse a posted entry.
 *
 * Creates a NEW entry with every debit and credit swapped. Neither document is otherwise
 * altered — that is the whole point.
 */
export async function reverseEntry(
  entryId: string,
  options: { reason: string; date?: Date },
  actorId?: string,
): Promise<{ original: IJournalEntry; reversal: IJournalEntry }> {
  if (!options.reason?.trim()) {
    throw badRequest('Say why this entry is being reversed.');
  }

  const original = await JournalEntryModel.findById(entryId).exec();
  if (!original) throw notFound('Entry not found');
  if (original.status === 'draft') {
    throw badRequest('This entry has not been posted. Delete the draft instead of reversing it.');
  }
  if (original.status === 'reversed') {
    throw conflict('This entry has already been reversed.');
  }

  const lines = await JournalLineModel.find({
    journalEntryId: original._id,
    status: 'posted',
  }).lean().exec();

  if (lines.length === 0) {
    throw badRequest('This entry has no posted lines, so there is nothing to reverse.');
  }

  // Today by default, NOT the original's date. Reversing into a prior month restates a period
  // that has already been reported, and doing that silently is how a signed-off figure changes
  // under someone.
  const date = options.date ?? new Date();

  const swapped: JournalLineInput[] = lines.map((l) => ({
    ledgerId: String(l.ledgerId),
    debit: l.credit,
    credit: l.debit,
    lineNarration: l.lineNarration,
    subledgerRef: l.subledgerRef
      ? { type: l.subledgerRef.type, id: String(l.subledgerRef.id) }
      : null,
  }));

  const reversal = await postEntry(
    {
      date,
      lines: swapped,
      narration: `Reversal of #${original.entryNo ?? original._id}: ${options.reason.trim()}`,
      referenceNo: original.referenceNo,
      sourceType: original.sourceType,
      sourceId: original.sourceId ? String(original.sourceId) : undefined,
      sourceModel: original.sourceModel,
      idempotencyKey: original.idempotencyKey
        ? `${original.idempotencyKey}:reversal`
        : undefined,
      warehouseId: original.warehouseId ? String(original.warehouseId) : undefined,
      cityKey: original.cityKey,
      isReversal: true,
    },
    actorId,
  );

  reversal.reversalOf = original._id;
  await reversal.save();

  original.status = 'reversed';
  original.reversedByEntryId = reversal._id;
  original.reversedAt = new Date();
  original.reversedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  original.reversalReason = options.reason.trim();
  await original.save();

  // The original's lines stay in place and keep their amounts. Marking them `reversed` lets a
  // report show the pair without recomputing, while the reversal's own lines carry the offset.
  await JournalLineModel.updateMany(
    { journalEntryId: original._id },
    { $set: { status: 'reversed' } },
  ).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'journal_entry',
    entityId: String(original._id),
    action: 'reversed',
    meta: {
      entryNo: original.entryNo,
      reversalEntryNo: reversal.entryNo,
      reason: options.reason.trim(),
    },
  });

  return { original, reversal };
}

/**
 * Complete any posting interrupted between writing its lines and stamping its header.
 *
 * The one gap the transaction-free design leaves. Because `JournalLine.status` is written as
 * `posted` at insert, the balances and every report are already correct — but the Day Book reads
 * headers, so the entry would be missing from it. Run at boot and hourly.
 */
export async function completeInterruptedPostings(): Promise<{ completed: number }> {
  const drafts = await JournalEntryModel.find({ status: 'draft' })
    .select('_id entryNo date postingPeriod')
    .lean()
    .exec();

  let completed = 0;

  for (const draft of drafts) {
    const lineCount = await JournalLineModel.countDocuments({
      journalEntryId: draft._id,
      status: 'posted',
    }).exec();
    if (lineCount === 0) continue;

    const entry = await JournalEntryModel.findById(draft._id).exec();
    if (!entry || entry.status !== 'draft') continue;

    if (!entry.entryNo) entry.entryNo = await allocateNextFinanceNo('financeJournalNo');
    entry.status = 'posted';
    entry.postedAt = entry.postedAt ?? new Date();
    await entry.save();
    completed += 1;
  }

  return { completed };
}

/**
 * Prove every ledger's cached balance against the lines it came from.
 *
 * The `reconcile-stock-mirror.ts` analogue. `repair` rewrites the cache from the lines, which
 * are the truth; without it the job reports drift it cannot fix.
 */
export async function reconcileLedgerBalances(
  options: { repair?: boolean } = {},
): Promise<{ checked: number; drifted: { code: string; name: string; drift: number }[] }> {
  const ledgers = await LedgerModel.find()
    .select('_id code name cachedBalance cachedDebitTotal cachedCreditTotal groupId openingBalance')
    .lean()
    .exec();

  const groups = await AccountGroupModel.find().select('_id accountType').lean().exec();
  const typeByGroup = new Map(groups.map((g) => [String(g._id), g.accountType]));

  const sums = await JournalLineModel.aggregate<{
    _id: Types.ObjectId;
    debit: number;
    credit: number;
  }>([
    { $match: { status: { $in: ['posted', 'reversed'] } } },
    { $group: { _id: '$ledgerId', debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
  ]).exec();

  const sumById = new Map(sums.map((s) => [String(s._id), s]));
  const drifted: { code: string; name: string; drift: number }[] = [];
  const now = new Date();

  for (const ledger of ledgers) {
    const accountType = typeByGroup.get(String(ledger.groupId));
    if (!accountType) continue;

    const sum = sumById.get(String(ledger._id));
    const debit = round2(sum?.debit ?? 0);
    const credit = round2(sum?.credit ?? 0);
    const net = round2(debit - credit);
    const expected = round2(
      normalBalanceFor(accountType as never) === 'debit' ? net : -net,
    );

    const drift = round2(ledger.cachedBalance - expected);

    if (Math.abs(drift) >= MONEY_EPSILON) {
      drifted.push({ code: ledger.code, name: ledger.name, drift });
      if (options.repair) {
        await LedgerModel.findByIdAndUpdate(ledger._id, {
          $set: {
            cachedBalance: expected,
            cachedDebitTotal: debit,
            cachedCreditTotal: credit,
            lastReconciledAt: now,
            lastReconcileDrift: drift,
          },
        }).exec();
        continue;
      }
    }

    await LedgerModel.findByIdAndUpdate(ledger._id, {
      $set: { lastReconciledAt: now, lastReconcileDrift: drift },
    }).exec();
  }

  return { checked: ledgers.length, drifted };
}

/** Recalculate one ledger from its lines. The manual button on the account page. */
export async function recalculateLedger(ledgerId: string): Promise<{ balance: number; drift: number }> {
  const ledger = await LedgerModel.findById(ledgerId).select('groupId cachedBalance').lean().exec();
  if (!ledger) throw notFound('Ledger not found');

  const group = await AccountGroupModel.findById(ledger.groupId).select('accountType').lean().exec();
  if (!group) throw notFound('This account sits in a group that no longer exists');

  const sums = await JournalLineModel.aggregate<{ debit: number; credit: number }>([
    { $match: { ledgerId: new Types.ObjectId(ledgerId), status: { $in: ['posted', 'reversed'] } } },
    { $group: { _id: null, debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
  ]).exec();

  const debit = round2(sums[0]?.debit ?? 0);
  const credit = round2(sums[0]?.credit ?? 0);
  const net = round2(debit - credit);
  const expected = round2(normalBalanceFor(group.accountType as never) === 'debit' ? net : -net);
  const drift = round2(ledger.cachedBalance - expected);

  await LedgerModel.findByIdAndUpdate(ledgerId, {
    $set: {
      cachedBalance: expected,
      cachedDebitTotal: debit,
      cachedCreditTotal: credit,
      lastReconciledAt: new Date(),
      lastReconcileDrift: drift,
    },
  }).exec();

  return { balance: expected, drift };
}

/** Resolve a named engine role to its ledger id. Used by every auto-posting rule in later steps. */
export async function ledgerIdForRole(role: string): Promise<string> {
  const { FinanceSettingsModel } = await import('../../models/finance-settings.model');
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('ledgerMap')
    .lean()
    .exec();

  const map = settings?.ledgerMap as unknown as Record<string, Types.ObjectId> | undefined;
  const id = map?.[role];
  if (!id) {
    throw badRequest(
      `No account is set for "${role}". Fix the accounting roles in Finance settings before posting.`,
    );
  }
  return String(id);
}

export { periodKeyFor };
