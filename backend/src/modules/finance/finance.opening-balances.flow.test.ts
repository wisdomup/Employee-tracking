/**
 * The changeover, against an in-memory MongoDB.
 *
 * Two things here are worth more than the rest put together.
 *
 * One: `Ledger.openingBalance` is read by exactly one report and ignored by every other. A
 * figure left in it after a real opening entry is posted is counted twice on that one screen and
 * once everywhere else, for ever, with nothing to say why. Posting must clear it.
 *
 * Two: `3900 Opening Balance Equity` must end up nil. While it holds anything the changeover is
 * unfinished, and that zero is the only proof the migration was done properly.
 *
 * Run with: npm run test:finance:opening
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { VendorModel } from '../../models/vendor.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { trialBalance, ledgerStatement } from './journal.service';
import * as vendors from './vendors.service';
import * as opening from './opening-balances.service';

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

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean().exec();
  return Math.round((ledger?.cachedBalance ?? 0) * 100) / 100;
}

const CUTOVER = new Date('2026-06-30T00:00:00Z');

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-opening-flow-test' });
  await VendorModel.syncIndexes();
  await seedFinanceCounters();
  await seedFinanceChart();
  await openPeriod('2026-06', String(ACTOR));
  await openPeriod('2026-07', String(ACTOR));
  // A reversal is dated TODAY, never the original's date, so the current month has to be open
  // for one to be posted at all.
  const today = new Date();
  await openPeriod(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
    String(ACTOR),
  );

  const acme = await vendors.createVendor({ name: 'Acme Traders' }, String(ACTOR));
  const bilal = await vendors.createVendor({ name: 'Bilal & Sons' }, String(ACTOR));

  // -------------------------------------------------------------------------
  // The worksheet
  // -------------------------------------------------------------------------

  await test('nothing has happened yet', async () => {
    const status = await opening.migrationStatus();
    assert.equal(status.stage, 'not-started');
    assert.equal(status.booksOpenedAt, null);
    assert.equal(status.openingEquityBalance, 0);
  });

  await test('the worksheet offers every account, with control accounts locked', async () => {
    const sheet = await opening.worksheet();

    const bank = sheet.rows.find((r) => r.code === '1120')!;
    assert.equal(bank.editable, true);

    const receivables = sheet.rows.find((r) => r.code === '1140')!;
    assert.equal(receivables.editable, false);
    assert.match(receivables.note ?? '', /double what the shops owe/);

    const stock = sheet.rows.find((r) => r.code === '1150')!;
    assert.equal(stock.editable, false);
    assert.match(stock.note ?? '', /double the value of the stock/);
  });

  await test('the balancing account cannot be typed into', async () => {
    // An entry that balances because somebody worked the figure out by hand would balance just
    // as well when two of the other numbers were wrong.
    await rejectsWith(
      opening.saveWorksheet(
        [{ ledgerId: await ledgerId('3900'), amount: 100 }],
        String(ACTOR),
      ),
      /balancing figure/,
    );
  });

  await test('a control account cannot be typed into', async () => {
    await rejectsWith(
      opening.saveWorksheet([{ ledgerId: await ledgerId('1140'), amount: 50_000 }], String(ACTOR)),
      /kept by the module that owns it/,
    );
  });

  await test('payables are refused here and taken from the suppliers instead', async () => {
    await rejectsWith(
      opening.saveWorksheet([{ ledgerId: await ledgerId('2110'), amount: 10_000 }], String(ACTOR)),
      /Set it on the supplier instead/,
    );
  });

  await test('figures are staged without touching the accounts', async () => {
    const sheet = await opening.saveWorksheet(
      [
        { ledgerId: await ledgerId('1110'), amount: 50_000 },   // cash in hand
        { ledgerId: await ledgerId('1120'), amount: 400_000 },  // bank
        { ledgerId: await ledgerId('2210'), amount: 150_000 },  // loan owed
      ],
      String(ACTOR),
    );

    assert.equal(sheet.totalDebits, 450_000);
    assert.equal(sheet.totalCredits, 150_000);
    assert.equal(sheet.openingEquity, 300_000);

    const tb = await trialBalance();
    assert.equal(tb.rows.length, 0, 'staging wrote to the accounts');
  });

  await test("suppliers' own opening figures build the payables total", async () => {
    await vendors.updateVendor(
      acme.id,
      { openingBalance: { amount: 80_000, asOf: CUTOVER } },
      String(ACTOR),
    );
    await vendors.updateVendor(
      bilal.id,
      { openingBalance: { amount: 20_000, asOf: CUTOVER } },
      String(ACTOR),
    );

    const sheet = await opening.worksheet();
    const payables = sheet.rows.find((r) => r.code === '2110')!;
    assert.equal(payables.amount, 100_000);
    assert.equal(payables.editable, false);
    assert.equal(sheet.openingEquity, 200_000, 'net worth should now be 450k − 150k − 100k');
  });

  // -------------------------------------------------------------------------
  // Opening the books
  // -------------------------------------------------------------------------

  await test('the books cannot be opened on top of existing postings', async () => {
    // An opening balance and the transactions behind it describe the same money.
    const { postEntry } = await import('./posting.service');
    await postEntry(
      {
        date: new Date('2026-06-15T00:00:00Z'),
        narration: 'Something recorded before the changeover',
        lines: [
          { ledgerId: await ledgerId('1110'), debit: 1_000 },
          { ledgerId: await ledgerId('9190'), credit: 1_000 },
        ],
      },
      String(ACTOR),
    );

    await rejectsWith(
      opening.postOpeningEntry({ cutoverDate: CUTOVER }, String(ACTOR)),
      /already recorded on or before/,
    );

    // Wiped rather than reversed: a reversal would leave lines of its own behind, and what the
    // rest of this file needs is an empty set of books to open.
    await JournalLineModel.deleteMany({}).exec();
    await (await import('../../models/journal-entry.model')).JournalEntryModel.deleteMany({}).exec();
    await LedgerModel.updateMany(
      {},
      { $set: { cachedBalance: 0, cachedDebitTotal: 0, cachedCreditTotal: 0 } },
    ).exec();
  });

  let openingEntryId = '';

  await test('opening the books posts one balanced entry', async () => {
    const result = await opening.postOpeningEntry(
      { cutoverDate: CUTOVER, narration: 'Changeover to the new books' },
      String(ACTOR),
    );
    openingEntryId = result.entryId;

    assert.equal(result.totalDebit, 450_000);
    assert.equal(result.totalCredit, 450_000);
    assert.equal(result.openingEquity, 200_000);

    assert.equal(await balance('1110'), 50_000);
    assert.equal(await balance('1120'), 400_000);
    assert.equal(await balance('2210'), 150_000);
    assert.equal(await balance('2110'), 100_000);
    assert.equal(await balance('3900'), 200_000);
  });

  await test('payables are broken down by supplier from day one', async () => {
    // Without this the payables control account is one number nobody can take apart, and every
    // supplier statement starts wrong.
    const lines = await JournalLineModel.find({
      ledgerId: new Types.ObjectId(await ledgerId('2110')),
    }).lean();

    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.equal(line.subledgerRef?.type, 'vendor');
    }
    const total = lines.reduce((s, l) => s + l.credit, 0);
    assert.equal(total, 100_000);
  });

  await test('the staged figures are cleared, so no report counts them twice', async () => {
    // The point of the whole file. The ledger statement is the only report that reads this
    // field; everything else counts posted lines. Left set, the two disagree for ever.
    const stillStaged = await LedgerModel.countDocuments({
      'openingBalance.amount': { $ne: 0 },
    }).exec();
    assert.equal(stillStaged, 0, 'an opening figure was left behind in the staging field');

    const statement = await ledgerStatement(await ledgerId('1120'));
    assert.equal(statement.opening, 0, 'the statement would have added the figure again');
    assert.equal(statement.closing, 400_000);
  });

  await test('the trial balance balances', async () => {
    const tb = await trialBalance();
    assert.equal(tb.totalDebit, 450_000);
    assert.equal(tb.totalCredit, 450_000);
    assert.equal(tb.balanced, true);
  });

  await test('the changeover date is recorded and the books read as open', async () => {
    const status = await opening.migrationStatus();
    assert.equal(status.stage, 'balances-entered');
    assert.ok(status.booksOpenedAt);
    assert.equal(status.cutoverDate?.toISOString(), CUTOVER.toISOString());
  });

  await test('the books cannot be opened twice', async () => {
    await rejectsWith(
      opening.postOpeningEntry({ cutoverDate: CUTOVER }, String(ACTOR)),
      /already been opened/,
    );
  });

  await test('the worksheet is read-only once the books are open', async () => {
    const sheet = await opening.worksheet();
    assert.ok(sheet.rows.every((r) => !r.editable));

    await rejectsWith(
      opening.saveWorksheet([{ ledgerId: await ledgerId('1110'), amount: 1 }], String(ACTOR)),
      /already been posted/,
    );
  });

  // -------------------------------------------------------------------------
  // Finishing it
  // -------------------------------------------------------------------------

  await test('the changeover figure can only go to an equity account', async () => {
    await rejectsWith(
      opening.closeOpeningEquity(await ledgerId('1120'), String(ACTOR)),
      /not an equity account/,
    );
  });

  await test("carrying it to the owner's capital finishes the changeover", async () => {
    const status = await opening.closeOpeningEquity(await ledgerId('3110'), String(ACTOR));

    assert.equal(status.stage, 'complete');
    assert.equal(status.openingEquityBalance, 0, 'the proof the migration is finished');
    assert.equal(await balance('3110'), 200_000);

    const tb = await trialBalance();
    assert.equal(tb.balanced, true);
  });

  await test('it cannot be carried across twice', async () => {
    await rejectsWith(
      opening.closeOpeningEquity(await ledgerId('3110'), String(ACTOR)),
      /already nil/,
    );
  });

  // -------------------------------------------------------------------------
  // Getting it wrong
  // -------------------------------------------------------------------------

  await test('work posted after the changeover blocks reopening it', async () => {
    const { postEntry, reverseEntry } = await import('./posting.service');
    const later = await postEntry(
      {
        date: new Date('2026-07-05T00:00:00Z'),
        narration: 'Trading since the changeover',
        lines: [
          { ledgerId: await ledgerId('1110'), debit: 500 },
          { ledgerId: await ledgerId('9190'), credit: 500 },
        ],
      },
      String(ACTOR),
    );

    await rejectsWith(
      opening.reopenMigration('Wrong figures', String(ACTOR)),
      /recorded since the changeover/,
    );

    await reverseEntry(String(later._id), { reason: 'Test cleanup' }, String(ACTOR));
  });

  await test('reopening needs a reason', async () => {
    await rejectsWith(opening.reopenMigration('  ', String(ACTOR)), /Say why/);
  });

  await test('reopening reverses both entries and restores the worksheet', async () => {
    const sheet = await opening.reopenMigration('Bank figure was wrong', String(ACTOR));

    assert.equal(sheet.status.stage, 'not-started');
    assert.equal(sheet.status.booksOpenedAt, null);
    assert.equal(sheet.status.cutoverDate, null);

    // Reversed, not deleted — the mistake and its correction both stay on the record.
    assert.equal(await balance('1120'), 0);
    assert.equal(await balance('3110'), 0);
    assert.equal(await balance('3900'), 0);

    // And the figures come back so they can be corrected rather than retyped.
    const bank = sheet.rows.find((r) => r.code === '1120')!;
    assert.equal(bank.amount, 400_000);
    assert.equal(bank.editable, true);

    const loan = sheet.rows.find((r) => r.code === '2210')!;
    assert.equal(loan.amount, 150_000, 'a liability came back the wrong way round');
  });

  await test('a reversal is not mistaken for the changeover still standing', async () => {
    // A reversal COPIES the sourceType and referenceNo of the entry it undoes and is itself
    // posted. Without excluding reversals, this would report the books as still open.
    const status = await opening.migrationStatus();
    assert.equal(status.stage, 'not-started');
    assert.equal(status.openingEntryId, null);
  });

  await test('the corrected figures can be posted, on a key the first attempt did not burn', async () => {
    await opening.saveWorksheet(
      [{ ledgerId: await ledgerId('1120'), amount: 390_000 }],
      String(ACTOR),
    );

    const result = await opening.postOpeningEntry({ cutoverDate: CUTOVER }, String(ACTOR));
    assert.equal(result.totalDebit, 440_000);
    assert.equal(await balance('1120'), 390_000);

    const tb = await trialBalance();
    assert.equal(tb.balanced, true, 'the books do not balance after the correction');
  });

  await test('the settings record the changeover for every other screen to read', async () => {
    const settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).lean();
    assert.ok(settings!.booksOpenedAt);
    assert.equal(settings!.cutoverDate?.toISOString(), CUTOVER.toISOString());
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
