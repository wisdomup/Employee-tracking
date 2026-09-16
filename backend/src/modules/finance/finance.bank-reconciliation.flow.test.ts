/**
 * Bank reconciliation, against an in-memory MongoDB.
 *
 * The value of this screen is entirely in one refusal: it will not sign off a statement that
 * does not balance. A reconciliation completed with a gap still open is worse than never having
 * reconciled at all — it puts on file that the bank agreed when it did not, and the next person
 * has no reason to look again. Most of what is tested below is that refusal and the ways round
 * it that must not work.
 *
 * Run with: npm run test:finance:bank-rec
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { BankReconciliationModel } from '../../models/bank-reconciliation.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry } from './posting.service';
import * as bankRec from './bank-reconciliation.service';

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
const ACTOR = new Types.ObjectId();

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

/** A movement on the bank account, with the other leg parked somewhere harmless. */
async function bankMovement(narration: string, amount: number, date: Date): Promise<void> {
  const bank = await ledgerId('1120');
  const other = await ledgerId('9190');

  await postEntry(
    {
      date,
      narration,
      lines:
        amount > 0
          ? [
            { ledgerId: bank, debit: amount },
            { ledgerId: other, credit: amount },
          ]
          : [
            { ledgerId: other, debit: -amount },
            { ledgerId: bank, credit: -amount },
          ],
    },
    String(ACTOR),
  );
}

async function lineIdsFor(narrations: string[]): Promise<string[]> {
  const bank = await ledgerId('1120');
  const lines = await JournalLineModel.find({ ledgerId: new Types.ObjectId(bank) })
    .populate<{ journalEntryId: { narration: string } }>('journalEntryId', 'narration')
    .lean()
    .exec();

  return lines
    .filter((l) => narrations.includes((l.journalEntryId as unknown as { narration: string }).narration))
    .map((l) => String(l._id));
}

