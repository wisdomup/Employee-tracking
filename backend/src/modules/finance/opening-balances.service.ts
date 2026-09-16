import { Types } from 'mongoose';
import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { VendorModel } from '../../models/vendor.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { round2, MONEY_EPSILON } from './finance.rules';
import { postEntry, reverseEntry, ledgerIdForRole, NOT_A_REVERSAL } from './posting.service';
import { withFinanceLocks } from './finance-locks';

/**
 * The changeover: what the business owned and owed on the day the books went live.
 *
 * ## Why this is the last step and not the first
 *
 * Everything before it could be built, deployed and left switched off. This one cannot be undone
 * quietly — it is the moment the accounts stop being empty — so it waits until every other part
 * has been proved against something.
 *
 * ## The trap this whole file is arranged around
 *
 * `Ledger.openingBalance` is a field that has existed since the chart was built, and only ONE
 * report reads it: the ledger statement, which adds it to the running balance. The trial balance,
 * the cached balances, the Profit & Loss, the Balance Sheet and every nightly control check all
 * ignore it and count posted lines alone.
 *
 * So a figure left in that field after a real opening entry is posted would be counted twice on
 * one screen and once on every other, and the two would disagree for ever with nothing to say
 * why. This service therefore treats the field as somewhere to TYPE, never as a balance: the
 * worksheet stages figures there, posting turns them into a real dated entry, and the field is
 * cleared in the same breath.
 *
 * ## Opening Balance Equity, and how the migration proves itself
 *
 * Every opening figure is posted against `3900 Opening Balance Equity`, which therefore ends up
 * holding the net worth of the business at changeover. Moving that balance to the owner's capital
 * is a second, deliberate act — and once it is done 3900 reads zero.
 *
 * That zero is the whole proof. It is not a formality: while 3900 holds anything at all, either
 * the opening figures are incomplete or nobody has decided whose money it is.
 */

// ---------------------------------------------------------------------------
// Where the migration has got to
// ---------------------------------------------------------------------------

export type MigrationStage = 'not-started' | 'balances-entered' | 'complete';

export interface MigrationStatus {
  stage: MigrationStage;
  booksOpenedAt: Date | null;
  cutoverDate: Date | null;
  openingEntryId: string | null;
  openingEntryNo: number | null;
  /** While this is not zero, the changeover is unfinished — see the note at the top. */
  openingEquityBalance: number;
  openingEquityCode: string;
  closingEntryId: string | null;
}

async function settingsDoc() {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).exec();
  if (!settings) throw badRequest('Finance settings are missing. Restart the API to seed them.');
  return settings;
}

const OPENING_REF = 'OPENING';
const EQUITY_CLOSE_REF = 'OPENING-EQUITY-CLOSE';

/**
 * Find a live changeover entry.
 *
 * `reversalOf: null` is doing real work here. A reversal COPIES the entry it undoes — same
 * `sourceType`, same `referenceNo` — and is itself `posted`. Without this clause a reopened
 * changeover would find its own reversal and report the books as still open, which is the exact
 * opposite of what happened. (A `null` match also covers the field being absent.)
 */
async function liveEntry(referenceNo: string) {
  return JournalEntryModel.findOne({
    sourceType: 'opening_balance',
    status: 'posted',
    referenceNo,
    ...NOT_A_REVERSAL,
  })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
}

const liveOpeningEntry = () => liveEntry(OPENING_REF);
const liveClosingEntry = () => liveEntry(EQUITY_CLOSE_REF);

/**
 * Count real activity either side of the changeover, ignoring anything that has been undone.
 *
 * `reversalOf: null` and `status: 'posted'` between them drop both halves of a reversed pair: the
 * original is marked `reversed`, and the entry that undid it is a reversal. A pair nets to
 * nothing, so it must not stand in the way — otherwise correcting a mistake would permanently
 * block the very thing the correction was for.
 *
 * The changeover's own entries are excluded by source, so they never count as activity against
 * themselves.
 */
async function liveEntriesOutside(
  range: { before?: Date; after?: Date },
): Promise<number> {
  const query: Record<string, unknown> = {
    status: 'posted',
    ...NOT_A_REVERSAL,
    sourceType: { $ne: 'opening_balance' },
  };

  if (range.before) query.date = { $lte: range.before };
  if (range.after) query.date = { $gt: range.after };

  return JournalEntryModel.countDocuments(query).exec();
}

