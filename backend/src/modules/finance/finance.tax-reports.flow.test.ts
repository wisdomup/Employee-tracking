/**
 * The tax summary, against an in-memory MongoDB.
 *
 * The report works nothing out — there is no rate anywhere in it — so the only thing that can be
 * wrong is the arithmetic and, more importantly, the reconciliation between the two sides:
 *
 *   the TOTALS come from the accounts, because that is what the books say;
 *   the SUPPLIER BREAKDOWN comes from the documents, because a posting to the tax account
 *   carries no supplier on it.
 *
 * A return filed off a breakdown that does not add up to the accounts is a return that disagrees
 * with the books. So the difference has to be found and named, and that is what most of this
 * file checks.
 *
 * Run with: npm run test:finance:tax
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { ExpenseModel } from '../../models/expense.model';
import { ExpenseCategoryModel } from '../../models/expense-category.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry } from './posting.service';
import * as vendors from './vendors.service';
import { taxSummary } from './tax-reports.service';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok   ${name}`);
}

let mongod: MongoMemoryServer;
const ACTOR = new Types.ObjectId();

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

const IN_WINDOW = new Date('2026-05-15T10:00:00Z');
const OUT_OF_WINDOW = new Date('2026-04-10T10:00:00Z');
const FROM = '2026-05-01';
const TO = '2026-05-31';

/** Input tax on the accounts, the way a bill or an expense puts it there. */
async function postInputTax(amount: number, date: Date, narration: string): Promise<void> {
  await postEntry(
    {
      date,
      narration,
      lines: [
        { ledgerId: await ledgerId('1170'), debit: amount },
        { ledgerId: await ledgerId('9190'), credit: amount },
      ],
    },
    String(ACTOR),
  );
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-tax-flow-test' });
  await seedFinanceCounters();
  await seedFinanceChart();
  await openPeriod('2026-04', String(ACTOR));
  await openPeriod('2026-05', String(ACTOR));
  // A reversal is dated TODAY, never the original's date, so the current month has to be open
  // for one to be posted at all.
  const now = new Date();
  await openPeriod(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    String(ACTOR),
  );

  const acme = await vendors.createVendor(
    { name: 'Acme Traders', taxRegistrationNo: '1234567-8' },
    String(ACTOR),
  );
  const noNumber = await vendors.createVendor({ name: 'Corner Shop Supplies' }, String(ACTOR));

  const category = await ExpenseCategoryModel.create({
    name: 'Fuel',
    ledgerId: new Types.ObjectId(await ledgerId('6120')),
    createdBy: ACTOR,
  });

  await test('an empty period reports nothing owed and nothing to claim', async () => {
    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.inputTax, 0);
    assert.equal(report.outputTax, 0);
    assert.equal(report.net, 0);
    assert.deepEqual(report.purchases, []);
  });

  await test('a nil sales-tax figure is explained rather than left looking broken', async () => {
    // Orders carry no tax field anywhere in this system, so nothing CAN post output tax. A zero
    // with no explanation reads as a missed posting.
    const report = await taxSummary({ from: FROM, to: TO });
    assert.ok(
      report.warnings.some((w) => /Orders carry no tax figure/.test(w)),
      'the nil output tax was not explained',
    );
  });

  await test('a posted bill puts its supplier on the purchase side', async () => {
    await PurchaseBillModel.create({
      vendorId: new Types.ObjectId(acme.id),
      supplierBillNo: 'INV-1',
      billDate: IN_WINDOW,
      dueDate: IN_WINDOW,
      lines: [],
      matchedReceipts: [],
      taxAmount: 170,
      totalAmount: 1170,
      status: 'posted',
      billNo: 1,
    });
    await postInputTax(170, IN_WINDOW, 'Input tax on INV-1');

    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.inputTax, 170);
    assert.equal(report.purchases.length, 1);

    const row = report.purchases[0];
    assert.equal(row.name, 'Acme Traders');
    assert.equal(row.taxRegistrationNo, '1234567-8');
    assert.equal(row.taxAmount, 170);
    assert.equal(row.taxableAmount, 1000, 'the amount before tax is wrong');
    assert.equal(row.filable, true);
  });

  await test('the accounts and the documents are reconciled, not assumed equal', async () => {
    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.purchasesTaxTotal, 170);
    assert.equal(report.unattributedInputTax, 0);
  });

  await test('a draft bill is not on a tax return', async () => {
    await PurchaseBillModel.create({
      vendorId: new Types.ObjectId(acme.id),
      supplierBillNo: 'DRAFT-1',
      billDate: IN_WINDOW,
      dueDate: IN_WINDOW,
      lines: [],
      matchedReceipts: [],
      taxAmount: 999,
      totalAmount: 6999,
      status: 'draft',
    });

    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.purchasesTaxTotal, 170, 'a draft was counted');
  });

  await test('a bill outside the period is not on this return', async () => {
    await PurchaseBillModel.create({
      vendorId: new Types.ObjectId(acme.id),
      supplierBillNo: 'INV-OLD',
      billDate: OUT_OF_WINDOW,
      dueDate: OUT_OF_WINDOW,
      lines: [],
      matchedReceipts: [],
      taxAmount: 500,
      totalAmount: 3500,
      status: 'posted',
      billNo: 2,
    });
    await postInputTax(500, OUT_OF_WINDOW, 'Input tax on INV-OLD');

    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.inputTax, 170, 'the accounts side leaked across the period boundary');
    assert.equal(report.purchasesTaxTotal, 170, 'the document side leaked across it');

    const wider = await taxSummary({ from: '2026-04-01', to: TO });
    assert.equal(wider.inputTax, 670);
    assert.equal(wider.purchasesTaxTotal, 670);
  });

  await test('an expense carries claimable tax too', async () => {
    await ExpenseModel.create({
      expenseDate: IN_WINDOW,
      categoryId: category._id,
      ledgerId: new Types.ObjectId(await ledgerId('6120')),
      vendorId: new Types.ObjectId(noNumber.id),
      description: 'Diesel',
      amount: 800,
      taxAmount: 136,
      totalAmount: 936,
      method: 'cash',
      paidFromLedgerId: new Types.ObjectId(await ledgerId('1110')),
      status: 'posted',
      createdBy: ACTOR,
    });
    await postInputTax(136, IN_WINDOW, 'Input tax on diesel');

    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.inputTax, 306);
    assert.equal(report.purchases.length, 2);

    const fuel = report.purchases.find((r) => r.name === 'Corner Shop Supplies')!;
    assert.equal(fuel.taxAmount, 136);
    // An expense's `amount` is already before tax, unlike a bill's total.
    assert.equal(fuel.taxableAmount, 800);
  });

  await test('a supplier with no tax number is named and counted as unfilable', async () => {
    const report = await taxSummary({ from: FROM, to: TO });
    const fuel = report.purchases.find((r) => r.name === 'Corner Shop Supplies')!;
    assert.equal(fuel.filable, false);
    assert.equal(fuel.taxRegistrationNo, undefined);

    assert.ok(
      report.warnings.some((w) => /no tax number on file, covering 136\.00/.test(w)),
      'the unfilable total was not named',
    );
  });

  await test('the biggest tax line is listed first', async () => {
    // Where a wrong or unfilable line costs the most.
    const report = await taxSummary({ from: FROM, to: TO });
    const amounts = report.purchases.map((r) => r.taxAmount);
    assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  });

  await test('tax in the accounts that is on no document is reported, not absorbed', async () => {
    /*
     * The check that makes this report worth reading.
     *
     * A manual journal entry touching the tax account appears in the totals and on no bill. File
     * a return from the breakdown and it will not agree with the books — so the difference is
     * worked out and named rather than left for somebody to find at the counter.
     */
    await postInputTax(50, IN_WINDOW, 'Tax adjustment posted by hand');

    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.inputTax, 356);
    assert.equal(report.purchasesTaxTotal, 306);
    assert.equal(report.unattributedInputTax, 50);
    assert.ok(
      report.warnings.some((w) => /50\.00 of tax on purchases is in the accounts but on no bill/.test(w)),
      'the difference was not named',
    );
  });

  await test('sales tax charged shows as payable, and nets against what was paid', async () => {
    await postEntry(
      {
        date: IN_WINDOW,
        narration: 'Sales tax charged on an invoice, entered by hand',
        lines: [
          { ledgerId: await ledgerId('9190'), debit: 500 },
          { ledgerId: await ledgerId('2120'), credit: 500 },
        ],
      },
      String(ACTOR),
    );

    const report = await taxSummary({ from: FROM, to: TO });
    assert.equal(report.outputTax, 500, 'output tax read the wrong way round');
    assert.equal(report.net, round(500 - 356), 'the net position is wrong');
    assert.ok(
      !report.warnings.some((w) => /Orders carry no tax figure/.test(w)),
      'the nil-sales-tax note was still shown when there was output tax',
    );
  });

  await test('the three tax accounts are named by id, not only by code', async () => {
    // The codes were always here for display. The ids are what lets a reader open the account and
    // see the postings behind the figure, instead of being told a number and having to trust it.
    const summary = await taxSummary({ from: FROM, to: TO });
    for (const [id, code] of [
      [summary.inputTaxLedgerId, summary.inputTaxCode],
      [summary.outputTaxLedgerId, summary.outputTaxCode],
      [summary.withheldTaxLedgerId, summary.withheldTaxCode],
    ] as const) {
      assert.match(id, /^[0-9a-f]{24}$/, `${code} has no account id`);
      const ledger = await LedgerModel.findById(id).select('code').lean().exec();
      assert.equal(ledger?.code, code, 'the id and the code must name the same account');
    }
  });

  await test('cancelling later does not restate a period already filed', async () => {
    /*
     * A reversal is dated the day it is made, never the original's date — deliberately, so that
     * reversing something does not silently change a month that has already been reported.
     *
     * The consequence for tax is the correct one and worth pinning down: May's return still shows
     * the tax that was on May's bill, because that is what was filed. The cancellation lands in
     * the month it happened and reduces THAT return, which is how a credit note behaves.
     */
    const before = await taxSummary({ from: FROM, to: TO });

    const { JournalEntryModel } = await import('../../models/journal-entry.model');
    const entry = await JournalEntryModel.findOne({ narration: 'Input tax on INV-1' }).lean();
    const { reverseEntry } = await import('./posting.service');
    await reverseEntry(String(entry!._id), { reason: 'Bill cancelled' }, String(ACTOR));

    const may = await taxSummary({ from: FROM, to: TO });
    assert.equal(may.inputTax, before.inputTax, 'a filed period was restated behind the reader');

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const current = await taxSummary({ from: `${month}-01`, to: `${month}-31` });
    assert.equal(current.inputTax, -170, 'the cancellation did not reduce the current period');
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
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
