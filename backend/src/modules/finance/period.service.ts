import { Types } from 'mongoose';
import {
  FinancialPeriodModel,
  IFinancialPeriod,
  PeriodStatus,
} from '../../models/financial-period.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  MONEY_EPSILON,
  fiscalYearFor,
  isValidPeriodKey,
  periodKeyFor,
  periodsInFiscalYear,
  round2,
} from './finance.rules';
import { failingControls } from './control-reconciliation.service';

/**
 * Accounting periods: which months accept postings, and what it takes to close one.
 */

async function fiscalYearStartMonth(): Promise<number> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('fiscalYearStartMonth')
    .lean()
    .exec();
  // July, the Pakistani standard and the client's answer. Falling back to it rather than to
  // January means a missing settings document does not silently reshape the financial year.
  return settings?.fiscalYearStartMonth ?? 7;
}

/**
 * Is this date postable, and if not, why not?
 *
 * A missing period document reads as CLOSED. Failing shut means a mistyped year is refused;
 * failing open means it is accepted and lands in a year nobody looks at again.
 */
export async function checkPostable(
  date: Date,
  options: { isReversal?: boolean } = {},
): Promise<{ ok: boolean; period: string; status: PeriodStatus | 'missing'; reason?: string }> {
  const period = periodKeyFor(date);
  const doc = await FinancialPeriodModel.findOne({ period }).select('status').lean().exec();

  if (!doc) {
    return {
      ok: false,
      period,
      status: 'missing',
      reason: `${period} has not been opened for posting. Open it first, or check the date.`,
    };
  }

  if (doc.status === 'open') return { ok: true, period, status: 'open' };

  if (doc.status === 'closed') {
    // A closed month still accepts a correction, because the alternative is reopening the whole
    // period to fix one entry — which is a bigger hole than the one being patched.
    if (options.isReversal) return { ok: true, period, status: 'closed' };
    return {
      ok: false,
      period,
      status: 'closed',
      reason: `${period} is closed. Post this to an open month, or ask a Finance Manager to reopen it.`,
    };
  }

  return {
    ok: false,
    period,
    status: 'locked',
    reason: `${period} is locked and cannot be changed, not even by a reversal.`,
  };
}

/** Throwing wrapper, for the posting service. */
export async function assertPostable(
  date: Date,
  options: { isReversal?: boolean } = {},
): Promise<string> {
  const result = await checkPostable(date, options);
  if (!result.ok) throw badRequest(result.reason!);
  return result.period;
}

/**
 * A lean read, so the return type describes the fields rather than the Mongoose Document.
 * `.lean()` yields `FlattenMaps<T>`, which will not assign to the Document interface.
 */
export interface PeriodRow {
  _id: Types.ObjectId;
  period: string;
  fiscalYear: string;
  status: PeriodStatus;
  closedAt?: Date;
  reopenedAt?: Date;
  reopenReason?: string;
}

export async function listPeriods(fiscalYear?: string): Promise<PeriodRow[]> {
  const query = fiscalYear ? { fiscalYear } : {};
  return FinancialPeriodModel.find(query).sort({ period: -1 }).lean().exec();
}

/** Open a single month for posting. Idempotent — reopening an open month changes nothing. */
export async function openPeriod(period: string, actorId?: string): Promise<IFinancialPeriod> {
  if (!isValidPeriodKey(period)) throw badRequest(`"${period}" is not a month. Use YYYY-MM.`);

  const startMonth = await fiscalYearStartMonth();
  const existing = await FinancialPeriodModel.findOne({ period }).exec();

  if (existing) {
    if (existing.status === 'open') return existing;
    if (existing.status === 'locked') {
      throw badRequest(
        `${period} is locked. Locked months are periods before the books opened and stay closed.`,
      );
    }
    existing.status = 'open';
    existing.reopenedAt = new Date();
    existing.reopenedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    await existing.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'period',
      entityId: String(existing._id),
      action: 'reopened',
      meta: { period },
    });
    return existing;
  }

  const created = await FinancialPeriodModel.create({
    period,
    fiscalYear: fiscalYearFor(period, startMonth),
    status: 'open',
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'period',
    entityId: String(created._id),
    action: 'created',
    meta: { period },
  });

  return created;
}

/** Open every month of a fiscal year at once — the normal way a year is started. */
export async function openFiscalYear(
  fiscalYear: string,
  actorId?: string,
): Promise<{ opened: string[]; skipped: string[] }> {
  const startMonth = await fiscalYearStartMonth();
  const periods = periodsInFiscalYear(fiscalYear, startMonth);

  const opened: string[] = [];
  const skipped: string[] = [];

  for (const period of periods) {
    const existing = await FinancialPeriodModel.findOne({ period }).select('status').lean().exec();
    if (existing) {
      skipped.push(period);
      continue;
    }
    await openPeriod(period, actorId);
    opened.push(period);
  }

  return { opened, skipped };
}

export interface CloseCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Everything that must be true before a month can close.
 *
 * Returned as a list rather than a single boolean so the screen can show which check failed and
 * by how much. "Cannot close" with no reason is the kind of message that gets worked around.
 */