/**
 * A key that changes on every attempt.
 *
 * It has to be present at all — a keyless posting is treated as hand-made and refuses control
 * accounts, and payables are one. But it must not be the SAME key each time: after a reopen the
 * previous entry still exists as `reversed`, and `postEntry` would find it by key and hand it
 * straight back rather than posting the corrected figures. Counting what has been attempted so
 * far moves the key on; the lock around the caller covers the double-click.
 */
async function attemptKey(suffix: string): Promise<string> {
  const attempts = await JournalEntryModel.countDocuments({ sourceType: 'opening_balance' }).exec();
  return `finance:opening_balance:${suffix}:${attempts}`;
}

export async function migrationStatus(): Promise<MigrationStatus> {
  const settings = await settingsDoc();

  const equityId = await ledgerIdForRole('openingEquity');
  const equity = await LedgerModel.findById(equityId).select('code cachedBalance').lean().exec();

  const [opening, closing] = await Promise.all([liveOpeningEntry(), liveClosingEntry()]);

  const balance = round2(equity?.cachedBalance ?? 0);

  let stage: MigrationStage = 'not-started';
  if (opening) stage = Math.abs(balance) < MONEY_EPSILON ? 'complete' : 'balances-entered';

  return {
    stage,
    booksOpenedAt: settings.booksOpenedAt ?? null,
    cutoverDate: settings.cutoverDate ?? null,
    openingEntryId: opening ? String(opening._id) : null,
    openingEntryNo: opening?.entryNo ?? null,
    openingEquityBalance: balance,
    openingEquityCode: equity?.code ?? '3900',
    closingEntryId: closing ? String(closing._id) : null,
  };
}

// ---------------------------------------------------------------------------
// The worksheet
// ---------------------------------------------------------------------------

export interface WorksheetRow {
  ledgerId: string;
  code: string;
  name: string;
  groupName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  isDebitNatured: boolean;
  /** Positive means the account's own direction: an asset held, a liability owed. */
  amount: number;
  editable: boolean;
  /** Why it cannot be typed here, or where the figure comes from instead. */
  note?: string;
}

export interface Worksheet {
  status: MigrationStatus;
  rows: WorksheetRow[];
  totalDebits: number;
  totalCredits: number;
  /** What Opening Balance Equity would absorb — the business's net worth at changeover. */
  openingEquity: number;
}

interface LedgerRow {
  _id: Types.ObjectId;
  code: string;
  name: string;
  groupId: Types.ObjectId;
  isControl: boolean;
  subledgerType?: string | null;
  openingBalance?: { amount: number; asOf: Date | null };
}

function isDebitNatured(accountType: string): boolean {
  return accountType === 'asset' || accountType === 'expense';
}

/**
 * Which control accounts a person may type an opening figure into.
 *
 * Only payables, and even then not by hand — it is built from the suppliers' own opening figures,
 * because a control account's posting has to name which supplier it belongs to.
 *
 * The others are refused on purpose. Receivables, inventory and rider cash are all built by the
 * modules that own them out of records the business already keeps, and a nightly check proves
 * each one against that module. An opening figure typed on top would be counted twice and the
 * check would go red the following morning with nothing to explain it.
 */
const CONTROL_NOTE: Record<string, string> = {
  dealer:
    'Built from the shop credit records the business already keeps. Typing an opening figure here '
    + 'would double what the shops owe.',
  warehouse:
    'Built from the warehouse stock the business already counts. Typing an opening figure here '
    + 'would double the value of the stock.',
  rider:
    'Built from the collection and settlement records. Typing an opening figure here would double '
    + 'what the riders are carrying.',
  employee:
    'Built from the staff advance records, which carry their own opening figures.',
};

async function loadLedgers(): Promise<{ rows: LedgerRow[]; typeById: Map<string, string>; groupNameById: Map<string, string> }> {
  const rows = await LedgerModel.find({ isActive: true })
    .select('_id code name groupId isControl subledgerType openingBalance')
    .sort({ code: 1 })
    .lean()
    .exec();

  const groups = await AccountGroupModel.find({ _id: { $in: rows.map((r) => r.groupId) } })
    .select('_id name accountType')
    .lean()
    .exec();

  return {
    rows: rows as unknown as LedgerRow[],
    typeById: new Map(groups.map((g) => [String(g._id), g.accountType])),
    groupNameById: new Map(groups.map((g) => [String(g._id), g.name])),
  };
}

