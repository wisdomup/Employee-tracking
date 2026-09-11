/**
 * Receivables ageing, payables ageing and party statements, against an in-memory MongoDB.
 *
 * The receivables side is fixed to 2025 dates so every age is worked out by hand; the payables side
 * is relative to today, because a payables ageing is always as at today. The properties that
 * matter: the receivables ageing always totals to the receivables balance on its date, recoveries
 * clear the OLDEST credit first, and a supplier whose documents disagree with the ledger is flagged
 * rather than trusted.
 *
 * Run with: npm run test:finance:party-reports
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { DealerModel } from '../../models/dealer.model';
import { VendorModel } from '../../models/vendor.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { SupplierPaymentModel } from '../../models/supplier-payment.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry, reverseEntry, periodKeyFor } from './posting.service';
import { balanceSheet } from './financial-statements.service';
import * as reports from './party-reports.service';
import * as bills from './bills.service';
import * as payments from './payments.service';
import * as vendors from './vendors.service';

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
const DAY = 86_400_000;

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

function on(day: string): Date {
  return new Date(`${day}T08:00:00Z`);
}

let seq = 0;

/** Positive: the shop owes more (a credit sale). Negative: the shop paid. */
async function shopEntry(day: string, dealerId: string, amount: number) {
  seq += 1;
  const ar = await ledgerId('1140');
  const ref = { type: 'dealer', id: dealerId };
  const lines = amount > 0
    ? [
      { ledgerId: ar, debit: amount, subledgerRef: ref },
      { ledgerId: await ledgerId('4110'), credit: amount },
    ]
    : [
      { ledgerId: await ledgerId('1110'), debit: -amount },
      { ledgerId: ar, credit: -amount, subledgerRef: ref },
    ];
  return postEntry(
    { date: on(day), narration: amount > 0 ? 'Credit sale' : 'Recovery', idempotencyKey: `test:shop:${seq}`, lines },
    ACTOR,
  );
}

