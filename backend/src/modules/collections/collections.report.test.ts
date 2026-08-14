/**
 * Integration test for the collection reports: entry-wise report (§8), today's activity (§9)
 * and the day-end summary (§10).
 *
 * Focused on the two things that are invisible when wrong and expensive later: timezone day
 * bucketing (at UTC+5 a 02:00 PKT delivery belongs to THAT day, not the previous UTC one) and
 * the city snapshot holding still when a rider transfers between cities.
 *
 * Run with: npm run test:collections:report
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import * as reports from './collection-reports.service';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
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

const ADMIN = new Types.ObjectId();
const TAKER = new Types.ObjectId();
const ALI = new Types.ObjectId(); // Lahore
const DAUD = new Types.ObjectId(); // Karachi
const IDLE = new Types.ObjectId(); // Lahore, zero activity — must still appear
const MOVER = new Types.ObjectId(); // starts in Lahore, transfers to Karachi

/** The test day, and instants inside/outside it in Asia/Karachi (UTC+5). */
const DAY = '2026-07-31';
const NEXT_DAY = '2026-08-01';
const MIDDAY = new Date('2026-07-31T09:00:00.000Z'); // 14:00 PKT on the 31st
const EARLY_PKT = new Date('2026-07-30T19:30:00.000Z'); // 00:30 PKT on the 31st
const LATE_UTC_NEXT_PKT_DAY = new Date('2026-07-31T21:00:00.000Z'); // 02:00 PKT on Aug 1

let mongod: MongoMemoryServer;
let lahoreShop: Types.ObjectId;
let karachiShop: Types.ObjectId;

/** Insert a delivered order plus its collection entry directly, at a controlled instant. */
async function delivered(opts: {
  rider: Types.ObjectId;
  dealerId: Types.ObjectId;
  city: string;
  cityKey: string;
  amount: number;
  cash: number;
  online: number;
  credit: number;
  at: Date;
  invoiceNumber?: number;
  voided?: boolean;
}) {
  const order = await OrderModel.create({
    dealerId: opts.dealerId,
    createdBy: TAKER,
    products: [],
    grandTotal: opts.amount,
    status: 'delivered',
    assignedRiderId: opts.rider,
    assignedAt: opts.at,
    packedAt: opts.at,
    deliveredAt: opts.at,
    ...(opts.invoiceNumber ? { invoiceNumber: opts.invoiceNumber } : {}),
  });

  await DeliveryCollectionModel.create({
    orderId: order._id,
    ...(opts.invoiceNumber ? { invoiceNumber: opts.invoiceNumber } : {}),
    dealerId: opts.dealerId,
    riderId: opts.rider,
    city: opts.city,
    cityKey: opts.cityKey,
    dealerCityKey: opts.cityKey,
    orderAmount: opts.amount,
    cash: opts.cash,
    online: opts.online,
    credit: opts.credit,
    deliveredAt: opts.at,
    createdBy: opts.rider,
    ...(opts.voided ? { voidedAt: new Date(), voidedBy: ADMIN, voidReason: 'test' } : {}),
  });

  return order;
}