/** What the suppliers between them say was owed at changeover. */
async function vendorOpeningTotal(): Promise<number> {
  const rows = await VendorModel.aggregate<{ total: number }>([
    { $match: { isPlaceholder: { $ne: true } } },
    { $group: { _id: null, total: { $sum: '$openingBalance.amount' } } },
  ]).exec();
  return round2(rows[0]?.total ?? 0);
}

export async function worksheet(): Promise<Worksheet> {
  const [status, { rows, typeById, groupNameById }, apTradeId, equityId, vendorTotal] =
    await Promise.all([
      migrationStatus(),
      loadLedgers(),
      ledgerIdForRole('apTrade'),
      ledgerIdForRole('openingEquity'),
      vendorOpeningTotal(),
    ]);

  let totalDebits = 0;
  let totalCredits = 0;

  const worksheetRows: WorksheetRow[] = rows.map((ledger) => {
    const accountType = (typeById.get(String(ledger.groupId)) ?? 'asset') as WorksheetRow['accountType'];
    const debitNatured = isDebitNatured(accountType);
    const isAp = String(ledger._id) === apTradeId;
    const isEquityBucket = String(ledger._id) === equityId;

    let amount = round2(ledger.openingBalance?.amount ?? 0);
    let editable = true;
    let note: string | undefined;

    if (isEquityBucket) {
      // It is the balancing figure, not something anybody types. Working it out by hand and
      // typing it in would mean an entry that balanced only because two errors cancelled.
      amount = 0;
      editable = false;
      note = 'Worked out automatically — this is what the other figures leave over.';
    } else if (isAp) {
      amount = vendorTotal;
      editable = false;
      note = "Taken from each supplier's own opening figure, so the total can be broken down by "
        + 'supplier. Edit it on the supplier, not here.';
    } else if (ledger.isControl) {
      amount = 0;
      editable = false;
      note = CONTROL_NOTE[ledger.subledgerType ?? ''] ?? 'Built by the module that owns it.';
    }

    if (amount !== 0) {
      const asDebit = debitNatured ? amount > 0 : amount < 0;
      if (asDebit) totalDebits = round2(totalDebits + Math.abs(amount));
      else totalCredits = round2(totalCredits + Math.abs(amount));
    }

    return {
      ledgerId: String(ledger._id),
      code: ledger.code,
      name: ledger.name,
      groupName: groupNameById.get(String(ledger.groupId)) ?? '',
      accountType,
      isDebitNatured: debitNatured,
      amount,
      editable: editable && status.stage === 'not-started',
      note,
    };
  });

  return {
    status,
    rows: worksheetRows,
    totalDebits,
    totalCredits,
    openingEquity: round2(totalDebits - totalCredits),
  };
}

/**
 * Stage figures on the worksheet. Writes nothing to the accounts.
 *
 * Kept in `Ledger.openingBalance` because that field already exists and the chart screen already
 * edits it — and because posting clears it, which is what stops the ledger statement counting it
 * a second time afterwards.
 */
export async function saveWorksheet(
  entries: { ledgerId: string; amount: number }[],
  actorId?: string,
): Promise<Worksheet> {
  const status = await migrationStatus();
  if (status.stage !== 'not-started') {
    throw badRequest(
      'The opening balances have already been posted. Reopen the changeover if they need to '
        + 'change, so the entry that was posted is reversed rather than left behind.',
    );
  }

  const apTradeId = await ledgerIdForRole('apTrade');
  const equityId = await ledgerIdForRole('openingEquity');

  const ids = entries.map((e) => {
    if (!Types.ObjectId.isValid(e.ledgerId)) throw badRequest('That is not an account id.');
    return new Types.ObjectId(e.ledgerId);
  });

  const ledgers = await LedgerModel.find({ _id: { $in: ids } })
    .select('_id code name isControl subledgerType')
    .lean()
    .exec();
  const byId = new Map(ledgers.map((l) => [String(l._id), l]));

  for (const entry of entries) {
    const ledger = byId.get(entry.ledgerId);
    if (!ledger) throw badRequest('One of those accounts no longer exists.');

    if (entry.ledgerId === equityId) {
      throw badRequest(
        `"${ledger.code} ${ledger.name}" is the balancing figure and is worked out from `
          + 'everything else. Entering it by hand would make the entry balance even when the '
          + 'figures behind it do not.',
      );
    }

    if (entry.ledgerId === apTradeId) {
      throw badRequest(
        `"${ledger.code} ${ledger.name}" is built from each supplier's own opening figure, so `
          + 'that what is owed can be broken down by supplier. Set it on the supplier instead.',
      );
    }

    if (ledger.isControl) {
      throw badRequest(
        `"${ledger.code} ${ledger.name}" is kept by the module that owns it. `
          + (CONTROL_NOTE[ledger.subledgerType ?? ''] ?? 'It cannot take a typed opening figure.'),
      );
    }
  }

  for (const entry of entries) {
    await LedgerModel.updateOne(
      { _id: new Types.ObjectId(entry.ledgerId) },
      { $set: { 'openingBalance.amount': round2(entry.amount) } },
    ).exec();
  }

  logActivityAsync({
    employeeId: actorId,
    module: 'opening_balance',
    entityId: 'worksheet',
    action: 'updated',
    meta: { accounts: entries.length },
  });

  return worksheet();
}