async function openQuietly(period: string): Promise<void> {
  try {
    await openPeriod(period, ACTOR);
  } catch {
    // Already open.
  }
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-party-reports-flow-test' });
  await Promise.all([
    VendorModel.syncIndexes(),
    PurchaseBillModel.syncIndexes(),
    SupplierPaymentModel.syncIndexes(),
  ]);
  await seedFinanceCounters();
  await seedFinanceChart();

  for (const p of ['2025-05', '2025-06', '2025-08', '2025-09']) await openQuietly(p);
  const now = new Date();
  for (let back = 0; back <= 120; back += 20) await openQuietly(periodKeyFor(new Date(now.getTime() - back * DAY)));
  await openQuietly(periodKeyFor(now));

  const ali = await DealerModel.create({ name: 'Ali', shopName: 'Ali General Store', phone: '03000000001', address: { city: 'Lahore' } });
  const bano = await DealerModel.create({ name: 'Bano', shopName: 'Bano Mart', phone: '03000000002' });
  const chaudhry = await DealerModel.create({ name: 'Chaudhry', phone: '03000000003' });
  const [A, B, C] = [String(ali._id), String(bano._id), String(chaudhry._id)];

  await shopEntry('2025-06-15', A, 10000);
  await shopEntry('2025-08-20', A, 5000);
  await shopEntry('2025-09-25', A, 3000);
  await shopEntry('2025-09-26', A, -12000);
  await shopEntry('2025-09-01', B, 2000);
  await shopEntry('2025-09-02', B, -2500);
  const chaudhrySale = await shopEntry('2025-05-01', C, 4000);

  // -------------------------------------------------------------------------
  // Oldest first
  // -------------------------------------------------------------------------

  await test('a payment clears the oldest credit first', async () => {
    const { open, unapplied } = reports.applyOldestFirst([
      { day: '2025-01-01', amount: 100 },
      { day: '2025-02-01', amount: 200 },
      { day: '2025-03-01', amount: -250 },
    ]);
    assert.deepEqual(open, [{ day: '2025-02-01', amount: 50 }]);
    assert.equal(unapplied, 0);
  });

  await test('an advance pays the next credit before anything is left open', async () => {
    const { open, unapplied } = reports.applyOldestFirst([
      { day: '2025-01-01', amount: -100 },
      { day: '2025-02-01', amount: 300 },
    ]);
    assert.deepEqual(open, [{ day: '2025-02-01', amount: 200 }]);
    assert.equal(unapplied, 0);
  });

  // -------------------------------------------------------------------------
  // Receivables ageing
  // -------------------------------------------------------------------------

  await test('each shop’s credit is aged by when it was taken, recoveries off the oldest', async () => {
    const ageing = await reports.receivablesAgeing({ asOf: '2025-09-30' });
    assert.deepEqual(ageing.buckets.map((b) => b.label), ['0–30', '31–60', '61–90', 'Over 90']);

    const aliRow = ageing.rows.find((r) => r.dealerId === A)!;
    // The 12,000 recovery cleared June's 10,000 and 2,000 of August's 5,000.
    assert.deepEqual(aliRow.amounts, [3000, 3000, 0, 0]);
    assert.equal(aliRow.total, 6000);
    assert.equal(aliRow.oldestDay, '2025-08-20');
    assert.equal(aliRow.city, 'Lahore');

    assert.deepEqual(ageing.rows.find((r) => r.dealerId === C)!.amounts, [0, 0, 0, 4000]);
    assert.deepEqual(ageing.rows.map((r) => r.dealerId), [A, C], 'not sorted by what is owed');
  });

  await test('a shop that paid more than it owed is listed as holding credit', async () => {
    const ageing = await reports.receivablesAgeing({ asOf: '2025-09-30' });
    assert.equal(ageing.rows.some((r) => r.dealerId === B), false);
    assert.deepEqual(ageing.inCredit.map((c) => [c.dealerId, c.amount]), [[B, 500]]);
  });

  await test('the ageing totals to the receivables balance on its date', async () => {
    const ageing = await reports.receivablesAgeing({ asOf: '2025-09-30' });
    assert.deepEqual(ageing.bucketTotals, [3000, 3000, 0, 4000]);
    assert.equal(ageing.totalOwed, 10000);
    assert.equal(ageing.totalInCredit, 500);
    assert.equal(ageing.netReceivable, 9500);

    const bs = await balanceSheet({ asOf: '2025-09' });
    const ar = bs.assets.flatMap((s) => [...s.lines, ...s.sections.flatMap((x) => x.lines)]).find((l) => l.code === '1140');
    assert.equal(ar!.amount, ageing.netReceivable, 'the ageing and the ledger disagree');
  });

  await test('an earlier date ages what was open then', async () => {
    const ageing = await reports.receivablesAgeing({ asOf: '2025-08-31' });
    const aliRow = ageing.rows.find((r) => r.dealerId === A)!;
    // June's 10,000 was 77 days old; August's 5,000 was 11.
    assert.deepEqual(aliRow.amounts, [5000, 0, 10000, 0]);
    assert.equal(ageing.rows.some((r) => r.dealerId === B), false, 'a later sale was aged');
  });

  await test('a reversal counts from the day it was posted, not before', async () => {
    await reverseEntry(String(chaudhrySale._id), { reason: 'Sale recorded against the wrong shop' }, ACTOR);

    const then = await reports.receivablesAgeing({ asOf: '2025-09-30' });
    assert.ok(then.rows.some((r) => r.dealerId === C), 'history was rewritten by a later reversal');

    const today = await reports.receivablesAgeing();
    assert.equal(today.rows.some((r) => r.dealerId === C), false);
    assert.equal(today.netReceivable, 5500);
  });

  await test('a malformed date is refused', async () => {
    await rejectsWith(reports.receivablesAgeing({ asOf: '30/09/2025' }), /not a date/);
  });

  // -------------------------------------------------------------------------
  // Party statements
  // -------------------------------------------------------------------------

  await test('a shop’s statement opens with everything before the range', async () => {
    const st = await reports.partyStatement({ type: 'dealer', id: A, from: '2025-08-01', to: '2025-09-30' });
    assert.equal(st.party.name, 'Ali');
    assert.equal(st.opening, 10000);
    assert.deepEqual(st.rows.map((r) => r.balance), [15000, 18000, 6000]);
    assert.equal(st.closing, 6000);
    assert.equal(st.ledgerCode, '1140');
  });

  await test('without a range, the statement is the whole account', async () => {
    const st = await reports.partyStatement({ type: 'dealer', id: A });
    assert.equal(st.opening, 0);
    assert.equal(st.rows.length, 4);
    assert.equal(st.closing, 6000);
  });

  await test('a statement refuses a backwards range, a wrong type, and an unknown shop', async () => {
    await rejectsWith(
      reports.partyStatement({ type: 'dealer', id: A, from: '2025-09-30', to: '2025-08-01' }),
      /after the end date/,
    );
    await rejectsWith(
      reports.partyStatement({ type: 'rider' as reports.PartyType, id: A }),
      /shop or a supplier/,
    );
    await rejectsWith(
      reports.partyStatement({ type: 'dealer', id: String(new Types.ObjectId()) }),
      /Shop not found/,
    );
  });

  await test('the statement picker lists only shops with something on their account', async () => {
    await DealerModel.create({ name: 'Never Bought Anything', phone: '03000000009' });
    const list = await reports.partiesWithActivity('dealer');
    assert.deepEqual(list.map((p) => p.name), ['Ali', 'Bano', 'Chaudhry']);
  });

  // -------------------------------------------------------------------------
  // Payables ageing
  // -------------------------------------------------------------------------

  const acme = await vendors.createVendor({ name: 'Acme Traders' }, ACTOR);
  const freight = await ledgerId('6150');
  const bank = await ledgerId('1120');

  const oldBillDate = new Date(now.getTime() - 100 * DAY);
  const oldBill = await bills.createBill(
    {
      vendorId: acme.id,
      supplierBillNo: 'OLD-1',
      billDate: oldBillDate,
      dueDate: new Date(oldBillDate.getTime() + 30 * DAY),
      lines: [{ description: 'Freight', ledgerId: freight, amount: 3000 }],
    },
    ACTOR,
  );
  await bills.postBill(oldBill.id, ACTOR);

  const newBill = await bills.createBill(
    {
      vendorId: acme.id,
      supplierBillNo: 'NEW-1',
      billDate: new Date(now.getTime() - 10 * DAY),
      dueDate: new Date(now.getTime() + 20 * DAY),
      lines: [{ description: 'Freight', ledgerId: freight, amount: 1500 }],
    },
    ACTOR,
  );
  await bills.postBill(newBill.id, ACTOR);

  for (const [amount, allocations] of [
    [1000, [{ billId: oldBill.id, amount: 1000 }]],
    [500, []],
  ] as const) {
    const draft = await payments.createPayment(
      {
        vendorId: acme.id,
        paymentDate: now,
        method: 'bank_transfer',
        paidFromLedgerId: bank,
        amount,
        allocations: [...allocations],
      },
      ACTOR,
    );
    await payments.postPayment(draft.id, ACTOR);
  }

  await test('what is owed to a supplier is aged by days past the due date', async () => {
    const ageing = await reports.payablesAgeing();
    assert.deepEqual(ageing.buckets.map((b) => b.label), ['1–30', '31–60', '61–90', 'Over 90']);

    const row = ageing.rows.find((r) => r.vendorId === acme.id)!;
    assert.equal(row.notDue, 1500);
    // 3,000 less the 1,000 paid against it, 70 days past due.
    assert.deepEqual(row.overdue, [0, 0, 2000, 0]);
  });

  await test('money paid on account reduces the total without clearing any bill', async () => {
    const row = (await reports.payablesAgeing()).rows.find((r) => r.vendorId === acme.id)!;
    assert.equal(row.onAccount, -500);
    assert.equal(row.total, 3000);
    assert.equal(row.ledgerBalance, 3000);
    assert.equal(row.agrees, true);
  });

  await test('a supplier’s statement runs from their bills to their payments', async () => {
    const st = await reports.partyStatement({ type: 'vendor', id: acme.id });
    assert.equal(st.ledgerCode, '2110');
    assert.deepEqual(st.rows.map((r) => r.balance), [3000, 4500, 3500, 3000]);
    assert.equal(st.closing, 3000);
  });

  await test('a supplier whose documents disagree with the ledger is flagged, not trusted', async () => {
    // Something reached the payables account that is not a bill or a payment.
    await postEntry(
      {
        date: now,
        narration: 'Posted to payables outside a bill',
        idempotencyKey: 'test:stray-payable',
        lines: [
          { ledgerId: freight, debit: 200 },
          { ledgerId: await ledgerId('2110'), credit: 200, subledgerRef: { type: 'vendor', id: acme.id } },
        ],
      },
      ACTOR,
    );

    const ageing = await reports.payablesAgeing();
    const row = ageing.rows.find((r) => r.vendorId === acme.id)!;
    assert.equal(row.total, 3000);
    assert.equal(row.ledgerBalance, 3200);
    assert.equal(row.agrees, false);
    assert.equal(ageing.disagreements, 1);
  });

  await test('the supplier picker lists suppliers with something on their account', async () => {
    const list = await reports.partiesWithActivity('vendor');
    assert.deepEqual(list.map((p) => p.name), ['Acme Traders']);
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