async function seed(): Promise<void> {
  await UserModel.create([
    { _id: ADMIN, userID: 'ADM', username: 'admin.one', phone: '0300000000', password: 'x', role: 'admin' },
    { _id: TAKER, userID: 'OT1', username: 'taker', phone: '0300000001', password: 'x', role: 'order_taker', address: { city: 'Lahore' } },
    { _id: ALI, userID: 'DM1', username: 'ali', fullName: 'Ali Raza', phone: '0300000002', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } },
    { _id: DAUD, userID: 'DM2', username: 'daud', fullName: 'Daud Ali', phone: '0300000003', password: 'x', role: 'delivery_man', address: { city: 'Karachi' } },
    { _id: IDLE, userID: 'DM3', username: 'idle', fullName: 'Idle Rider', phone: '0300000004', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } },
    { _id: MOVER, userID: 'DM4', username: 'mover', fullName: 'Mover Khan', phone: '0300000005', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } },
  ]);

  const [s1, s2] = await DealerModel.create([
    { name: 'Ahmed Traders', shopName: 'Ahmed Kiryana', phone: '0311111111', address: { city: 'Lahore' } },
    { name: 'Karachi Shop', shopName: 'KS', phone: '0311111112', address: { city: 'Karachi' } },
  ]);
  lahoreShop = s1._id as Types.ObjectId;
  karachiShop = s2._id as Types.ObjectId;

  // --- Lahore, on the test day ---
  await delivered({ rider: ALI, dealerId: lahoreShop, city: 'Lahore', cityKey: 'lahore', amount: 12000, cash: 7000, online: 3000, credit: 2000, at: MIDDAY, invoiceNumber: 1042 });
  // 00:30 PKT on the 31st — must land on the 31st, not the 30th.
  await delivered({ rider: ALI, dealerId: lahoreShop, city: 'Lahore', cityKey: 'lahore', amount: 1000, cash: 1000, online: 0, credit: 0, at: EARLY_PKT, invoiceNumber: 1043 });

  // --- Karachi, on the test day ---
  await delivered({ rider: DAUD, dealerId: karachiShop, city: 'Karachi', cityKey: 'karachi', amount: 5000, cash: 2000, online: 3000, credit: 0, at: MIDDAY, invoiceNumber: 1044 });

  // --- Voided: must count for nothing but still be listed ---
  await delivered({ rider: ALI, dealerId: lahoreShop, city: 'Lahore', cityKey: 'lahore', amount: 9999, cash: 9999, online: 0, credit: 0, at: MIDDAY, invoiceNumber: 1045, voided: true });

  // --- 02:00 PKT on Aug 1 — belongs to the NEXT day ---
  await delivered({ rider: ALI, dealerId: lahoreShop, city: 'Lahore', cityKey: 'lahore', amount: 8000, cash: 8000, online: 0, credit: 0, at: LATE_UTC_NEXT_PKT_DAY, invoiceNumber: 1046 });

  // --- The mover collected in Lahore on the test day, then transferred to Karachi ---
  await delivered({ rider: MOVER, dealerId: lahoreShop, city: 'Lahore', cityKey: 'lahore', amount: 4000, cash: 4000, online: 0, credit: 0, at: MIDDAY, invoiceNumber: 1047 });
  await UserModel.updateOne({ _id: MOVER }, { $set: { 'address.city': 'Karachi' } });
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'collections-report-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');
  await seed();

  // -------------------------------------------------------------------------
  console.log('Timezone day bucketing (Asia/Karachi, UTC+5)');
  // -------------------------------------------------------------------------
  await test('a 00:30 PKT delivery lands on THAT PKT day, not the previous UTC day', async () => {
    const r = await reports.getCollectionReport({ from: DAY, to: DAY });
    const invoices = r.rows.map((x: any) => x.invoiceNumber);
    assert.ok(invoices.includes(1043), '00:30 PKT on the 31st belongs to the 31st');
  });

  await test('a 02:00 PKT delivery does NOT leak into the previous day', async () => {
    const day = await reports.getCollectionReport({ from: DAY, to: DAY });
    assert.ok(!day.rows.some((x: any) => x.invoiceNumber === 1046), 'not on the 31st');

    const next = await reports.getCollectionReport({ from: NEXT_DAY, to: NEXT_DAY });
    assert.ok(next.rows.some((x: any) => x.invoiceNumber === 1046), 'it is on Aug 1');
  });

  await test('an oversized range is rejected rather than returning years of rows', async () => {
    await rejectsWith(
      reports.getCollectionReport({ from: '2020-01-01', to: '2026-12-31' }),
      /Date range is too large/,
    );
  });

  await test('a malformed date is rejected', async () => {
    await rejectsWith(reports.getCollectionReport({ from: '31-07-2026' }), /Invalid date/);
    await rejectsWith(reports.getCollectionReport({ from: '2026-02-30' }), /Invalid date/);
  });

  await test('a reversed range is rejected', async () => {
    await rejectsWith(
      reports.getCollectionReport({ from: NEXT_DAY, to: DAY }),
      /start date cannot be after the end date/,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nEntry-wise report (spec §8)');
  // -------------------------------------------------------------------------
  await test('each delivery is its own row with the spec’s columns', async () => {
    const r = await reports.getCollectionReport({ from: DAY, to: DAY });
    const row: any = r.rows.find((x: any) => x.invoiceNumber === 1042);
    assert.ok(row, 'the row exists');
    assert.equal(row.shop, 'Ahmed Kiryana');
    assert.equal(row.rider, 'Ali Raza');
    assert.equal(row.city, 'Lahore');
    assert.equal(row.amount, 12000);
    assert.equal(row.cash, 7000);
    assert.equal(row.online, 3000);
    assert.equal(row.credit, 2000);
    assert.ok(row.deliveredAt, 'date/time');
  });

  await test('the grand total equals the sum of the rows AND the sum of the city subtotals', async () => {
    const r = await reports.getCollectionReport({ from: DAY, to: DAY });
    const rowSum = r.rows.reduce((s: number, x: any) => s + x.amount, 0);
    const citySum = r.cities.reduce((s, c) => s + c.amount, 0);
    assert.equal(r.totals.amount, rowSum, 'totals match the rows');
    assert.equal(r.totals.amount, citySum, 'and match the per-city subtotals');
    // Lahore 12000 + 1000 + 4000, Karachi 5000. The voided 9999 counts for nothing.
    assert.equal(r.totals.amount, 22000);
    assert.equal(r.totals.cash, 14000);
    assert.equal(r.totals.online, 6000);
    assert.equal(r.totals.credit, 2000);
  });

  await test('a voided entry is excluded from every total', async () => {
    const r = await reports.getCollectionReport({ from: DAY, to: DAY });
    assert.ok(!r.rows.some((x: any) => x.invoiceNumber === 1045), 'voided rows are not listed');
    assert.ok(r.totals.amount < 31999, 'and the 9999 is not in the total');
  });

  await test('the city filter proves no mixing across cities', async () => {
    const lahore = await reports.getCollectionReport({ from: DAY, to: DAY, cityKey: 'lahore' });
    assert.equal(lahore.totals.amount, 17000, '12000 + 1000 + 4000');
    assert.ok(lahore.rows.every((x: any) => x.cityKey === 'lahore'));

    const karachi = await reports.getCollectionReport({ from: DAY, to: DAY, cityKey: 'karachi' });
    assert.equal(karachi.totals.amount, 5000);
    assert.ok(!karachi.rows.some((x: any) => x.rider === 'Ali Raza'), 'a Lahore rider never appears');
  });

  await test('the rider filter composes with the city and date filters', async () => {
    const r = await reports.getCollectionReport({
      from: DAY, to: DAY, riderId: String(ALI), cityKey: 'lahore',
    });
    assert.equal(r.totals.amount, 13000, 'Ali’s two live Lahore entries on the day');
    assert.ok(r.rows.every((x: any) => x.riderId?.toString() === String(ALI)));

    const wrongCity = await reports.getCollectionReport({
      from: DAY, to: DAY, riderId: String(ALI), cityKey: 'karachi',
    });
    assert.equal(wrongCity.totals.count, 0, 'a Lahore rider under a Karachi filter is empty');
  });

  await test('rows are ordered city-first, so the report reads as strict city-wise grouping', async () => {
    const r = await reports.getCollectionReport({ from: DAY, to: DAY });
    const keys = r.rows.map((x: any) => x.cityKey);
    assert.deepEqual([...keys].sort(), keys, 'city keys are non-decreasing down the page');
  });

  await test('pagination keeps the grand total whole rather than per-page', async () => {
    const p1 = await reports.getCollectionReport({ from: DAY, to: DAY, page: 1, limit: 1 });
    const p2 = await reports.getCollectionReport({ from: DAY, to: DAY, page: 2, limit: 1 });
    assert.equal(p1.rows.length, 1, 'one row per page');
    assert.deepEqual(p1.totals, p2.totals, 'both pages report the SAME grand total');
    assert.equal(p1.totals.amount, 22000, 'and it is the whole filtered set');
    assert.equal(p1.page.total, 4);
    assert.equal(p1.page.pages, 4);
  });

  await test('a since-deleted client still shows, so the grand total cannot silently shrink', async () => {
    const gone = await DealerModel.create({ name: 'Gone Shop', phone: '0399999999', address: { city: 'Lahore' } });
    await delivered({
      rider: ALI, dealerId: gone._id as Types.ObjectId, city: 'Lahore', cityKey: 'lahore',
      amount: 600, cash: 600, online: 0, credit: 0, at: MIDDAY, invoiceNumber: 1050,
    });
    await DealerModel.deleteOne({ _id: gone._id });

    const r = await reports.getCollectionReport({ from: DAY, to: DAY });
    const row: any = r.rows.find((x: any) => x.invoiceNumber === 1050);
    assert.ok(row, 'the row survives its client');
    assert.equal(row.shop, '(deleted client)');
    assert.equal(r.totals.amount, 22600, 'and its money is still counted');
  });

  // -------------------------------------------------------------------------
  console.log('\nThe city snapshot holds when a rider transfers (the accounting-immutability test)');
  // -------------------------------------------------------------------------
  await test('a rider who moved cities keeps their historical entries in the OLD city', async () => {
    // MOVER collected Rs. 4000 in Lahore, then transferred to Karachi. If the report joined the
    // city at read time, that 4000 would teleport to Karachi and last month's Lahore books would
    // silently restate themselves.
    const mover = await UserModel.findById(MOVER).lean();
    assert.equal(mover!.address!.city, 'Karachi', 'the rider is now in Karachi');

    const lahore = await reports.getCollectionReport({ from: DAY, to: DAY, cityKey: 'lahore' });
    assert.ok(
      lahore.rows.some((x: any) => x.invoiceNumber === 1047),
      'the historical entry stays in Lahore',
    );

    const karachi = await reports.getCollectionReport({ from: DAY, to: DAY, cityKey: 'karachi' });
    assert.ok(
      !karachi.rows.some((x: any) => x.invoiceNumber === 1047),
      'and does not appear in the new city',
    );
  });

  // -------------------------------------------------------------------------
  console.log("\nToday's Activity (spec §§9, 11)");
  // -------------------------------------------------------------------------
  await test('a rider with zero activity still appears, at zero', async () => {
    const a = await reports.getTodayActivity({ date: DAY });
    const idle = a.riders.find((r) => r.rider.id === String(IDLE));
    assert.ok(idle, '"All Riders" means ALL riders — the roster drives the list, not the data');
    assert.equal(idle!.counts.delivered, 0);
    assert.equal(idle!.collection.total, 0);
    assert.equal(idle!.cashInHand, 0);
  });

  await test('per-rider counts and the cash/online/credit breakdown are correct', async () => {
    const a = await reports.getTodayActivity({ date: DAY, riderId: String(ALI) });
    assert.equal(a.riders.length, 1, 'the rider selector narrows to one');
    const ali = a.riders[0];
    assert.equal(ali.collection.cash, 8600, '7000 + 1000 + 600');
    assert.equal(ali.collection.online, 3000);
    assert.equal(ali.collection.credit, 2000);
    assert.ok(ali.timeline.length > 0, 'an order-wise timeline with status and times');
    assert.ok(ali.timeline.every((t: any) => t.shop), 'each entry names the shop');
  });

  await test('the activity totals are the sum of the rider blocks', async () => {
    const a = await reports.getTodayActivity({ date: DAY });
    const cash = a.riders.reduce((s, r) => s + r.collection.cash, 0);
    assert.equal(a.totals.cash, cash);
  });

  // -------------------------------------------------------------------------
  console.log('\nDay-end summary (spec §10)');
  // -------------------------------------------------------------------------
  await test('day-end totals reconcile with the report for the same day', async () => {
    const summary = await reports.getDayEndSummary({ date: DAY });
    const report = await reports.getCollectionReport({ from: DAY, to: DAY });
    assert.equal(summary.totals.cash, report.totals.cash);
    assert.equal(summary.totals.online, report.totals.online);
    assert.equal(summary.totals.credit, report.totals.credit);
    assert.equal(summary.totals.amount, report.totals.amount);
  });

  await test('day-end separates delivered from still-pending work', async () => {
    // An assigned but undelivered order is pending, and rolls over regardless of the date.
    await OrderModel.create({
      dealerId: lahoreShop, createdBy: TAKER, products: [], grandTotal: 300,
      status: 'packed', assignedRiderId: ALI, assignedAt: MIDDAY, packedAt: MIDDAY,
    });
    const summary = await reports.getDayEndSummary({ date: DAY });
    assert.ok(summary.counts.delivered > 0);
    assert.equal(summary.counts.pending, 1, 'the packed-but-undelivered order');
    assert.equal(summary.counts.assigned, summary.counts.delivered + summary.counts.pending);
  });

  await test('day-end respects the city filter', async () => {
    const karachi = await reports.getDayEndSummary({ date: DAY, cityKey: 'karachi' });
    assert.equal(karachi.totals.amount, 5000);
    assert.equal(karachi.totals.cash, 2000);
  });

  // -------------------------------------------------------------------------
  console.log('\nRider roster');
  // -------------------------------------------------------------------------
  await test('the rider list carries each rider’s live cash in hand', async () => {
    const riders = await reports.listRiders();
    assert.equal(riders.length, 4, 'every delivery_man, none of the other roles');
    const ali = riders.find((r) => r._id === String(ALI))!;
    assert.equal(ali.city, 'Lahore');
    assert.equal(ali.cityKey, 'lahore');
    // 7000 + 1000 + 600 on the 31st, PLUS 8000 from Aug 1.
    assert.equal(ali.cashInHand, 16600);
    const idle = riders.find((r) => r._id === String(IDLE))!;
    assert.equal(idle.cashInHand, 0);
  });

  await test('cash in hand is an all-time balance and does NOT reset at midnight', async () => {
    // The distinction matters: a rider's pocket carries over, so cash-in-hand must be an
    // all-time running figure, while "today's collection" is day-scoped. Reporting the day's
    // figure as the balance would understate what the office is owed every morning.
    const day = await reports.getTodayActivity({ date: DAY, riderId: String(ALI) });
    assert.equal(day.riders[0].collection.cash, 8600, "today's collection is day-scoped");
    assert.equal(day.riders[0].cashInHand, 16600, 'but the balance spans every day');

    const nextDay = await reports.getTodayActivity({ date: NEXT_DAY, riderId: String(ALI) });
    assert.equal(nextDay.riders[0].collection.cash, 8000, 'a different day, a different figure');
    assert.equal(nextDay.riders[0].cashInHand, 16600, 'the same unchanged balance');
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} collection report tests passed.`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('\n✗ FAILED:', err);
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(1);
  });
