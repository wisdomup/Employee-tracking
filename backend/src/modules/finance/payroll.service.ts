import { Types } from 'mongoose';
import { PayrollRunModel, IPayrollRun } from '../../models/payroll-run.model';
import { StaffAdvanceModel, IStaffAdvance } from '../../models/staff-advance.model';
import { UserModel } from '../../models/user.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { allocateNextFinanceNo } from './finance-counters';
import {
  MONEY_EPSILON,
  buildIdempotencyKey,
  isValidPeriodKey,
  periodKeyFor,
  round2,
} from './finance.rules';
import { postEntry, reverseEntry, ledgerIdForRole } from './posting.service';
import { withFinanceLocks } from './finance-locks';
import { loadPaidFromAccount } from './money-out';

/**
 * Payroll, and the advances that come off it.
 *
 * ## Owing and paying are different events
 *
 * Posting a payroll run records what the month's work COST and what is now owed to staff. It hands
 * nobody any money. Payments are recorded against the run afterwards, in the instalments the money
 * actually left in — which is what a business paying half the wages on the 1st and the rest on the
 * 7th really does. Collapsing the two would force somebody to lie about one of the dates.
 *
 * ## An advance is a debt, and it is recovered from pay
 *
 * Paying an advance moves money into `Advances to Staff`, one subledger per employee. It becomes an
 * expense only when that month's payroll is accrued and the advance is taken back out of the pay.
 * Recording an advance as salary on the day it is handed over would charge those wages twice.
 *
 * What an employee owes is therefore read from the LEDGER, never stored on the advance — the same
 * rule bills and payments follow, and for the same reason: a stored figure has to be adjusted on
 * every path, and the first path anybody forgets leaves it wrong with nothing to check it against.
 */

export function advanceReference(no?: number): string {
  return no ? `A-${String(no).padStart(4, '0')}` : 'Draft';
}