// ---------------------------------------------------------------------------
// Posting the changeover
// ---------------------------------------------------------------------------

export interface OpeningEntryResult {
  entryId: string;
  entryNo?: number;
  totalDebit: number;
  totalCredit: number;
  openingEquity: number;
  status: MigrationStatus;
}

/**
 * Turn the worksheet into the one entry that opens the books.
 *
 * Refuses when anything is already recorded on or before the changeover date. An opening balance
 * says "this is everything that existed at this moment"; if transactions from before it have
 * already been posted, the two describe the same money and everything would be counted twice.
 */
export async function postOpeningEntry(
  input: { cutoverDate: Date | string; narration?: string },
  actorId?: string,
): Promise<OpeningEntryResult> {
  // The key moves on every attempt, so it cannot stop a double-click on its own. This can.
  return withFinanceLocks(
    ['finance:opening-balance'],
    () => doPostOpeningEntry(input, actorId),
    'The books are being opened right now. Give it a moment.',
  );
}

async function doPostOpeningEntry(
  input: { cutoverDate: Date | string; narration?: string },
  actorId?: string,
): Promise<OpeningEntryResult> {
  const status = await migrationStatus();
  if (status.stage !== 'not-started') {
    throw conflict('The books have already been opened.');
  }

  const cutoverDate = new Date(input.cutoverDate);
  if (Number.isNaN(cutoverDate.getTime())) throw badRequest('The changeover date is not a date.');

  const endOfCutover = new Date(cutoverDate);
  endOfCutover.setHours(23, 59, 59, 999);

  const earlier = await liveEntriesOutside({ before: endOfCutover });

  if (earlier > 0) {
    throw badRequest(
      `${earlier} posting${earlier === 1 ? ' is' : 's are'} already recorded on or before `
        + `${cutoverDate.toISOString().slice(0, 10)}. An opening balance says what existed at that `
        + 'moment, so posting one on top of transactions from before it would count the same '
        + 'money twice. Choose a changeover date before anything was recorded.',
    );
  }

  const sheet = await worksheet();
  const lines: {
    ledgerId: string;
    debit?: number;
    credit?: number;
    lineNarration?: string;
    subledgerRef?: { type: string; id: string } | null;
  }[] = [];

  const apTradeId = await ledgerIdForRole('apTrade');
  const equityId = await ledgerIdForRole('openingEquity');

  for (const row of sheet.rows) {
    if (row.ledgerId === apTradeId || row.ledgerId === equityId) continue;
    if (Math.abs(row.amount) < MONEY_EPSILON) continue;

    const asDebit = row.isDebitNatured ? row.amount > 0 : row.amount < 0;
    lines.push({
      ledgerId: row.ledgerId,
      ...(asDebit ? { debit: Math.abs(row.amount) } : { credit: Math.abs(row.amount) }),
      lineNarration: 'Opening balance',
    });
  }

  // Payables, one line per supplier, so the control account can be broken down from day one.
  const vendors = await VendorModel.find({
    isPlaceholder: { $ne: true },
    'openingBalance.amount': { $ne: 0 },
  })
    .select('_id name openingBalance')
    .lean()
    .exec();

  for (const vendor of vendors) {
    const amount = round2(vendor.openingBalance?.amount ?? 0);
    if (Math.abs(amount) < MONEY_EPSILON) continue;

    lines.push({
      ledgerId: apTradeId,
      ...(amount > 0 ? { credit: amount } : { debit: Math.abs(amount) }),
      lineNarration: `Opening balance — ${vendor.name}`,
      subledgerRef: { type: 'vendor', id: String(vendor._id) },
    });
  }

  if (lines.length === 0) {
    throw badRequest(
      'Every figure on the worksheet is zero, so there is nothing to open the books with.',
    );
  }

  /*
   * Opening Balance Equity takes up whatever is left over, and that is the correct treatment
   * rather than a fudge: at changeover the difference between what the business owns and what it
   * owes IS the owner's stake. Naming it here, in an account that must later read zero, is what
   * makes an incomplete migration visible instead of silent.
   */
  const debitTotal = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0));
  const creditTotal = round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0));
  const equityAmount = round2(debitTotal - creditTotal);

  if (Math.abs(equityAmount) >= MONEY_EPSILON) {
    lines.push({
      ledgerId: equityId,
      ...(equityAmount > 0 ? { credit: equityAmount } : { debit: Math.abs(equityAmount) }),
      lineNarration: 'Net worth at changeover',
    });
  }

  const entry = await postEntry(
    {
      date: cutoverDate,
      narration: input.narration?.trim() || 'Opening balances at changeover',
      referenceNo: OPENING_REF,
      sourceType: 'opening_balance',
      idempotencyKey: await attemptKey('changeover'),
      lines,
    },
    actorId,
  );

  /*
   * Cleared in the same breath as posting.
   *
   * The figures are now in a dated entry that every report counts. Left in the field as well,
   * the ledger statement — the one report that reads it — would show them a second time, and no
   * other screen would agree with it.
   */
  await LedgerModel.updateMany(
    {},
    { $set: { 'openingBalance.amount': 0, 'openingBalance.asOf': null } },
  ).exec();

  const settings = await settingsDoc();
  settings.cutoverDate = cutoverDate;
  settings.booksOpenedAt = new Date();
  settings.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await settings.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'opening_balance',
    entityId: String(entry._id),
    action: 'posted',
    meta: {
      cutoverDate,
      entryNo: entry.entryNo,
      totalDebit: entry.totalDebit,
      openingEquity: equityAmount,
    },
  });

  return {
    entryId: String(entry._id),
    entryNo: entry.entryNo,
    totalDebit: round2(entry.totalDebit),
    totalCredit: round2(entry.totalCredit),
    openingEquity: equityAmount,
    status: await migrationStatus(),
  };
}