export async function closeChecks(period: string): Promise<CloseCheck[]> {
  const checks: CloseCheck[] = [];

  const draftCount = await JournalEntryModel.countDocuments({
    postingPeriod: period,
    status: 'draft',
  }).exec();
  checks.push({
    name: 'No unposted drafts',
    ok: draftCount === 0,
    detail:
      draftCount === 0
        ? 'Every entry in this month is posted.'
        : `${draftCount} draft entr${draftCount === 1 ? 'y is' : 'ies are'} still unposted. `
          + 'Post or delete them — a draft left behind is work someone believes is recorded.',
  });

  const totals = await JournalLineModel.aggregate<{ debit: number; credit: number }>([
    { $match: { postingPeriod: period, status: 'posted' } },
    { $group: { _id: null, debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
    { $project: { _id: 0, debit: 1, credit: 1 } },
  ]).exec();

  const debit = round2(totals[0]?.debit ?? 0);
  const credit = round2(totals[0]?.credit ?? 0);
  const balanced = Math.abs(debit - credit) < MONEY_EPSILON;

  checks.push({
    name: 'Debits equal credits',
    ok: balanced,
    detail: balanced
      ? `Both sides total ${debit}.`
      : `Debits ${debit}, credits ${credit} — a difference of ${round2(Math.abs(debit - credit))}. `
        + 'This should be impossible; it means something wrote to the ledger outside the posting service.',
  });

  /*
   * The control accounts must agree with the records behind them.
   *
   * This is the check the whole module exists for. Signing a month off against a receivable that
   * disagrees with what the collections module says shops owe, or an inventory figure that
   * disagrees with the warehouse, is exactly the outcome a ledger is supposed to prevent.
   *
   * Deliberately blocking rather than advisory. A warning at close is a warning that gets
   * clicked past every month until the difference is a year old.
   */
  const failing = await failingControls();
  checks.push({
    name: 'Control accounts agree with the records behind them',
    ok: failing.length === 0,
    detail:
      failing.length === 0
        ? 'Receivables, rider cash and stock all match their operational records.'
        : failing
          .map((c) => `${c.label} is out by ${round2(Math.abs(c.drift))} (account ${c.ledgerCode}).`)
          .join(' ')
          + ' Find the cause before closing — the ledger and the records disagree.',
  });

  return checks;
}

export async function closePeriod(period: string, actorId?: string): Promise<IFinancialPeriod> {
  const doc = await FinancialPeriodModel.findOne({ period }).exec();
  if (!doc) throw notFound(`${period} has never been opened.`);
  if (doc.status === 'locked') throw badRequest(`${period} is already locked.`);
  if (doc.status === 'closed') return doc;

  const checks = await closeChecks(period);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    throw conflict(
      `${period} cannot be closed yet. ${failed.map((c) => c.detail).join(' ')}`,
    );
  }

  // The snapshot is what makes "the figures changed after we signed off" answerable. Per-ledger
  // closing balances also let a later as-at-date trial balance aggregate from this point rather
  // than from inception.
  const perLedger = await JournalLineModel.aggregate<{
    _id: Types.ObjectId;
    debit: number;
    credit: number;
  }>([
    { $match: { postingPeriod: { $lte: period }, status: 'posted' } },
    { $group: { _id: '$ledgerId', debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
  ]).exec();

  const entryCount = await JournalEntryModel.countDocuments({
    postingPeriod: period,
    status: { $in: ['posted', 'reversed'] },
  }).exec();

  doc.status = 'closed';
  doc.closedAt = new Date();
  doc.closedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  doc.snapshot = {
    totalDebit: round2(perLedger.reduce((s, l) => s + l.debit, 0)),
    totalCredit: round2(perLedger.reduce((s, l) => s + l.credit, 0)),
    entryCount,
    ledgerBalances: perLedger.map((l) => ({
      ledgerId: l._id,
      debit: round2(l.debit),
      credit: round2(l.credit),
    })),
  };
  await doc.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'period',
    entityId: String(doc._id),
    action: 'closed',
    meta: { period, entryCount },
  });

  return doc;
}

export async function reopenPeriod(
  period: string,
  reason: string,
  actorId?: string,
): Promise<IFinancialPeriod> {
  const doc = await FinancialPeriodModel.findOne({ period }).exec();
  if (!doc) throw notFound(`${period} has never been opened.`);
  if (doc.status === 'locked') {
    throw badRequest(`${period} is locked and cannot be reopened.`);
  }
  if (doc.status === 'open') return doc;
  if (!reason?.trim()) {
    // Reopening a signed-off month is exactly the kind of act that needs a reason attached at
    // the moment it happens, not reconstructed from memory later.
    throw badRequest('Say why this month is being reopened.');
  }

  doc.status = 'open';
  doc.reopenedAt = new Date();
  doc.reopenedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  doc.reopenReason = reason.trim();
  await doc.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'period',
    entityId: String(doc._id),
    action: 'reopened',
    meta: { period, reason: reason.trim() },
  });

  return doc;
}

/** Lock every period up to and including `period`. Used at cutover to seal history. */
export async function lockThrough(
  period: string,
  actorId?: string,
): Promise<{ locked: string[] }> {
  if (!isValidPeriodKey(period)) throw badRequest(`"${period}" is not a month. Use YYYY-MM.`);

  const docs = await FinancialPeriodModel.find({
    period: { $lte: period },
    status: { $ne: 'locked' },
  }).exec();

  const locked: string[] = [];
  for (const doc of docs) {
    doc.status = 'locked';
    await doc.save();
    locked.push(doc.period);
  }

  if (locked.length > 0) {
    logActivityAsync({
      employeeId: actorId,
      module: 'period',
      entityId: period,
      action: 'closed',
      meta: { lockedThrough: period, count: locked.length },
    });
  }

  return { locked };
}