/** `2026-09` → `September 2026`, for narrations a person will read in the day book. */
function monthName(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${year}`;
}

/**
 * Midday UTC on the last day of the month.
 *
 * Payroll belongs to the month it is for, not to the day somebody got round to posting it. Midday
 * keeps it inside that day in any timezone the business might be read in.
 */
function lastDayOf(period: string): Date {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0, 12));
}

function assertPeriod(period: string): void {
  if (!isValidPeriodKey(period)) throw badRequest(`"${period}" is not a month. Use YYYY-MM.`);
}

// ---------------------------------------------------------------------------
// What each employee owes the business
// ---------------------------------------------------------------------------

/**
 * Each employee's balance on Advances to Staff — positive means they owe it back.
 *
 * Counts `posted` and `reversed` lines together, like every other balance in this module: a
 * reversal leaves the original in place and writes an opposite line, so the pair nets to zero only
 * when both are counted.
 */
export async function advanceBalanceByEmployee(
  ids: Types.ObjectId[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('ledgerMap')
    .lean()
    .exec();
  const map = settings?.ledgerMap as unknown as Record<string, Types.ObjectId> | undefined;
  if (!map?.staffAdvances) return new Map();

  const rows = await JournalLineModel.aggregate<{ _id: Types.ObjectId; owed: number }>([
    {
      $match: {
        ledgerId: new Types.ObjectId(String(map.staffAdvances)),
        status: { $in: ['posted', 'reversed'] },
        'subledgerRef.type': 'employee',
        'subledgerRef.id': { $in: ids },
      },
    },
    // An advance is an asset of the business: what was paid out, less what has been recovered.
    { $group: { _id: '$subledgerRef.id', owed: { $sum: { $subtract: ['$debit', '$credit'] } } } },
  ]).exec();

  return new Map(rows.map((r) => [String(r._id), round2(r.owed)]));
}

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------

export interface PayrollLineInput {
  userId: string;
  salary?: number;
  bonus?: number;
  allowance?: number;
  advanceRecovery?: number;
}

export interface PayrollLineView {
  userId: string;
  name: string;
  role?: string;
  salary: number;
  bonus: number;
  allowance: number;
  gross: number;
  advanceRecovery: number;
  net: number;
  /** What they still owe in advances, for the screen to cap the recovery against. */
  advanceBalance: number;
}

export interface PayrollRunView {
  id: string;
  period: string;
  periodLabel: string;
  status: 'draft' | 'posted' | 'cancelled';
  employeeCount: number;
  totals: IPayrollRun['totals'];
  /** Paid to staff so far against this run. */
  paidAmount: number;
  outstanding: number;
  accrualEntryId?: string;
  payments: {
    paidOn: Date;
    amount: number;
    method: 'cash' | 'bank_transfer';
    paidFromLedgerId: string;
    reference?: string;
    journalEntryId: string;
  }[];
  cancelReason?: string;
  notes?: string;
  createdAt: Date;
}

export interface PayrollRunDetail extends PayrollRunView {
  lines: PayrollLineView[];
}

function totalsOf(lines: { salary: number; bonus: number; allowance: number; gross: number; advanceRecovery: number; net: number }[]) {
  const sum = (pick: (l: typeof lines[number]) => number) => round2(lines.reduce((s, l) => s + pick(l), 0));
  return {
    salary: sum((l) => l.salary),
    bonus: sum((l) => l.bonus),
    allowance: sum((l) => l.allowance),
    gross: sum((l) => l.gross),
    advanceRecovery: sum((l) => l.advanceRecovery),
    net: sum((l) => l.net),
  };
}

function toView(run: IPayrollRun): PayrollRunView {
  const paidAmount = round2(run.payments.reduce((s, p) => s + p.amount, 0));
  return {
    id: String(run._id),
    period: run.period,
    periodLabel: monthName(run.period),
    status: run.status,
    employeeCount: run.lines.length,
    totals: run.totals,
    paidAmount: run.status === 'posted' ? paidAmount : 0,
    outstanding: run.status === 'posted' ? round2(run.totals.net - paidAmount) : 0,
    accrualEntryId: run.accrualEntryId ? String(run.accrualEntryId) : undefined,
    payments: run.payments.map((p) => ({
      paidOn: p.paidOn,
      amount: round2(p.amount),
      method: p.method,
      paidFromLedgerId: String(p.paidFromLedgerId),
      reference: p.reference,
      journalEntryId: String(p.journalEntryId),
    })),
    cancelReason: run.cancelReason,
    notes: run.notes,
    createdAt: run.createdAt,
  };
}

async function toDetail(run: IPayrollRun): Promise<PayrollRunDetail> {
  const balances = await advanceBalanceByEmployee(run.lines.map((l) => l.userId));
  return {
    ...toView(run),
    lines: run.lines.map((l) => ({
      userId: String(l.userId),
      name: l.name,
      role: l.role,
      salary: round2(l.salary),
      bonus: round2(l.bonus),
      allowance: round2(l.allowance),
      gross: round2(l.gross),
      advanceRecovery: round2(l.advanceRecovery),
      net: round2(l.net),
      advanceBalance: balances.get(String(l.userId)) ?? 0,
    })),
  };
}

export async function listRuns(
  filters: { status?: 'draft' | 'posted' | 'cancelled' | 'all' } = {},
): Promise<PayrollRunView[]> {
  const query: Record<string, unknown> = {};
  if (filters.status && filters.status !== 'all') query.status = filters.status;

  const runs = await PayrollRunModel.find(query).sort({ period: -1, createdAt: -1 }).limit(200).exec();
  return runs.map(toView);
}

export async function getRun(id: string): Promise<PayrollRunDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payroll run not found');
  const run = await PayrollRunModel.findById(id).exec();
  if (!run) throw notFound('Payroll run not found');
  return toDetail(run);
}

/**
 * Start a month's payroll, pre-filled from what is recorded against each employee.
 *
 * Everyone active with any pay recorded is included, and the figures are then edited before
 * posting. Somebody who joined mid-month, or who is owed a one-off bonus, is corrected here — which
 * is the whole reason the run is a document rather than a calculation.
 */
export async function createRun(period: string, actorId?: string): Promise<PayrollRunDetail> {
  assertPeriod(period);

  return withFinanceLocks([`payroll:${period}`], async () => {
    const existing = await PayrollRunModel.findOne({ period, status: { $in: ['draft', 'posted'] } })
      .select('status')
      .lean()
      .exec();
    if (existing) {
      throw conflict(
        `There is already a ${existing.status} payroll run for ${monthName(period)}. `
          + 'A month is only run once.',
      );
    }

    const users = await UserModel.find({ isActive: true, isTrashed: { $ne: true } })
      .select('_id fullName username role perks')
      .lean()
      .exec();

    const lines = users
      .map((u) => {
        const salary = round2(u.perks?.salary ?? 0);
        const bonus = round2(u.perks?.bonus ?? 0);
        const allowance = round2(u.perks?.allowance ?? 0);
        const gross = round2(salary + bonus + allowance);
        return {
          userId: u._id,
          name: u.fullName?.trim() || u.username,
          role: u.role,
          salary,
          bonus,
          allowance,
          gross,
          advanceRecovery: 0,
          net: gross,
        };
      })
      .filter((l) => l.gross > MONEY_EPSILON)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (lines.length === 0) {
      throw badRequest(
        'No active employee has any salary, bonus or allowance recorded, so there is nothing to '
          + 'run. Record what people are paid on their employee record first.',
      );
    }

    const run = await PayrollRunModel.create({
      period,
      lines,
      totals: totalsOf(lines),
      status: 'draft',
      createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
    });

    logActivityAsync({
      employeeId: actorId,
      module: 'payroll',
      entityId: String(run._id),
      action: 'created',
      meta: { period, employees: lines.length, gross: run.totals.gross },
    });

    return toDetail(run);
  });
}

/** Correct a draft: change any figure, and say how much of each advance is coming back this month. */
export async function updateRun(
  id: string,
  input: { lines?: PayrollLineInput[]; notes?: string },
  actorId?: string,
): Promise<PayrollRunDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payroll run not found');
  const run = await PayrollRunModel.findById(id).exec();
  if (!run) throw notFound('Payroll run not found');

  if (run.status !== 'draft') {
    throw badRequest(
      `This payroll run is ${run.status} and cannot be edited. Cancel it and start the month `
        + 'again, so both stay on the record.',
    );
  }

  if (input.lines) {
    const byId = new Map(run.lines.map((l) => [String(l.userId), l]));
    const balances = await advanceBalanceByEmployee([...byId.values()].map((l) => l.userId));

    for (const patch of input.lines) {
      const line = byId.get(patch.userId);
      if (!line) throw badRequest('One of the rows is for somebody who is not on this payroll run.');

      if (patch.salary !== undefined) line.salary = round2(patch.salary);
      if (patch.bonus !== undefined) line.bonus = round2(patch.bonus);
      if (patch.allowance !== undefined) line.allowance = round2(patch.allowance);
      if (patch.advanceRecovery !== undefined) line.advanceRecovery = round2(patch.advanceRecovery);

      if (line.salary < 0 || line.bonus < 0 || line.allowance < 0 || line.advanceRecovery < 0) {
        throw badRequest(`${line.name}: pay and recovery cannot be negative.`);
      }

      line.gross = round2(line.salary + line.bonus + line.allowance);

      const owed = balances.get(String(line.userId)) ?? 0;
      if (line.advanceRecovery - owed > MONEY_EPSILON) {
        throw badRequest(
          `${line.name} owes ${owed.toFixed(2)} in advances, and this run takes back `
            + `${line.advanceRecovery.toFixed(2)}. Recovering more than was advanced would leave `
            + 'the business owing them money it never lent.',
        );
      }
      if (line.advanceRecovery - line.gross > MONEY_EPSILON) {
        throw badRequest(
          `${line.name} is paid ${line.gross.toFixed(2)} this month, and this run takes back `
            + `${line.advanceRecovery.toFixed(2)}. Recover the rest from a later month.`,
        );
      }

      line.net = round2(line.gross - line.advanceRecovery);
    }

    run.lines = [...byId.values()] as typeof run.lines;
    run.totals = totalsOf(run.lines);
  }

  if (input.notes !== undefined) run.notes = input.notes.trim() || undefined;
  run.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await run.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'payroll',
    entityId: id,
    action: 'updated',
    meta: { period: run.period, gross: run.totals.gross },
  });

  return toDetail(run);
}

export async function deleteRun(id: string, actorId?: string): Promise<{ message: string }> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payroll run not found');
  const run = await PayrollRunModel.findById(id).lean().exec();
  if (!run) throw notFound('Payroll run not found');

  if (run.status !== 'draft') {
    throw badRequest(
      `This payroll run is ${run.status}. A posted run is cancelled, never deleted — what was `
        + 'owed to staff has to stay on the record.',
    );
  }

  await PayrollRunModel.deleteOne({ _id: run._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'payroll',
    entityId: id,
    action: 'deleted',
    meta: { period: run.period },
  });

  return { message: 'Draft payroll run deleted' };
}

/**
 * Post the month: record what the wages cost and what is now owed to staff.
 *
 *     Dr  Salaries & Wages              the salary half
 *     Dr  Staff Allowances & Bonus      the rest of the pay
 *         Cr  Advances to Staff         what is being taken back, per employee
 *         Cr  Salaries & Wages Payable  what is left to hand over
 *
 * Dated the last day of the month it is for, not the day it was posted, so wages land in the month
 * that earned them.
 */
export async function postRun(id: string, actorId?: string): Promise<PayrollRunDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payroll run not found');

  const peek = await PayrollRunModel.findById(id).select('period').lean().exec();
  if (!peek) throw notFound('Payroll run not found');

  return withFinanceLocks([`payroll:${peek.period}`, `payroll-run:${id}`], async () => {
    const run = await PayrollRunModel.findById(id).exec();
    if (!run) throw notFound('Payroll run not found');
    if (run.status === 'posted') return toDetail(run);
    if (run.status !== 'draft') {
      throw badRequest(`This payroll run is ${run.status} and cannot be posted.`);
    }
    if (run.totals.gross <= MONEY_EPSILON) {
      throw badRequest('Every line on this run is zero, so there is nothing to post.');
    }

    // Advances may have been recovered elsewhere, or the advance itself cancelled, since the draft
    // was prepared. Checked again here rather than trusted from then.
    const balances = await advanceBalanceByEmployee(run.lines.map((l) => l.userId));
    for (const line of run.lines) {
      const owed = balances.get(String(line.userId)) ?? 0;
      if (line.advanceRecovery - owed > MONEY_EPSILON) {
        throw badRequest(
          `${line.name} now owes only ${owed.toFixed(2)} in advances, but this run still takes `
            + `back ${line.advanceRecovery.toFixed(2)}. Correct the run before posting it.`,
        );
      }
    }

    const allowances = round2(run.totals.bonus + run.totals.allowance);
    const [salaryExpense, staffAllowances, salaryPayable, staffAdvances] = await Promise.all([
      ledgerIdForRole('salaryExpense'),
      allowances > 0 ? ledgerIdForRole('staffAllowances') : Promise.resolve(''),
      ledgerIdForRole('salaryPayable'),
      run.totals.advanceRecovery > 0 ? ledgerIdForRole('staffAdvances') : Promise.resolve(''),
    ]);

    const lines: {
      ledgerId: string;
      debit?: number;
      credit?: number;
      lineNarration?: string;
      subledgerRef?: { type: string; id: string } | null;
    }[] = [];

    if (run.totals.salary > 0) {
      lines.push({ ledgerId: salaryExpense, debit: run.totals.salary, lineNarration: 'Salaries' });
    }
    if (allowances > 0) {
      lines.push({ ledgerId: staffAllowances, debit: allowances, lineNarration: 'Bonus and allowances' });
    }
    for (const line of run.lines) {
      if (line.advanceRecovery <= MONEY_EPSILON) continue;
      lines.push({
        ledgerId: staffAdvances,
        credit: line.advanceRecovery,
        lineNarration: `${line.name} — advance recovered`,
        subledgerRef: { type: 'employee', id: String(line.userId) },
      });
    }
    lines.push({ ledgerId: salaryPayable, credit: run.totals.net, lineNarration: 'Net pay owed' });

    const entry = await postEntry(
      {
        date: lastDayOf(run.period),
        narration: `Payroll for ${monthName(run.period)}`,
        sourceType: 'payroll_accrual',
        sourceId: id,
        sourceModel: 'PayrollRun',
        idempotencyKey: buildIdempotencyKey('payroll_run', id, 'accrual'),
        lines,
      },
      actorId,
    );

    run.status = 'posted';
    run.accrualEntryId = entry._id;
    run.postedAt = new Date();
    run.postedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    await run.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'payroll',
      entityId: id,
      action: 'posted',
      meta: {
        period: run.period,
        gross: run.totals.gross,
        recovered: run.totals.advanceRecovery,
        net: run.totals.net,
      },
    });

    return toDetail(run);
  });
}

export interface PayrollPaymentInput {
  paidOn: Date | string;
  amount: number;
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: string;
  reference?: string;
}

/**
 * Record wages actually handed over, in whatever instalments they went out in.
 *
 *     Dr  Salaries & Wages Payable
 *         Cr  Cash / Bank
 *
 * Cash or bank only. A cheque would need its leaf tracked against the cheque register, and salaries
 * are not paid that way here — an instalment that really was a cheque is recorded when it clears.
 */
export async function recordPayment(
  id: string,
  input: PayrollPaymentInput,
  actorId?: string,
): Promise<PayrollRunDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payroll run not found');

  return withFinanceLocks([`payroll-run:${id}`], async () => {
    const run = await PayrollRunModel.findById(id).exec();
    if (!run) throw notFound('Payroll run not found');
    if (run.status !== 'posted') {
      throw badRequest(
        `This payroll run is ${run.status}. Post it before paying it — until then nothing is owed.`,
      );
    }

    const paidOn = new Date(input.paidOn);
    if (Number.isNaN(paidOn.getTime())) throw badRequest('The payment date is not a date.');
    if (input.method !== 'cash' && input.method !== 'bank_transfer') {
      throw badRequest('Say whether the wages were paid in cash or by bank transfer.');
    }

    const amount = round2(input.amount);
    if (!(amount > MONEY_EPSILON)) throw badRequest('A payment has to be for something.');

    const alreadyPaid = round2(run.payments.reduce((s, p) => s + p.amount, 0));
    const outstanding = round2(run.totals.net - alreadyPaid);
    if (outstanding <= MONEY_EPSILON) {
      throw badRequest(`${monthName(run.period)} has already been paid in full.`);
    }
    if (amount - outstanding > MONEY_EPSILON) {
      throw badRequest(
        `${monthName(run.period)} has ${outstanding.toFixed(2)} left to pay, and this payment is `
          + `${amount.toFixed(2)}. Paying more than is owed would leave staff owing the business.`,
      );
    }

    const paidFrom = await loadPaidFromAccount(input.paidFromLedgerId);
    const salaryPayable = await ledgerIdForRole('salaryPayable');

    const entry = await postEntry(
      {
        date: paidOn,
        narration: `Wages paid for ${monthName(run.period)}`,
        referenceNo: input.reference?.trim() || undefined,
        sourceType: 'salary_payment',
        sourceId: id,
        sourceModel: 'PayrollRun',
        // The instalment's position on the run. Stable while the lock is held, so a double-click
        // finds the entry already written instead of paying the month twice.
        idempotencyKey: buildIdempotencyKey('payroll_run', id, 'payment', run.payments.length),
        lines: [
          { ledgerId: salaryPayable, debit: amount },
          { ledgerId: String(paidFrom._id), credit: amount },
        ],
      },
      actorId,
    );

    run.payments.push({
      paidOn,
      amount,
      method: input.method,
      paidFromLedgerId: paidFrom._id,
      reference: input.reference?.trim() || undefined,
      journalEntryId: entry._id,
      recordedAt: new Date(),
      recordedBy: actorId ? new Types.ObjectId(actorId) : undefined,
    } as IPayrollRun['payments'][number]);
    await run.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'payroll',
      entityId: id,
      action: 'posted',
      meta: { period: run.period, paid: amount, method: input.method },
    });

    return toDetail(run);
  });
}

export async function cancelRun(
  id: string,
  reason: string,
  actorId?: string,
): Promise<PayrollRunDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payroll run not found');

  return withFinanceLocks([`payroll-run:${id}`], async () => {
    const run = await PayrollRunModel.findById(id).exec();
    if (!run) throw notFound('Payroll run not found');
    if (run.status === 'cancelled') throw conflict('This payroll run has already been cancelled.');
    if (run.status !== 'posted') {
      throw badRequest('This payroll run was never posted. Delete the draft instead.');
    }

    if (run.payments.length > 0) {
      const paid = round2(run.payments.reduce((s, p) => s + p.amount, 0));
      throw badRequest(
        `${paid.toFixed(2)} of these wages has already been paid. Cancelling the run would leave `
          + 'those payments against a month nobody was owed for.',
      );
    }

    if (run.accrualEntryId) {
      const entry = await JournalEntryModel.findById(run.accrualEntryId).select('status').lean().exec();
      if (entry && entry.status === 'posted') {
        await reverseEntry(String(run.accrualEntryId), { reason }, actorId);
      }
    }

    run.status = 'cancelled';
    run.cancelledAt = new Date();
    run.cancelledBy = actorId ? new Types.ObjectId(actorId) : undefined;
    run.cancelReason = reason.trim();
    await run.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'payroll',
      entityId: id,
      action: 'cancelled',
      meta: { period: run.period, reason: reason.trim() },
    });

    return toDetail(run);
  });
}

// ---------------------------------------------------------------------------
// Who can be paid or advanced money
// ---------------------------------------------------------------------------

export interface PayrollEmployee {
  id: string;
  name: string;
  role?: string;
  salary: number;
  /** What they already owe in advances. */
  owed: number;
}

/**
 * The people an advance can be given to.
 *
 * Served from inside the finance module rather than from the staff list, so an accountant who is
 * not allowed to browse employee records can still record an advance. It returns a name, a role
 * and two figures — nothing about anybody's account, address or pay history.
 */
export async function payrollEmployees(): Promise<PayrollEmployee[]> {
  const users = await UserModel.find({ isActive: true, isTrashed: { $ne: true } })
    .select('_id fullName username role perks')
    .lean()
    .exec();

  const balances = await advanceBalanceByEmployee(users.map((u) => u._id));

  return users
    .map((u) => ({
      id: String(u._id),
      name: u.fullName?.trim() || u.username,
      role: u.role,
      salary: round2(u.perks?.salary ?? 0),
      owed: balances.get(String(u._id)) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Staff advances
// ---------------------------------------------------------------------------

export interface AdvanceInput {
  userId: string;
  advanceDate: Date | string;
  amount: number;
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: string;
  reference?: string;
  reason?: string;
}

export interface AdvanceView {
  id: string;
  advanceNo?: number;
  reference: string;
  userId: string;
  name: string;
  advanceDate: Date;
  amount: number;
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: string;
  paymentReference?: string;
  reason?: string;
  status: 'draft' | 'posted' | 'cancelled';
  journalEntryId?: string;
  cancelReason?: string;
  /** What this employee still owes across every advance — read from the ledger. */
  employeeBalance: number;
  createdAt: Date;
}

function advanceToView(advance: IStaffAdvance, balance: number): AdvanceView {
  return {
    id: String(advance._id),
    advanceNo: advance.advanceNo,
    reference: advanceReference(advance.advanceNo),
    userId: String(advance.userId),
    name: advance.name,
    advanceDate: advance.advanceDate,
    amount: round2(advance.amount),
    method: advance.method,
    paidFromLedgerId: String(advance.paidFromLedgerId),
    paymentReference: advance.reference,
    reason: advance.reason,
    status: advance.status,
    journalEntryId: advance.journalEntryId ? String(advance.journalEntryId) : undefined,
    cancelReason: advance.cancelReason,
    employeeBalance: balance,
    createdAt: advance.createdAt,
  };
}

async function advanceDetail(id: string): Promise<AdvanceView> {
  const advance = await StaffAdvanceModel.findById(id).exec();
  if (!advance) throw notFound('Advance not found');
  const balances = await advanceBalanceByEmployee([advance.userId]);
  return advanceToView(advance, balances.get(String(advance.userId)) ?? 0);
}

export async function listAdvances(
  filters: { status?: 'draft' | 'posted' | 'cancelled' | 'all'; userId?: string } = {},
): Promise<AdvanceView[]> {
  const query: Record<string, unknown> = {};
  if (filters.status && filters.status !== 'all') query.status = filters.status;
  if (filters.userId && Types.ObjectId.isValid(filters.userId)) {
    query.userId = new Types.ObjectId(filters.userId);
  }

  const advances = await StaffAdvanceModel.find(query)
    .sort({ advanceDate: -1, createdAt: -1 })
    .limit(500)
    .exec();
  const balances = await advanceBalanceByEmployee(advances.map((a) => a.userId));

  return advances.map((a) => advanceToView(a, balances.get(String(a.userId)) ?? 0));
}

/** Everyone who still owes an advance, most owed first — the list payroll recovers against. */
export async function advanceBalances(): Promise<{ userId: string; name: string; owed: number }[]> {
  const advances = await StaffAdvanceModel.find({ status: 'posted' }).select('userId name').lean().exec();
  const ids = [...new Map(advances.map((a) => [String(a.userId), a])).values()];
  const balances = await advanceBalanceByEmployee(ids.map((a) => a.userId));

  return ids
    .map((a) => ({
      userId: String(a.userId),
      name: a.name,
      owed: balances.get(String(a.userId)) ?? 0,
    }))
    .filter((row) => Math.abs(row.owed) >= MONEY_EPSILON)
    .sort((a, b) => b.owed - a.owed);
}

async function prepareAdvance(input: AdvanceInput) {
  if (!Types.ObjectId.isValid(input.userId)) throw badRequest('That is not an employee.');
  const user = await UserModel.findById(input.userId).select('_id fullName username isActive isTrashed').lean().exec();
  if (!user || user.isTrashed) throw badRequest('That employee does not exist.');
  if (!user.isActive) {
    throw badRequest(
      `${user.fullName?.trim() || user.username} is not an active employee. An advance to somebody `
        + 'who has left is not going to be recovered from pay.',
    );
  }

  const advanceDate = new Date(input.advanceDate);
  if (Number.isNaN(advanceDate.getTime())) throw badRequest('The date is not a date.');

  const amount = round2(input.amount);
  if (!(amount > MONEY_EPSILON)) throw badRequest('An advance has to be for something.');

  if (input.method !== 'cash' && input.method !== 'bank_transfer') {
    throw badRequest('Say whether it was handed over in cash or sent by bank transfer.');
  }
  const paidFrom = await loadPaidFromAccount(input.paidFromLedgerId);

  return {
    userId: user._id,
    name: user.fullName?.trim() || user.username,
    advanceDate,
    amount,
    method: input.method,
    paidFromLedgerId: paidFrom._id,
    reference: input.reference?.trim() || undefined,
    reason: input.reason?.trim() || undefined,
  };
}

export async function createAdvance(input: AdvanceInput, actorId?: string): Promise<AdvanceView> {
  const prepared = await prepareAdvance(input);

  const advance = await StaffAdvanceModel.create({
    ...prepared,
    status: 'draft',
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'staff_advance',
    entityId: String(advance._id),
    action: 'created',
    meta: { to: prepared.name, amount: prepared.amount },
  });

  return advanceDetail(String(advance._id));
}

export async function updateAdvance(
  id: string,
  input: AdvanceInput,
  actorId?: string,
): Promise<AdvanceView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Advance not found');
  const advance = await StaffAdvanceModel.findById(id).exec();
  if (!advance) throw notFound('Advance not found');
  if (advance.status !== 'draft') {
    throw badRequest(`This advance is ${advance.status} and cannot be edited.`);
  }

  const prepared = await prepareAdvance(input);
  Object.assign(advance, prepared, { updatedBy: actorId ? new Types.ObjectId(actorId) : undefined });
  advance.reference = prepared.reference;
  advance.reason = prepared.reason;
  await advance.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'staff_advance',
    entityId: id,
    action: 'updated',
    meta: { to: prepared.name, amount: prepared.amount },
  });

  return advanceDetail(id);
}

export async function deleteAdvance(id: string, actorId?: string): Promise<{ message: string }> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Advance not found');
  const advance = await StaffAdvanceModel.findById(id).lean().exec();
  if (!advance) throw notFound('Advance not found');
  if (advance.status !== 'draft') {
    throw badRequest(
      `This advance is ${advance.status}. A posted advance is cancelled, never deleted — money `
        + 'that changed hands stays on the record.',
    );
  }

  await StaffAdvanceModel.deleteOne({ _id: advance._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'staff_advance',
    entityId: id,
    action: 'deleted',
    meta: { amount: advance.amount },
  });

  return { message: 'Draft advance deleted' };
}

/**
 * Hand the advance over.
 *
 *     Dr  Advances to Staff   against that employee
 *         Cr  Cash / Bank
 *
 * No expense: the money is owed back, and becomes wages only when a payroll run recovers it.
 */
export async function postAdvance(id: string, actorId?: string): Promise<AdvanceView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Advance not found');

  return withFinanceLocks([`staff-advance:${id}`], async () => {
    const advance = await StaffAdvanceModel.findById(id).exec();
    if (!advance) throw notFound('Advance not found');
    if (advance.status === 'posted') return advanceDetail(id);
    if (advance.status !== 'draft') {
      throw badRequest(`This advance is ${advance.status} and cannot be posted.`);
    }

    const staffAdvances = await ledgerIdForRole('staffAdvances');

    const entry = await postEntry(
      {
        date: advance.advanceDate,
        narration: `Advance to ${advance.name}`,
        referenceNo: advance.reference,
        sourceType: 'staff_advance',
        sourceId: id,
        sourceModel: 'StaffAdvance',
        idempotencyKey: buildIdempotencyKey('staff_advance', id, 'paid'),
        lines: [
          {
            ledgerId: staffAdvances,
            debit: advance.amount,
            subledgerRef: { type: 'employee', id: String(advance.userId) },
          },
          { ledgerId: String(advance.paidFromLedgerId), credit: advance.amount },
        ],
      },
      actorId,
    );

    if (!advance.advanceNo) advance.advanceNo = await allocateNextFinanceNo('financeAdvanceNo');
    advance.status = 'posted';
    advance.journalEntryId = entry._id;
    advance.postedAt = new Date();
    advance.postedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    await advance.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'staff_advance',
      entityId: id,
      action: 'posted',
      meta: { advanceNo: advance.advanceNo, to: advance.name, amount: advance.amount },
    });

    return advanceDetail(id);
  });
}

export async function cancelAdvance(
  id: string,
  reason: string,
  actorId?: string,
): Promise<AdvanceView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Advance not found');

  return withFinanceLocks([`staff-advance:${id}`], async () => {
    const advance = await StaffAdvanceModel.findById(id).exec();
    if (!advance) throw notFound('Advance not found');
    if (advance.status === 'cancelled') throw conflict('This advance has already been cancelled.');
    if (advance.status !== 'posted') {
      throw badRequest('This advance was never posted. Delete the draft instead.');
    }

    // Part of it may already have come off a month's pay. Reversing the whole advance would then
    // leave the employee owing a negative amount — money the business never lent them.
    const balances = await advanceBalanceByEmployee([advance.userId]);
    const owed = balances.get(String(advance.userId)) ?? 0;
    if (advance.amount - owed > MONEY_EPSILON) {
      throw badRequest(
        `${advance.name} owes only ${owed.toFixed(2)} now, so this ${advance.amount.toFixed(2)} `
          + 'advance has already been recovered from their pay and cannot be cancelled.',
      );
    }

    if (advance.journalEntryId) {
      const entry = await JournalEntryModel.findById(advance.journalEntryId).select('status').lean().exec();
      if (entry && entry.status === 'posted') {
        await reverseEntry(String(advance.journalEntryId), { reason }, actorId);
      }
    }

    advance.status = 'cancelled';
    advance.cancelledAt = new Date();
    advance.cancelledBy = actorId ? new Types.ObjectId(actorId) : undefined;
    advance.cancelReason = reason.trim();
    await advance.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'staff_advance',
      entityId: id,
      action: 'cancelled',
      meta: { advanceNo: advance.advanceNo, amount: advance.amount, reason: reason.trim() },
    });

    return advanceDetail(id);
  });
}
