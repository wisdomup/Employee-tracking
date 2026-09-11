/**
 * The Profit & Loss statement and the Balance Sheet, against an in-memory MongoDB.
 *
 * Every figure below is worked out by hand from eight entries, so a statement that disagrees with
 * the arithmetic fails here rather than in front of the owner. The one property that matters most:
 * the Balance Sheet balances, in every month, with no year-end close ever having run.
 *
 * Run with: npm run test:finance:statements
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry, reverseEntry, periodKeyFor } from './posting.service';
import { trialBalance } from './journal.service';
import * as statements from './financial-statements.service';

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

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

/** Mid-month, mid-morning UTC, so no timezone can move it into a neighbouring month. */
function on(day: string): Date {
  return new Date(`${day}T08:00:00Z`);
}

async function post(day: string, debitCode: string, creditCode: string, amount: number) {
  return postEntry(
    {
      date: on(day),
      narration: `${debitCode} / ${creditCode}`,
      lines: [
        { ledgerId: await ledgerId(debitCode), debit: amount },
        { ledgerId: await ledgerId(creditCode), credit: amount },
      ],
    },
    ACTOR,
  );
}

function findLine(sections: statements.StatementSection[], code: string): statements.StatementLine | undefined {
  for (const s of sections) {
    const hit = s.lines.find((l) => l.code === code) ?? findLine(s.sections, code);
    if (hit) return hit;
  }
  return undefined;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-statements-flow-test' });
  await seedFinanceCounters();
  await seedFinanceChart();

  for (const period of ['2025-06', '2025-07', '2025-08', periodKeyFor(new Date())]) {
    await openPeriod(period, ACTOR);
  }

  // Fiscal year 2024-25 (July start) — the year BEFORE the one under test.
  await post('2025-06-10', '1110', '3110', 100000); // owner puts in capital
  await post('2025-06-20', '1110', '4110', 20000); //  a sale
  await post('2025-06-25', '6130', '1110', 5000); //   rent
  // → profit for 2024-25: 15,000

  // Fiscal year 2025-26.
  await post('2025-07-05', '1120', '4110', 50000); //  a sale
  await post('2025-07-06', '4120', '1120', 2000); //   goods returned — contra income
  await post('2025-07-10', '5110', '1120', 30000); //  cost of goods sold
  const rent = await post('2025-08-01', '6130', '1110', 5000); // rent
  await post('2025-08-02', '1120', '2210', 40000); //  a loan
  // → Jul–Aug: income 48,000, cost of sales 30,000, gross 18,000, rent 5,000, net 13,000

  // -------------------------------------------------------------------------
  // Profit & Loss
  // -------------------------------------------------------------------------

  await test('profit is income, less cost of sales, less operating expenses', async () => {
    const pl = await statements.profitAndLoss({ from: '2025-07', to: '2025-08' });

    assert.equal(pl.incomeTotal, 48000, 'returns did not reduce income');
    assert.equal(findLine(pl.income, '4120')!.amount, -2000);
    assert.equal(pl.costOfSalesTotal, 30000);
    assert.equal(pl.grossProfit, 18000);
    assert.equal(pl.operatingExpensesTotal, 5000);
    assert.equal(pl.netProfit, 13000);
    assert.deepEqual(pl.warnings, []);
  });

  await test('cost of sales is found by the engine role, not by the account code', async () => {
    const pl = await statements.profitAndLoss({ from: '2025-07', to: '2025-08' });
    assert.equal(pl.costOfSales.length, 1);
    assert.ok(findLine(pl.costOfSales, '5110'), 'COGS was not under cost of sales');
    assert.equal(findLine(pl.operatingExpenses, '5110'), undefined, 'COGS was counted as an operating expense');
  });

  await test('the default is the fiscal year to date', async () => {
    const pl = await statements.profitAndLoss({ to: '2025-08' });
    assert.equal(pl.from, '2025-07', 'the fiscal year did not start in July');
    assert.equal(pl.fiscalYear, '2025-26');
    assert.equal(pl.netProfit, 13000);
  });

  await test('the comparison is the window of the same length just before', async () => {
    const pl = await statements.profitAndLoss({ from: '2025-07', to: '2025-08', compare: true });
    assert.equal(pl.compareFrom, '2025-05');
    assert.equal(pl.compareTo, '2025-06');
    assert.equal(pl.compare!.incomeTotal, 20000);
    assert.equal(pl.compare!.netProfit, 15000);
    assert.equal(findLine(pl.operatingExpenses, '6130')!.compare, 5000);
  });

  await test('accounts with nothing on them are left out unless asked for', async () => {
    const quiet = await statements.profitAndLoss({ from: '2025-07', to: '2025-08' });
    assert.equal(findLine(quiet.operatingExpenses, '6120'), undefined, 'an empty account was listed');

    const full = await statements.profitAndLoss({ from: '2025-07', to: '2025-08', showZero: true });
    assert.ok(findLine(full.operatingExpenses, '6120'), 'showZero did not list every account');
    assert.equal(full.netProfit, 13000, 'listing empty accounts changed the figures');
  });

  await test('a malformed or backwards range is refused', async () => {
    await rejectsWith(statements.profitAndLoss({ from: '2025-13', to: '2025-12' }), /not a month/);
    await rejectsWith(statements.profitAndLoss({ from: '2025-09', to: '2025-07' }), /after the end month/);
  });

  // -------------------------------------------------------------------------
  // Balance Sheet
  // -------------------------------------------------------------------------

  await test('the Balance Sheet balances with no year-end close ever run', async () => {
    const bs = await statements.balanceSheet({ asOf: '2025-08' });

    // Cash 100,000 + 20,000 − 5,000 − 5,000; bank 50,000 − 2,000 − 30,000 + 40,000.
    assert.equal(findLine(bs.assets, '1110')!.amount, 110000);
    assert.equal(findLine(bs.assets, '1120')!.amount, 58000);
    assert.equal(bs.totalAssets, 168000);
    assert.equal(bs.totalLiabilities, 40000);

    assert.equal(bs.equityAccountsTotal, 100000);
    assert.equal(bs.profitBroughtForward, 15000, 'last year’s profit went missing');
    assert.equal(bs.profitThisYear, 13000);
    assert.equal(bs.totalEquity, 128000);

    assert.equal(bs.balanced, true, `out by ${bs.difference}`);
    assert.deepEqual(bs.warnings, []);
  });

  await test('at the last month of a fiscal year, all its profit is this year’s', async () => {
    const bs = await statements.balanceSheet({ asOf: '2025-06' });
    assert.equal(bs.fiscalYear, '2024-25');
    assert.equal(bs.profitBroughtForward, 0);
    assert.equal(bs.profitThisYear, 15000);
    assert.equal(bs.balanced, true);
  });

  await test('the statements agree with the trial balance', async () => {
    // Different code paths over the same lines. If they ever disagree, one of them is wrong.
    const tb = await trialBalance();
    const tbCash = tb.rows.find((r: { code: string }) => r.code === '1110') as { closingDebit: number };
    const bs = await statements.balanceSheet({ asOf: periodKeyFor(new Date()) });
    assert.equal(findLine(bs.assets, '1110')!.amount, tbCash.closingDebit);
  });

  // -------------------------------------------------------------------------
  // Reversals
  // -------------------------------------------------------------------------

  await test('a reversal lands in the month it was posted, not the month it undoes', async () => {
    // Reversing into August would restate a month already reported. It lands today instead.
    await reverseEntry(String(rent._id), { reason: 'Rent was paid by the landlord’s agent' }, ACTOR);

    const august = await statements.profitAndLoss({ from: '2025-07', to: '2025-08' });
    assert.equal(august.netProfit, 13000, 'a reversal restated a past month');

    const thisMonth = periodKeyFor(new Date());
    const now = await statements.profitAndLoss({ from: thisMonth, to: thisMonth });
    assert.equal(findLine(now.operatingExpenses, '6130')!.amount, -5000);
  });

  await test('the Balance Sheet still balances after the reversal', async () => {
    const bs = await statements.balanceSheet({ asOf: periodKeyFor(new Date()) });
    assert.equal(bs.balanced, true, `out by ${bs.difference}`);
    assert.equal(findLine(bs.assets, '1110')!.amount, 115000, 'the rent did not come back');
  });

  // -------------------------------------------------------------------------
  // Warnings
  // -------------------------------------------------------------------------

  await test('non-zero Opening Balance Equity and Suspense are called out', async () => {
    const thisMonth = periodKeyFor(new Date());
    const day = new Date().toISOString().slice(0, 10);
    await post(day, '1110', '3900', 1000);
    await post(day, '9190', '1110', 250);

    const bs = await statements.balanceSheet({ asOf: thisMonth });
    assert.equal(bs.balanced, true, 'a warning is not an imbalance');
    assert.ok(bs.warnings.some((w) => /Opening Balance Equity reads 1000\.00/.test(w)));
    assert.ok(bs.warnings.some((w) => /Suspense reads 250\.00/.test(w)));
  });

  await test('every statement line came from a posted or reversed line, nothing else', async () => {
    const drafts = await JournalEntryModel.countDocuments({ status: 'draft' });
    assert.equal(drafts, 0, 'the fixture left a draft that could hide a counting bug');
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