/**
 * Move Opening Balance Equity into the owner's capital, and finish the changeover.
 *
 * Kept as its own act rather than folded into the entry above, because it is a different kind of
 * decision: the first says what the business had, this one says whose it is. Somebody has to
 * look at the figure and agree with it.
 */
export async function closeOpeningEquity(
  toLedgerId: string,
  actorId?: string,
): Promise<MigrationStatus> {
  return withFinanceLocks(
    ['finance:opening-balance'],
    () => doCloseOpeningEquity(toLedgerId, actorId),
    'The changeover is being finished right now. Give it a moment.',
  );
}

async function doCloseOpeningEquity(
  toLedgerId: string,
  actorId?: string,
): Promise<MigrationStatus> {
  const status = await migrationStatus();

  if (status.stage === 'not-started') {
    throw badRequest('The opening balances have not been posted yet.');
  }
  if (status.stage === 'complete') {
    throw conflict('Opening Balance Equity is already nil — the changeover is finished.');
  }

  if (!Types.ObjectId.isValid(toLedgerId)) throw badRequest('That is not an account id.');

  const equityId = await ledgerIdForRole('openingEquity');
  if (toLedgerId === equityId) {
    throw badRequest('That is the account being cleared. Choose where the balance should go.');
  }

  const target = await LedgerModel.findById(toLedgerId).lean().exec();
  if (!target) throw notFound('Account not found');

  const group = await AccountGroupModel.findById(target.groupId).select('accountType').lean().exec();
  if (group?.accountType !== 'equity') {
    throw badRequest(
      `"${target.code} ${target.name}" is not an equity account. What the business was worth at `
        + "changeover belongs in the owner's capital or in retained earnings, not anywhere else.",
    );
  }
  if (target.isControl) {
    throw badRequest(`"${target.code} ${target.name}" is a control account and cannot take this.`);
  }

  const settings = await settingsDoc();
  const amount = status.openingEquityBalance;

  // Equity is credit-natured, so a positive balance sits as a credit and is cleared by a debit.
  const entry = await postEntry(
    {
      date: settings.cutoverDate ?? new Date(),
      narration: 'Opening Balance Equity carried to capital',
      referenceNo: EQUITY_CLOSE_REF,
      sourceType: 'opening_balance',
      idempotencyKey: await attemptKey('equity_close'),
      lines:
        amount > 0
          ? [
            { ledgerId: equityId, debit: amount, lineNarration: 'Clearing the changeover figure' },
            { ledgerId: toLedgerId, credit: amount, lineNarration: 'Net worth at changeover' },
          ]
          : [
            { ledgerId: toLedgerId, debit: Math.abs(amount), lineNarration: 'Net worth at changeover' },
            { ledgerId: equityId, credit: Math.abs(amount), lineNarration: 'Clearing the changeover figure' },
          ],
    },
    actorId,
  );

  logActivityAsync({
    employeeId: actorId,
    module: 'opening_balance',
    entityId: String(entry._id),
    action: 'closed',
    meta: { amount, to: `${target.code} ${target.name}` },
  });

  return migrationStatus();
}

