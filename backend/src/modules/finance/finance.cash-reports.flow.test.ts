/**
 * Cash flow and the cash & bank position, against an in-memory MongoDB.
 *
 * Ten entries over two months, chosen so each rule has something to catch: a transfer between cash
 * and bank, a sale on credit, a cheque written in one week and cleared in another, a vehicle bought,
 * a loan taken. Every figure is worked out by hand in the comments.
 *
 * Run with: npm run test:finance:cash-reports
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry, reverseEntry, periodKeyFor } from './posting.service';
import { balanceSheet } from './financial-statements.service';
import * as cash from './cash-reports.service';

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
const SHOP = String(new Types.ObjectId());
const SUPPLIER = String(new Types.ObjectId());

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

function on(day: string): Date {
  return new Date(`${day}T08:00:00Z`);
}

let seq = 0;

interface Leg {
  code: string;
  amount: number;
  ref?: { type: string; id: string };
}

async function post(day: string, debit: Leg, credit: Leg) {
  seq += 1;
  return postEntry(
    {
      date: on(day),
      narration: `${debit.code} / ${credit.code}`,
      // Keyed, so the engine treats it as a system posting and control accounts are allowed.
      idempotencyKey: `test:cash:${seq}`,
      lines: [
        { ledgerId: await ledgerId(debit.code), debit: debit.amount, subledgerRef: debit.ref ?? null },
        { ledgerId: await ledgerId(credit.code), credit: credit.amount, subledgerRef: credit.ref ?? null },
      ],
    },
    ACTOR,
  );
}

const dr = (code: string, amount: number, ref?: Leg['ref']): Leg => ({ code, amount, ref });
const cr = dr;

function codes(section: cash.CashFlowSection): Record<string, number> {
  return Object.fromEntries(section.rows.map((r) => [r.code, r.amount]));
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-cash-reports-flow-test' });
  await seedFinanceCounters();
  await seedFinanceChart();

  for (const period of ['2025-07', '2025-08', periodKeyFor(new Date())]) {
    try {
      await openPeriod(period, ACTOR);
    } catch {
      // Already open.
    }
  }

  // July
  await post('2025-07-01', dr('1120', 100000), cr('3110', 100000)); // owner's capital   → financing
  await post('2025-07-05', dr('1120', 50000), cr('2210', 50000)); //   a loan            → financing
  await post('2025-07-08', dr('1210', 30000), cr('1120', 30000)); //   a vehicle         → investing
  await post('2025-07-15', dr('1110', 20000), cr('4110', 20000)); //   a cash sale       → operating
  const rent = await post('2025-07-20', dr('6130', 5000), cr('1110', 5000)); // rent  → operating
  await post('2025-07-25', dr('1110', 10000), cr('1120', 10000)); //   bank to cash      → nothing
  // Cash at the end of July: office 25,000; bank 110,000.

  // August
  await post('2025-08-01', dr('1110', 3000), cr('1140', 3000, { type: 'dealer', id: SHOP })); //  recovery
  await post('2025-08-05', dr('1140', 7000, { type: 'dealer', id: SHOP }), cr('4110', 7000)); //  sale on credit — no cash
  await post('2025-08-10', dr('2110', 4000, { type: 'vendor', id: SUPPLIER }), cr('1125', 4000)); // cheque written — no cash
  await post('2025-08-20', dr('1125', 4000), cr('1120', 4000)); //                              cheque clears
  // Cash at the end of August: office 28,000; bank 106,000.

  // -------------------------------------------------------------------------
  // Cash flow
  // -------------------------------------------------------------------------

  await test('cash movements are split into operating, investing and financing', async () => {
    const cf = await cash.cashFlow({ from: '2025-07', to: '2025-08' });

    assert.deepEqual(codes(cf.operating), { 4110: 20000, 6130: -5000, 1140: 3000, 1125: -4000 });
    assert.equal(cf.operating.total, 14000);
    assert.deepEqual(codes(cf.investing), { 1210: -30000 });
    assert.deepEqual(codes(cf.financing), { 3110: 100000, 2210: 50000 });
    assert.equal(cf.financing.total, 150000);

    assert.equal(cf.openingCash, 0);
    assert.equal(cf.netChange, 134000);
    assert.equal(cf.closingCash, 134000);
    assert.equal(cf.reconciles, true, `out by ${cf.difference}`);
    assert.deepEqual(cf.warnings, []);
  });

  await test('a transfer between cash and bank moves nothing', async () => {
    const cf = await cash.cashFlow({ from: '2025-07', to: '2025-07' });
    const all = [...cf.operating.rows, ...cf.investing.rows, ...cf.financing.rows].map((r) => r.code);
    assert.ok(!all.includes('1110') && !all.includes('1120'), 'cash appeared as its own source');
    assert.equal(cf.closingCash, 135000);
    assert.equal(cf.reconciles, true);
  });

  await test('a cheque counts when it clears, and a credit sale not at all', async () => {
    const cf = await cash.cashFlow({ from: '2025-08', to: '2025-08' });
    assert.deepEqual(codes(cf.operating), { 1140: 3000, 1125: -4000 });
    assert.equal('2110' in codes(cf.operating), false, 'the cheque counted on the day it was written');
    assert.equal('4110' in codes(cf.operating), false, 'a sale on credit counted as cash');

    assert.equal(cf.openingCash, 135000);
    assert.equal(cf.netChange, -1000);
    assert.equal(cf.closingCash, 134000);
    assert.equal(cf.reconciles, true);
  });

  await test('closing cash agrees with the Balance Sheet', async () => {
    const cf = await cash.cashFlow({ from: '2025-08', to: '2025-08' });
    const bs = await balanceSheet({ asOf: '2025-08' });
    const lines = bs.assets.flatMap((s) => [...s.lines, ...s.sections.flatMap((x) => x.lines)]);
    const cashOnSheet = ['1110', '1120'].reduce((sum, code) => sum + (lines.find((l) => l.code === code)?.amount ?? 0), 0);
    assert.equal(cf.closingCash, cashOnSheet);
  });

  await test('with no months given, it is this month', async () => {
    const cf = await cash.cashFlow();
    assert.equal(cf.from, periodKeyFor(new Date()));
    assert.equal(cf.to, cf.from);
  });

  await test('a backwards range is refused', async () => {
    await rejectsWith(cash.cashFlow({ from: '2025-08', to: '2025-07' }), /after the end month/);
  });

  await test('a reversal moves cash in the month it is posted', async () => {
    await reverseEntry(String(rent._id), { reason: 'Rent refunded' }, ACTOR);

    const july = await cash.cashFlow({ from: '2025-07', to: '2025-07' });
    assert.equal(codes(july.operating)['6130'], -5000, 'a later reversal restated July');

    const now = await cash.cashFlow();
    assert.equal(codes(now.operating)['6130'], 5000);
    assert.equal(now.reconciles, true);
  });

  // -------------------------------------------------------------------------
  // Cash & bank position
  // -------------------------------------------------------------------------

  await test('each account shows what it started with, took in, paid out and ended with', async () => {
    const pos = await cash.cashPosition({ from: '2025-08-01', to: '2025-08-31' });
    const byCode = Object.fromEntries(pos.accounts.map((a) => [a.code, a]));

    assert.deepEqual(
      [byCode['1110'].opening, byCode['1110'].moneyIn, byCode['1110'].moneyOut, byCode['1110'].closing],
      [25000, 3000, 0, 28000],
    );
    assert.deepEqual(
      [byCode['1120'].opening, byCode['1120'].moneyIn, byCode['1120'].moneyOut, byCode['1120'].closing],
      [110000, 0, 4000, 106000],
    );
    assert.equal(pos.totals.closing, 134000);
    assert.equal(pos.unclearedCheques, 0, 'a cleared cheque is still counted as outstanding');
  });

  await test('a cheque written but not cleared is shown against the bank balance', async () => {
    const pos = await cash.cashPosition({ from: '2025-08-01', to: '2025-08-15' });
    assert.equal(pos.accounts.find((a) => a.code === '1120')!.closing, 110000, 'the bank moved before the cheque cleared');
    assert.equal(pos.unclearedCheques, 4000);
    assert.equal(pos.availableAfterCheques, 134000);
  });

  await test('money in and out include transfers between the accounts themselves', async () => {
    const pos = await cash.cashPosition({ from: '2025-07-01', to: '2025-07-31' });
    const byCode = Object.fromEntries(pos.accounts.map((a) => [a.code, a]));
    assert.equal(byCode['1110'].moneyIn, 30000);
    assert.equal(byCode['1110'].moneyOut, 5000);
    assert.equal(byCode['1120'].moneyIn, 150000);
    assert.equal(byCode['1120'].moneyOut, 40000);
  });

  await test('a malformed or backwards date range is refused', async () => {
    await rejectsWith(cash.cashPosition({ from: '01-08-2025', to: '2025-08-31' }), /not a date/);
    await rejectsWith(cash.cashPosition({ from: '2025-08-31', to: '2025-08-01' }), /after the end date/);
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