const JAN = new Date('2026-01-10T10:00:00Z');
const JAN_END = new Date('2026-01-31T00:00:00Z');
const FEB = new Date('2026-02-05T10:00:00Z');
const FEB_END = new Date('2026-02-28T00:00:00Z');

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-bank-rec-flow-test' });
  await BankReconciliationModel.syncIndexes();
  await seedFinanceCounters();
  await seedFinanceChart();

  await openPeriod('2026-01', String(ACTOR));
  await openPeriod('2026-02', String(ACTOR));

  const bank = await ledgerId('1120');

  // January: 100,000 in, 30,000 out, and a 12,000 cheque the bank has not seen yet.
  await bankMovement('Customer deposit', 100_000, JAN);
  await bankMovement('Rent paid', -30_000, JAN);
  await bankMovement('Supplier cheque in flight', -12_000, new Date('2026-01-29T10:00:00Z'));

  // -------------------------------------------------------------------------
  // Starting one
  // -------------------------------------------------------------------------

  await test('only cash and bank accounts can be reconciled', async () => {
    // Reconciling Sales against a bank statement is meaningless, and letting somebody try would
    // produce a difference they could never close.
    await rejectsWith(
      bankRec.createReconciliation(
        {
          ledgerId: await ledgerId('4110'),
          statementDate: JAN_END,
          statementClosingBalance: 0,
        },
        String(ACTOR),
      ),
      /not a cash or bank account/,
    );
  });

  await test('the accounts worth reconciling are listed with their progress', async () => {
    const accounts = await bankRec.reconcilableAccounts();
    const codes = accounts.map((a) => a.code);
    assert.deepEqual(codes, ['1110', '1120'], 'only the cash-marked accounts should be offered');

    const account = accounts.find((a) => a.code === '1120')!;
    assert.equal(account.currentBalance, 58_000);
    assert.equal(account.lastStatementDate, null);
    assert.equal(account.openDraftId, null);
  });

  let janId = '';

  await test('the worksheet carries every line up to the statement date', async () => {
    const rec = await bankRec.createReconciliation(
      {
        ledgerId: bank,
        statementDate: JAN_END,
        // The bank has not seen the cheque: 100,000 − 30,000.
        statementClosingBalance: 70_000,
      },
      String(ACTOR),
    );

    janId = rec.id;
    assert.equal(rec.status, 'draft');
    assert.equal(rec.lines.length, 3);
    assert.equal(rec.bookBalance, 58_000);
    assert.equal(rec.clearedCount, 0);
  });

  await test('a deposit reads positive and a payment negative', async () => {
    const rec = await bankRec.getReconciliation(janId);
    const deposit = rec.lines.find((l) => l.narration === 'Customer deposit')!;
    const rent = rec.lines.find((l) => l.narration === 'Rent paid')!;

    assert.equal(deposit.effect, 100_000);
    assert.equal(rent.effect, -30_000);
  });

  await test('nothing ticked means the whole book balance is still in flight', async () => {
    const rec = await bankRec.getReconciliation(janId);
    assert.equal(rec.unclearedTotal, 58_000);
    assert.equal(rec.expectedStatementBalance, 0);
    assert.equal(rec.difference, 70_000);
    assert.equal(rec.balances, false);
  });

  await test('two reconciliations for one account and date are refused', async () => {
    await rejectsWith(
      bankRec.createReconciliation(
        { ledgerId: bank, statementDate: JAN_END, statementClosingBalance: 70_000 },
        String(ACTOR),
      ),
      /already a reconciliation/,
    );
  });

  // -------------------------------------------------------------------------
  // Ticking off
  // -------------------------------------------------------------------------

  await test('ticking the two the bank listed closes the difference', async () => {
    const ids = await lineIdsFor(['Customer deposit', 'Rent paid']);
    const rec = await bankRec.setClearedLines(janId, ids, true, String(ACTOR));

    assert.equal(rec.clearedTotal, 70_000);
    assert.equal(rec.unclearedTotal, -12_000, 'the cheque should be what is left in flight');
    assert.equal(rec.expectedStatementBalance, 70_000);
    assert.equal(rec.difference, 0);
    assert.equal(rec.balances, true);
  });

  await test('a line can be unticked again while it is a draft', async () => {
    const ids = await lineIdsFor(['Rent paid']);
    const off = await bankRec.setClearedLines(janId, ids, false, String(ACTOR));
    assert.equal(off.balances, false);

    const back = await bankRec.setClearedLines(janId, ids, true, String(ACTOR));
    assert.equal(back.balances, true);
  });

  await test('ticking the same line twice does not count it twice', async () => {
    const ids = await lineIdsFor(['Customer deposit']);
    const rec = await bankRec.setClearedLines(janId, ids, true, String(ACTOR));
    assert.equal(rec.clearedTotal, 70_000, 'the deposit was counted again');
  });

  await test('a line from another account cannot be ticked off here', async () => {
    const cashLine = await JournalLineModel.findOne({
      ledgerId: new Types.ObjectId(await ledgerId('9190')),
    }).lean();

    await rejectsWith(
      bankRec.setClearedLines(janId, [String(cashLine!._id)], true, String(ACTOR)),
      /not on this account/,
    );
  });

  await test('a line dated after the statement cannot be ticked off against it', async () => {
    // The bank could not have seen it, so counting it would close a gap that is really there.
    await bankMovement('February deposit', 5_000, FEB);
    const ids = await lineIdsFor(['February deposit']);

    await rejectsWith(
      bankRec.setClearedLines(janId, ids, true, String(ACTOR)),
      /dated after the statement/,
    );
  });

  // -------------------------------------------------------------------------
  // Signing off
  // -------------------------------------------------------------------------

  await test('one that does not balance is refused, and the message says which way', async () => {
    const wrong = await bankRec.updateReconciliation(
      janId,
      { statementClosingBalance: 71_500 },
      String(ACTOR),
    );
    assert.equal(wrong.difference, 1_500);

    await rejectsWith(
      bankRec.completeReconciliation(janId, String(ACTOR)),
      /difference of 1500\.00 that the bank has and the books do not/,
    );

    await bankRec.updateReconciliation(janId, { statementClosingBalance: 70_000 }, String(ACTOR));
  });

  await test('a balanced one signs off and freezes its figures', async () => {
    const done = await bankRec.completeReconciliation(janId, String(ACTOR));
    assert.equal(done.status, 'completed');
    assert.ok(done.completedAt);

    const stored = await BankReconciliationModel.findById(janId).lean();
    assert.equal(stored!.closedBookBalance, 58_000);
    assert.equal(stored!.closedUnclearedTotal, -12_000);
  });

  await test('a signed-off one cannot be edited or discarded', async () => {
    await rejectsWith(
      bankRec.updateReconciliation(janId, { statementClosingBalance: 1 }, String(ACTOR)),
      /has been signed off/,
    );
    await rejectsWith(bankRec.deleteReconciliation(janId, String(ACTOR)), /has been signed off/);
  });

  await test('its figures do not move when an entry is back-dated into the period', async () => {
    // A signed-off reconciliation whose numbers change under the reader is not evidence of
    // anything, and nothing on the row would say it had changed.
    await bankMovement('Late January charge', -400, new Date('2026-01-20T10:00:00Z'));

    const rows = await bankRec.listReconciliations({ ledgerId: bank, status: 'completed' });
    const january = rows.find((r) => r.id === janId)!;
    assert.equal(january.bookBalance, 58_000, 'the frozen book balance moved');
    assert.equal(january.difference, 0);
  });

  // -------------------------------------------------------------------------
  // The next statement
  // -------------------------------------------------------------------------

  let febId = '';

  await test('the next statement does not re-offer what January settled', async () => {
    const rec = await bankRec.createReconciliation(
      {
        ledgerId: bank,
        statementDate: FEB_END,
        statementClosingBalance: 0,
      },
      String(ACTOR),
    );
    febId = rec.id;

    const narrations = rec.lines.map((l) => l.narration).sort();
    assert.deepEqual(
      narrations,
      ['February deposit', 'Late January charge', 'Supplier cheque in flight'],
      'January\'s cleared lines came back, or something was dropped',
    );
  });

  await test('an old uncleared item is still carried, however long it sits', async () => {
    // A cheque written in January and never presented is exactly what this screen must not lose.
    const rec = await bankRec.getReconciliation(febId);
    assert.ok(rec.lines.some((l) => l.narration === 'Supplier cheque in flight'));
  });

  await test("January's lines cannot be ticked off a second time on February", async () => {
    const ids = await lineIdsFor(['Customer deposit']);
    await rejectsWith(
      bankRec.setClearedLines(febId, ids, true, String(ACTOR)),
      /already accounted for by an earlier statement/,
    );
  });

  await test('February balances once the cheque finally presents', async () => {
    const ids = await lineIdsFor([
      'Supplier cheque in flight',
      'Late January charge',
      'February deposit',
    ]);
    await bankRec.setClearedLines(febId, ids, true, String(ACTOR));

    // Book: 58,000 − 400 + 5,000 = 62,600, and the bank has now seen all of it.
    const rec = await bankRec.updateReconciliation(
      febId,
      { statementClosingBalance: 62_600 },
      String(ACTOR),
    );

    assert.equal(rec.bookBalance, 62_600);
    assert.equal(rec.unclearedTotal, 0);
    assert.equal(rec.difference, 0);

    const done = await bankRec.completeReconciliation(febId, String(ACTOR));
    assert.equal(done.status, 'completed');
  });

  // -------------------------------------------------------------------------
  // Going backwards
  // -------------------------------------------------------------------------

  await test('a statement cannot be started behind one already signed off', async () => {
    await rejectsWith(
      bankRec.createReconciliation(
        {
          ledgerId: bank,
          statementDate: new Date('2026-02-15T00:00:00Z'),
          statementClosingBalance: 0,
        },
        String(ACTOR),
      ),
      /already been reconciled up to/,
    );
  });

  await test('January cannot be reopened while February stands on top of it', async () => {
    await rejectsWith(
      bankRec.reopenReconciliation(janId, 'Wrong statement', String(ACTOR)),
      /was reconciled after this one/,
    );
  });

  await test('reopening needs a reason', async () => {
    await rejectsWith(bankRec.reopenReconciliation(febId, '  ', String(ACTOR)), /Say why/);
  });

  await test('reopening the latest one puts its lines back in play', async () => {
    const reopened = await bankRec.reopenReconciliation(febId, 'Bank reissued the statement', String(ACTOR));
    assert.equal(reopened.status, 'draft');
    assert.equal(reopened.reopenReason, 'Bank reissued the statement');

    // Still ticked — reopening returns it to the worksheet, it does not wipe the work.
    assert.equal(reopened.clearedCount, 3);
    assert.equal(reopened.balances, true);

    // And now January is free to reopen behind it.
    const janReopened = await bankRec.reopenReconciliation(janId, 'Correcting a figure', String(ACTOR));
    assert.equal(janReopened.status, 'draft');
  });

  await test('the reopened January can be signed off again', async () => {
    const done = await bankRec.completeReconciliation(janId, String(ACTOR));
    assert.equal(done.status, 'completed');
    assert.equal(done.reopenReason, undefined, 'the reopen note should not outlive the reopening');
  });

  await test('nothing here ever wrote a journal entry', async () => {
    // The whole module reports and refuses; it never repairs. A reconciliation screen that could
    // post its own balancing figure would be able to make any statement agree with anything.
    const { JournalEntryModel } = await import('../../models/journal-entry.model');
    const invented = await JournalEntryModel.countDocuments({
      sourceType: { $nin: ['manual'] },
    }).exec();
    assert.equal(invented, 0, 'something posted an entry');

    const balance = await LedgerModel.findById(bank).select('cachedBalance').lean();
    assert.equal(Math.round(balance!.cachedBalance * 100) / 100, 62_600);
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
