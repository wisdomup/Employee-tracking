/**
 * Payroll and staff advances, against an in-memory MongoDB.
 *
 * Two employees, one advance of 60,000, and a month's wages — chosen so every refusal has something
 * real to catch: recovering more than was advanced, recovering more than the month pays, paying more
 * wages than are owed, cancelling a month that has been paid, and cancelling an advance that has
 * already come off somebody's pay.
 *
 * Run with: npm run test:finance:payroll
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { UserModel } from '../../models/user.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { POSTING_EVENT_KEYS } from '../../models/finance-settings.model';
import { ROLES } from '../../constants/global';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { periodKeyFor } from './posting.service';
import { runControlReconciliation } from './control-reconciliation.service';
import * as payroll from './payroll.service';
import { RiderFineModel } from '../../models/rider-fine.model';
import * as freeze from '../account-freeze/account-freeze.service';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok   ${name}`);
}

async function rejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    assert.match((err as Error).message ?? String(err), pattern);
    return;
  }
  assert.fail(`Expected rejection matching ${pattern}, but it resolved`);
}

let mongod: MongoMemoryServer;
const ACTOR = String(new Types.ObjectId());

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean().exec();
  return Math.round((ledger?.cachedBalance ?? 0) * 100) / 100;
}

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

let staffSeq = 0;
async function staff(
  fullName: string,
  perks: { salary?: number; bonus?: number; allowance?: number },
  isActive = true,
) {
  staffSeq += 1;
  return UserModel.create({
    userID: `EMP-${staffSeq}`,
    username: fullName.toLowerCase().replace(/\s+/g, '.'),
    fullName,
    phone: `030000000${staffSeq}`,
    password: 'not-a-real-password',
    role: ROLES.EMPLOYEE,
    perks,
    isActive,
  });
}

function lineFor(run: payroll.PayrollRunDetail, name: string) {
  const line = run.lines.find((l) => l.name === name);
  assert.ok(line, `${name} is not on the run`);
  return line!;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-payroll-flow-test' });
  await seedFinanceCounters();
  await seedFinanceChart();

  for (const period of ['2025-07', '2025-08', periodKeyFor(new Date())]) {
    try {
      await openPeriod(period, ACTOR);
    } catch {
      // Already open.
    }
  }

  const asif = await staff('Asif Khan', { salary: 50000, bonus: 5000, allowance: 2000 });
  await staff('Bilal Ahmed', { salary: 30000 });
  const chand = await staff('Chand Bibi', { salary: 20000 }, false);
  await staff('Dawood Ali', {});

  const cash = await ledgerId('1110');
  const bank = await ledgerId('1120');

  let julyId = '';

  // -------------------------------------------------------------------------
  // Preparing the month
  // -------------------------------------------------------------------------

  await test('a run is pre-filled from what each employee is paid', async () => {
    const run = await payroll.createRun('2025-07', ACTOR);
    julyId = run.id;

    assert.deepEqual(run.lines.map((l) => l.name), ['Asif Khan', 'Bilal Ahmed']);
    assert.equal(lineFor(run, 'Asif Khan').gross, 57000);
    assert.equal(run.totals.gross, 87000);
    assert.equal(run.totals.net, 87000, 'nothing is recovered until somebody says so');
    assert.equal(run.status, 'draft');
    assert.equal(run.periodLabel, 'July 2025');
  });

  await test('somebody who has left, and somebody with no pay recorded, are left out', async () => {
    const run = await payroll.getRun(julyId);
    assert.equal(run.lines.some((l) => l.name === 'Chand Bibi'), false, 'an inactive employee was included');
    assert.equal(run.lines.some((l) => l.name === 'Dawood Ali'), false, 'somebody with no pay was included');
  });

  await test('a month is only run once', async () => {
    await rejectsWith(payroll.createRun('2025-07', ACTOR), /already a draft payroll run for July 2025/);
  });

  await test('a draft posts nothing', async () => {
    assert.equal(await balance('6110'), 0);
    assert.equal(await balance('2130'), 0);
  });

  // -------------------------------------------------------------------------
  // An advance
  // -------------------------------------------------------------------------

  let advanceId = '';

  await test('an advance is a debt, not a cost', async () => {
    const draft = await payroll.createAdvance(
      {
        userId: String(asif._id),
        advanceDate: new Date('2025-07-05T08:00:00Z'),
        amount: 60000,
        method: 'cash',
        paidFromLedgerId: cash,
        reason: 'School fees',
      },
      ACTOR,
    );
    advanceId = draft.id;
    assert.equal(draft.status, 'draft');
    assert.equal(await balance('1180'), 0, 'a draft advance moved money');

    const posted = await payroll.postAdvance(advanceId, ACTOR);
    assert.equal(posted.reference, 'A-0001');
    assert.equal(posted.employeeBalance, 60000);

    assert.equal(await balance('1180'), 60000);
    assert.equal(await balance('1110'), -60000);
    assert.equal(await balance('6110'), 0, 'an advance was charged as wages');
  });

  await test('an advance to somebody who has left is refused', async () => {
    await rejectsWith(
      payroll.createAdvance(
        {
          userId: String(chand._id),
          advanceDate: new Date('2025-07-05T08:00:00Z'),
          amount: 1000,
          method: 'cash',
          paidFromLedgerId: cash,
        },
        ACTOR,
      ),
      /not an active employee/,
    );
  });

  // -------------------------------------------------------------------------
  // Recovering it
  // -------------------------------------------------------------------------

  await test('a run cannot take back more than the employee owes', async () => {
    await rejectsWith(
      payroll.updateRun(julyId, { lines: [{ userId: String(asif._id), advanceRecovery: 70000 }] }, ACTOR),
      /owes 60000\.00 in advances/,
    );
  });

  await test('a run cannot take back more than the month pays', async () => {
    await rejectsWith(
      payroll.updateRun(julyId, { lines: [{ userId: String(asif._id), advanceRecovery: 60000 }] }, ACTOR),
      /is paid 57000\.00 this month/,
    );
  });

  await test('correcting a draft recomputes what everyone takes home', async () => {
    const run = await payroll.getRun(julyId);
    const bilal = run.lines.find((l) => l.name === 'Bilal Ahmed')!;

    const updated = await payroll.updateRun(
      julyId,
      {
        lines: [
          { userId: String(asif._id), advanceRecovery: 6000 },
          { userId: bilal.userId, bonus: 1000 },
        ],
      },
      ACTOR,
    );

    assert.equal(lineFor(updated, 'Asif Khan').net, 51000);
    assert.equal(lineFor(updated, 'Bilal Ahmed').gross, 31000);
    assert.deepEqual(
      [updated.totals.salary, updated.totals.bonus, updated.totals.allowance],
      [80000, 6000, 2000],
    );
    assert.equal(updated.totals.gross, 88000);
    assert.equal(updated.totals.advanceRecovery, 6000);
    assert.equal(updated.totals.net, 82000);
  });

  // -------------------------------------------------------------------------
  // Posting the month
  // -------------------------------------------------------------------------

  await test('posting records the wage bill and what is owed to staff', async () => {
    const posted = await payroll.postRun(julyId, ACTOR);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.outstanding, 82000);

    assert.equal(await balance('6110'), 80000, 'salaries');
    assert.equal(await balance('6115'), 8000, 'bonus and allowances');
    assert.equal(await balance('1180'), 54000, 'the advance was not reduced by the recovery');
    assert.equal(await balance('2130'), 82000, 'net pay owed');
  });

  await test('the wage bill lands in the month it was for, not the day it was posted', async () => {
    const entry = await JournalEntryModel.findOne({ sourceType: 'payroll_accrual', sourceId: julyId }).lean();
    assert.equal(entry!.postingPeriod, '2025-07');
  });

  await test('wages are handed over in instalments', async () => {
    const first = await payroll.recordPayment(
      julyId,
      { paidOn: new Date('2025-08-01T08:00:00Z'), amount: 50000, method: 'cash', paidFromLedgerId: cash },
      ACTOR,
    );
    assert.equal(first.paidAmount, 50000);
    assert.equal(first.outstanding, 32000);
    assert.equal(await balance('2130'), 32000);
    assert.equal(await balance('1110'), -110000);

    await rejectsWith(
      payroll.recordPayment(
        julyId,
        { paidOn: new Date('2025-08-02T08:00:00Z'), amount: 40000, method: 'cash', paidFromLedgerId: cash },
        ACTOR,
      ),
      /has 32000\.00 left to pay/,
    );

    const second = await payroll.recordPayment(
      julyId,
      { paidOn: new Date('2025-08-07T08:00:00Z'), amount: 32000, method: 'bank_transfer', paidFromLedgerId: bank },
      ACTOR,
    );
    assert.equal(second.outstanding, 0);
    assert.equal(await balance('2130'), 0);
    assert.equal(await balance('1120'), -32000);

    await rejectsWith(
      payroll.recordPayment(
        julyId,
        { paidOn: new Date('2025-08-08T08:00:00Z'), amount: 1000, method: 'cash', paidFromLedgerId: cash },
        ACTOR,
      ),
      /already been paid in full/,
    );
  });

  await test('a posted run cannot be edited or deleted', async () => {
    await rejectsWith(
      payroll.updateRun(julyId, { lines: [{ userId: String(asif._id), bonus: 99 }] }, ACTOR),
      /cannot be edited/,
    );
    await rejectsWith(payroll.deleteRun(julyId, ACTOR), /never deleted/);
  });

  await test('a month whose wages have been paid cannot be cancelled', async () => {
    await rejectsWith(payroll.cancelRun(julyId, 'Wrong figures', ACTOR), /already been paid/);
  });

  await test('an advance already recovered from pay cannot be cancelled', async () => {
    await rejectsWith(payroll.cancelAdvance(advanceId, 'Handed back', ACTOR), /already been recovered/);
  });

  await test('what each employee still owes is read from the ledger', async () => {
    const balances = await payroll.advanceBalances();
    assert.deepEqual(balances, [{ userId: String(asif._id), name: 'Asif Khan', owed: 54000 }]);
  });

  await test('the books agree on advances and on wages owed', async () => {
    const { checks } = await runControlReconciliation();

    const advances = checks.find((c) => c.checkId === 'staff-advances')!;
    assert.deepEqual(
      [advances.breakdown.handedOver, advances.breakdown.recoveredFromPay, advances.operationalValue],
      [60000, 6000, 54000],
    );
    assert.equal(advances.ok, true);

    const wages = checks.find((c) => c.checkId === 'salaries-payable')!;
    assert.deepEqual([wages.breakdown.netPay, wages.breakdown.handedOver], [82000, 82000]);
    assert.equal(wages.operationalValue, 0);
    assert.equal(wages.ok, true);
  });

  // -------------------------------------------------------------------------
  // A month that was posted in error
  // -------------------------------------------------------------------------

  await test('an unpaid month can be cancelled, and the wage bill comes back off', async () => {
    const august = await payroll.createRun('2025-08', ACTOR);
    await payroll.postRun(august.id, ACTOR);
    assert.equal(await balance('2130'), 87000);
    assert.equal(await balance('6110'), 160000);

    const cancelled = await payroll.cancelRun(august.id, 'Posted before the overtime was added', ACTOR);
    assert.equal(cancelled.status, 'cancelled');

    assert.equal(await balance('2130'), 0);
    assert.equal(await balance('6110'), 80000, 'the reversal did not take the wages back off');
    assert.equal(await balance('6115'), 8000);
  });

  await test('a cancelled month frees that month to be run again', async () => {
    const again = await payroll.createRun('2025-08', ACTOR);
    assert.equal(again.status, 'draft');
    assert.equal(again.period, '2025-08');
  });

  await test('there is no switch for payroll — posting the month is the decision', async () => {
    assert.equal((POSTING_EVENT_KEYS as readonly string[]).includes('payroll'), false);
  });

  // -------------------------------------------------------------------------
  // Late-start fines, recovered from pay
  // -------------------------------------------------------------------------

  /** Charges a late-start fine, the way the freeze rule does. */
  async function charge(employeeId: Types.ObjectId, amount: number, day: string) {
    return RiderFineModel.create({
      employeeId,
      type: 'late_start_freeze',
      fineDate: new Date(`${day}T00:00:00.000Z`),
      amount,
      reason: 'Late start — no shop check-in by 12:30 PM.',
      status: 'outstanding',
      source: 'sweep',
      issuedAt: new Date(`${day}T08:00:00.000Z`),
    });
  }

  const rider = await staff('Imran Shah', { salary: 40000 });
  let septemberId = '';

  for (const month of ['2025-09', '2025-10']) {
    try {
      await openPeriod(month, ACTOR);
    } catch {
      // Already open.
    }
  }

  await test('a fine is pre-filled as a deduction, unlike an advance', async () => {
    await charge(rider._id as Types.ObjectId, 200, '2025-09-02');
    await charge(rider._id as Types.ObjectId, 300, '2025-09-09');

    const run = await payroll.createRun('2025-09', ACTOR);
    septemberId = run.id;
    const line = lineFor(run, 'Imran Shah');

    // A fine is simply owed, unlike an advance repaid on agreed terms — and a deduction nobody
    // remembers to type is a fine that is never collected.
    assert.equal(line.fineRecovery, 500);
    assert.equal(line.fineBalance, 500);
    assert.equal(line.net, 39500);
    assert.equal(run.totals.fineRecovery, 500);
  });

  await test('a waived fine is never deducted', async () => {
    const other = await staff('Junaid Butt', { salary: 25000 });
    const waived = await charge(other._id as Types.ObjectId, 200, '2025-09-03');
    await RiderFineModel.updateOne({ _id: waived._id }, { $set: { status: 'waived' } }).exec();

    const balances = await freeze.fineBalanceByEmployee([other._id as Types.ObjectId]);
    assert.equal(balances.get(String(other._id)) ?? 0, 0);
  });

  await test('a run cannot take off more in fines than was charged', async () => {
    await rejectsWith(
      payroll.updateRun(
        septemberId,
        { lines: [{ userId: String(rider._id), fineRecovery: 900 }] },
        ACTOR,
      ),
      /owes 500\.00 in late-start fines/,
    );
  });

  await test('the two deductions are checked together against the pay, not one at a time', async () => {
    // 40,000 of pay, a 39,800 advance recovery and a 500 fine: each fits on its own, the pair
    // does not, and a negative payslip is money claimed off somebody who worked all month.
    const draft = await payroll.createAdvance(
      {
        userId: String(rider._id),
        advanceDate: new Date('2025-09-04T08:00:00Z'),
        amount: 39800,
        method: 'cash',
        paidFromLedgerId: cash,
      },
      ACTOR,
    );
    await payroll.postAdvance(draft.id, ACTOR);

    await rejectsWith(
      payroll.updateRun(
        septemberId,
        { lines: [{ userId: String(rider._id), advanceRecovery: 39800, fineRecovery: 500 }] },
        ACTOR,
      ),
      /takes back 40300\.00/,
    );
  });

  await test('posting the month books the fines as income, not as a smaller wage bill', async () => {
    const beforeWages = await balance('6110');
    const beforeFines = await balance('4220');
    const before = await payroll.getRun(septemberId);

    const posted = await payroll.postRun(septemberId, ACTOR);

    assert.equal(posted.status, 'posted');
    assert.equal(posted.totals.fineRecovery, 500);
    // The wage bill is the FULL cost of employing people; the fine is income beside it, so
    // netting it into 6110 would understate two figures to shorten one entry.
    assert.equal(await balance('6110'), beforeWages + before.totals.salary);
    assert.equal(await balance('4220'), beforeFines + 500);
    // And the fine is not handed over with the wages.
    assert.equal(posted.totals.net, posted.totals.gross - posted.totals.advanceRecovery - 500);
  });

  await test('a recovered fine stops being owed, and says it was recovered', async () => {
    const status = await freeze.getFreezeStatus(String(rider._id));

    assert.equal(status.outstandingFines, 0, 'the rider is still being told they owe it');
    assert.equal(status.finesRecovered, 500);
    // The charges themselves stay on the record — both fines are still readable.
    assert.equal(status.outstandingFineCount, 2);
  });

  await test('the same fine cannot be taken off a second month', async () => {
    const october = await payroll.createRun('2025-10', ACTOR);
    assert.equal(lineFor(october, 'Imran Shah').fineRecovery, 0);
    await payroll.deleteRun(october.id, ACTOR);
  });

  await test('a fine already deducted from pay cannot be waived', async () => {
    const fine = await RiderFineModel.findOne({
      employeeId: rider._id,
      status: 'outstanding',
    }).lean().exec();

    // The money has left the payslip and nothing on the freeze screen can hand it back; the
    // admin is told to refund it as a bonus instead of being given a button that half works.
    await rejectsWith(
      freeze.waiveFine(String(fine!._id), ACTOR),
      /already been deducted from their pay/,
    );
  });

  await test('cancelling the month puts the fines back on the rider', async () => {
    await payroll.cancelRun(septemberId, 'Wrong month', ACTOR);

    const balances = await freeze.fineBalanceByEmployee([rider._id as Types.ObjectId]);
    // Nothing was written back: what is owed is derived from posted runs, and there are none.
    assert.equal(balances.get(String(rider._id)), 500);
    assert.equal(await balance('4220'), 0);
  });

  await test('and the fine can be waived again once the recovery is released', async () => {
    const fine = await RiderFineModel.findOne({
      employeeId: rider._id,
      status: 'outstanding',
      amount: 200,
    }).lean().exec();

    const waived = await freeze.waiveFine(String(fine!._id), ACTOR);
    assert.equal(waived.status, 'waived');

    // The activity log is fire-and-forget, and this is the last write of the suite: without a
    // beat to let it land, it reaches a connection main() has already closed and prints a
    // failure after the results.
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  });
}

main()
  .then(async () => {
    // eslint-disable-next-line no-console
    console.log(`\n  ${passed} checks passed\n`);
    await mongoose.disconnect();
    await mongod.stop();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(`\n  FAILED after ${passed} checks:\n`, err);
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(1);
  });