/**
 * Undo the changeover.
 *
 * Opening balances are typed by a person from paperwork, and getting them wrong on the first
 * attempt is ordinary. Without a way back the business would be stuck with a wrong set of books
 * for ever, which is a far worse outcome than the risk of allowing this.
 *
 * Both entries are reversed rather than deleted, so the mistake and its correction both stay on
 * the record — and the figures are put back on the worksheet so they can be corrected rather
 * than retyped from scratch.
 */
export async function reopenMigration(
  reason: string,
  actorId?: string,
): Promise<Worksheet> {
  if (!reason?.trim()) throw badRequest('Say why the changeover is being reopened.');

  const status = await migrationStatus();
  if (status.stage === 'not-started') throw badRequest('The books have not been opened yet.');

  const endOfCutover = new Date(status.cutoverDate ?? new Date(0));
  endOfCutover.setHours(23, 59, 59, 999);
  const later = await liveEntriesOutside({ after: endOfCutover });

  if (later > 0) {
    throw badRequest(
      `${later} posting${later === 1 ? '' : 's'} recorded since the changeover `
        + `${later === 1 ? 'was' : 'were'} made on top of these opening figures. Reverse `
        + `${later === 1 ? 'it' : 'them'} first, or correct the opening balances with an ordinary `
        + 'journal entry instead of reopening the changeover.',
    );
  }

  // The closing entry goes first: it was posted on top of the opening one.
  if (status.closingEntryId) {
    await reverseEntry(status.closingEntryId, { reason: reason.trim() }, actorId);
  }

  const openingId = status.openingEntryId!;
  const lines = await JournalLineModel.find({
    journalEntryId: new Types.ObjectId(openingId),
    status: { $in: ['posted', 'reversed'] },
  })
    .lean()
    .exec();

  await reverseEntry(openingId, { reason: reason.trim() }, actorId);

  /*
   * Put the figures back where they were typed, so the correction starts from what was entered
   * rather than from a blank sheet. Payables are skipped — those live on the suppliers, which
   * were never cleared.
   */
  const apTradeId = await ledgerIdForRole('apTrade');
  const equityId = await ledgerIdForRole('openingEquity');

  const groups = await AccountGroupModel.find().select('_id accountType').lean().exec();
  const typeByGroup = new Map(groups.map((g) => [String(g._id), g.accountType]));

  for (const line of lines) {
    const id = String(line.ledgerId);
    if (id === apTradeId || id === equityId) continue;

    const ledger = await LedgerModel.findById(id).select('groupId').lean().exec();
    if (!ledger) continue;

    const accountType = typeByGroup.get(String(ledger.groupId)) ?? 'asset';
    const signed = round2(line.debit - line.credit);
    const natural = isDebitNatured(accountType) ? signed : -signed;

    await LedgerModel.updateOne(
      { _id: line.ledgerId },
      { $set: { 'openingBalance.amount': natural } },
    ).exec();
  }

  // `$unset` rather than assigning undefined — Mongoose leaves the stored value in place for the
  // latter, and the books would read as still open.
  await FinanceSettingsModel.updateOne(
    { key: 'singleton' },
    {
      $unset: { booksOpenedAt: '', cutoverDate: '' },
      $set: { updatedBy: actorId ? new Types.ObjectId(actorId) : undefined },
    },
  ).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'opening_balance',
    entityId: openingId,
    action: 'reversed',
    meta: { reason: reason.trim() },
  });

  return worksheet();
}
