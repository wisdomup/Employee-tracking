/**
 * Integration test for the region-wise daily sale dashboard.
 *
 * Runs against a throwaway in-memory MongoDB — never the real database.
 * Covers the three things most likely to be quietly wrong: timezone day boundaries,
 * city grouping/normalisation, and team scoping.
 *
 * Run with: npm run test:region-sales:flow
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import * as service from './region-sales.service';
import { UNASSIGNED_REGION } from './region-sales.rules';

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
const MANAGER_A = new Types.ObjectId();
const MANAGER_B = new Types.ObjectId();
// Lahore team (manager A) — note the deliberately messy city casing/whitespace.
const ALI = new Types.ObjectId();
const BINA = new Types.ObjectId();
const CAId = new Types.ObjectId(); // Lahore, zero sales
// Karachi (manager B)
const DAUD = new Types.ObjectId();
// No city at all (manager A)
const ESHA = new Types.ObjectId();

/** The test day, and instants inside/outside it in Asia/Karachi (UTC+5). */
const DAY = '2026-07-31';
const MIDDAY = new Date('2026-07-31T09:00:00.000Z'); // 14:00 PKT on the 31st
const EARLY_PKT = new Date('2026-07-30T19:30:00.000Z'); // 00:30 PKT on the 31st
const LATE_UTC_NEXT_PKT_DAY = new Date('2026-07-31T21:00:00.000Z'); // 02:00 PKT on Aug 1
const PREV_DAY = new Date('2026-07-29T09:00:00.000Z');

let mongod: MongoMemoryServer;
let dealerId: Types.ObjectId;

const region = (r: { regions: { region: string }[] }, name: string) =>
  r.regions.find((x) => x.region === name);

async function order(
  createdBy: Types.ObjectId,
  status: string,
  grandTotal: number | undefined,
  createdAt: Date,
  extra: Record<string, unknown> = {},
) {
  // `createdAt` is immutable once set, and the timestamps plugin would overwrite it with
  // "now" — so disable timestamps for the insert and supply the backdated value directly.
  const [doc] = await OrderModel.create(
    [{ dealerId, createdBy, status, grandTotal, products: [], createdAt, ...extra }],
    { timestamps: false },
  );
  return doc;
}

async function seed(): Promise<void> {
  await UserModel.create([
    { _id: ADMIN, userID: 'ADM', username: 'admin.one', phone: '0300000000', password: 'x', role: 'admin' },
    { _id: MANAGER_A, userID: 'SM-A', username: 'manager.a', phone: '0300000001', password: 'x', role: 'sales_manager' },
    { _id: MANAGER_B, userID: 'SM-B', username: 'manager.b', phone: '0300000002', password: 'x', role: 'sales_manager' },
    { _id: ALI, userID: 'R1', username: 'ali', fullName: 'Ali Raza', phone: '0300000003', password: 'x', role: 'order_taker', managerId: MANAGER_A, address: { city: 'Lahore' } },
    // Same city, different casing + whitespace — must land in the SAME region row.
    { _id: BINA, userID: 'R2', username: 'bina', fullName: 'Bina Khan', phone: '0300000004', password: 'x', role: 'order_taker', managerId: MANAGER_A, address: { city: '  lahore ' } },
    { _id: CAId, userID: 'R3', username: 'chand', fullName: 'Chand Bibi', phone: '0300000005', password: 'x', role: 'order_taker', managerId: MANAGER_A, address: { city: 'LAHORE' } },
    { _id: DAUD, userID: 'R4', username: 'daud', fullName: 'Daud Ali', phone: '0300000006', password: 'x', role: 'order_taker', managerId: MANAGER_B, address: { city: 'Karachi' } },
    { _id: ESHA, userID: 'R5', username: 'esha', fullName: 'Esha Noor', phone: '0300000007', password: 'x', role: 'order_taker', managerId: MANAGER_A },
  ]);

  const dealer = await DealerModel.create({ name: 'Shop', phone: '0311111111' });
  dealerId = dealer._id as Types.ObjectId;

  // --- Lahore, on the test day ---
  await order(ALI, 'delivered', 1000, MIDDAY);
  await order(ALI, 'pending', 250, MIDDAY); // booked, not delivered
  await order(BINA, 'delivered', 500, EARLY_PKT); // 00:30 PKT — must count on the 31st
  await order(BINA, 'approved', 300, MIDDAY); // booked
  // Chand has NO orders — must still appear at Rs. 0.

  // Excluded noise, all on the test day:
  await order(ALI, 'cancelled', 9999, MIDDAY);
  await order(ALI, 'delivered', 7777, MIDDAY, { isTrashed: true });
  await order(ALI, 'delivered', 4444, MIDDAY, { grandTotal: undefined }); // no amount

  // --- Karachi, on the test day ---
  await order(DAUD, 'delivered', 2000, MIDDAY);

  // --- No-city salesman, on the test day ---
  await order(ESHA, 'delivered', 150, MIDDAY);

  // --- Outside the test day ---
  await order(ALI, 'delivered', 6000, PREV_DAY); // two days earlier
  await order(ALI, 'delivered', 8000, LATE_UTC_NEXT_PKT_DAY); // 02:00 PKT on Aug 1
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'region-sales-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');
  await seed();

  // -------------------------------------------------------------------------
  console.log('Region totals');
  // -------------------------------------------------------------------------
  await test('cities group into regions with delivered and booked kept separate', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const lahore = region(r, 'Lahore')!;
    assert.ok(lahore, 'Lahore region should exist');
    // Delivered: Ali 1000 + Bina 500 (the 00:30 PKT one). Booked: 250 + 300.
    assert.equal(lahore.deliveredAmount, 1500);
    assert.equal(lahore.bookedAmount, 550);
    assert.equal(lahore.totalAmount, 2050);
  });

  await test('the region label is deterministic and prefers proper casing', async () => {
    // Regression: the label used to be whichever spelling the database happened to
    // return first, so adding an index on address.city silently flipped it to "lahore".
    const first = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const second = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const labels = first.regions.map((r) => r.region);
    assert.deepEqual(labels, second.regions.map((r) => r.region), 'stable across calls');
    assert.ok(labels.includes('Lahore'), `expected "Lahore", got ${JSON.stringify(labels)}`);
    assert.ok(!labels.includes('lahore') && !labels.includes('LAHORE'));
  });

  await test('the drill-down label agrees with the region list label', async () => {
    const regions = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const drill = await service.getRegionSalesmen(DAY, 'lahore', String(ADMIN), 'admin');
    assert.equal(drill.region, region(regions, 'Lahore')!.region);
  });

  await test('case and whitespace variants of one city collapse into a single region', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const lahoreRows = r.regions.filter((x) => x.region.toLowerCase().trim() === 'lahore');
    assert.equal(lahoreRows.length, 1, '"Lahore" / " lahore " / "LAHORE" must be one row');
    assert.equal(lahoreRows[0].salesmenCount, 3, 'all three Lahore salesmen counted');
  });

  await test('cancelled, trashed and amount-less orders are excluded from the money', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const lahore = region(r, 'Lahore')!;
    // 9999 cancelled and 7777 trashed must not appear anywhere.
    assert.equal(lahore.deliveredAmount, 1500);
    // The amount-less delivered order still counts as an order, adding 0 to the money.
    // Ali: 1000 + 250 + no-amount = 3, Bina: 500 + 300 = 2.
    assert.equal(lahore.orderCount, 5);
  });

  await test('salesmen with no city land in the Unassigned bucket, not dropped', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const unassigned = region(r, UNASSIGNED_REGION)!;
    assert.ok(unassigned, 'Unassigned bucket should exist');
    assert.equal(unassigned.deliveredAmount, 150);
    assert.equal(unassigned.salesmenCount, 1);
  });

  await test('Unassigned is always sorted last, even above smaller real regions', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    assert.equal(r.regions[r.regions.length - 1].region, UNASSIGNED_REGION);
  });

  await test('grand totals equal the sum of the regions', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const sum = r.regions.reduce((a, x) => a + x.totalAmount, 0);
    assert.equal(r.totals.totalAmount, Math.round(sum * 100) / 100);
    // Lahore 2050 + Karachi 2000 + Unassigned 150.
    assert.equal(r.totals.totalAmount, 4200);
  });

  // -------------------------------------------------------------------------
  console.log('\nTimezone day boundaries (Asia/Karachi)');
  // -------------------------------------------------------------------------
  await test('a 00:30 PKT order counts on that PKT day, not the previous UTC day', async () => {
    // Bina's 500 was created at 19:30Z on Jul 30 = 00:30 PKT on Jul 31.
    const jul31 = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    assert.equal(region(jul31, 'Lahore')!.deliveredAmount, 1500, 'includes the 500');

    const jul30 = await service.getRegionTotals('2026-07-30', String(ADMIN), 'admin');
    assert.equal(region(jul30, 'Lahore')!.deliveredAmount, 0, 'must NOT leak into Jul 30');
  });

  await test('a 02:00 PKT order rolls into the NEXT day, not the UTC one', async () => {
    // Ali's 8000 was created at 21:00Z on Jul 31 = 02:00 PKT on Aug 1.
    const jul31 = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    assert.equal(region(jul31, 'Lahore')!.deliveredAmount, 1500, 'the 8000 must not be here');

    const aug1 = await service.getRegionTotals('2026-08-01', String(ADMIN), 'admin');
    assert.equal(region(aug1, 'Lahore')!.deliveredAmount, 8000);
  });

  await test('a day with no sales returns regions at zero rather than an empty list', async () => {
    const quiet = await service.getRegionTotals('2026-06-15', String(ADMIN), 'admin');
    assert.ok(quiet.regions.length >= 2, 'regions still listed');
    assert.equal(quiet.totals.totalAmount, 0);
  });

  await test('a malformed date is rejected', async () => {
    await rejectsWith(
      service.getRegionTotals('2026-13-45', String(ADMIN), 'admin'),
      /YYYY-MM-DD/,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nRegion → salesmen drill-down');
  // -------------------------------------------------------------------------
  await test('every salesman in the region is listed, including one with zero sales', async () => {
    const r = await service.getRegionSalesmen(DAY, 'lahore', String(ADMIN), 'admin');
    assert.equal(r.salesmen.length, 3);
    const chand = r.salesmen.find((s) => s.username === 'chand')!;
    assert.ok(chand, 'the salesman with no orders must still appear');
    assert.equal(chand.totalAmount, 0);
    assert.equal(chand.orderCount, 0);
  });

  await test('the drill-down is reachable by any casing of the region key', async () => {
    const lower = await service.getRegionSalesmen(DAY, 'lahore', String(ADMIN), 'admin');
    const upper = await service.getRegionSalesmen(DAY, 'LAHORE', String(ADMIN), 'admin');
    assert.equal(lower.salesmen.length, upper.salesmen.length);
    assert.equal(lower.totals.totalAmount, upper.totals.totalAmount);
  });

  await test('salesman figures sum to the region total shown one level up', async () => {
    const regions = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const drill = await service.getRegionSalesmen(DAY, 'lahore', String(ADMIN), 'admin');
    assert.equal(drill.totals.totalAmount, region(regions, 'Lahore')!.totalAmount);
  });

  await test('the Unassigned bucket drills down via an empty key', async () => {
    const r = await service.getRegionSalesmen(DAY, '', String(ADMIN), 'admin');
    assert.equal(r.salesmen.length, 1);
    assert.equal(r.salesmen[0].username, 'esha');
    assert.equal(r.region, UNASSIGNED_REGION);
  });

  await test('an unknown region returns empty rather than everyone', async () => {
    const r = await service.getRegionSalesmen(DAY, 'atlantis', String(ADMIN), 'admin');
    assert.equal(r.salesmen.length, 0);
    assert.equal(r.totals.totalAmount, 0);
  });

  // -------------------------------------------------------------------------
  console.log('\nSalesman day-wise report');
  // -------------------------------------------------------------------------
  await test('day-wise series is dense — quiet days come back as zero, not missing', async () => {
    const r = await service.getSalesmanDaily(String(ALI), '2026-07-29', '2026-08-01', String(ADMIN), 'admin');
    assert.deepEqual(r.days.map((d) => d.date), [
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
    assert.equal(r.days[0].deliveredAmount, 6000); // Jul 29
    assert.equal(r.days[1].deliveredAmount, 0, 'Jul 30 is a real zero row');
    assert.equal(r.days[2].deliveredAmount, 1000); // Jul 31
    assert.equal(r.days[3].deliveredAmount, 8000); // Aug 1 (the 02:00 PKT order)
  });

  await test('range totals equal the sum of the daily rows', async () => {
    const r = await service.getSalesmanDaily(String(ALI), '2026-07-29', '2026-08-01', String(ADMIN), 'admin');
    const sum = r.days.reduce((a, d) => a + d.totalAmount, 0);
    assert.equal(r.totals.totalAmount, Math.round(sum * 100) / 100);
    assert.equal(r.totals.deliveredAmount, 15000); // 6000 + 1000 + 8000
    assert.equal(r.totals.bookedAmount, 250);
  });

  await test('the employee and their region are returned for the report header', async () => {
    const r = await service.getSalesmanDaily(String(ALI), DAY, DAY, String(ADMIN), 'admin');
    assert.equal(r.employee?.fullName, 'Ali Raza');
    assert.equal(r.employee?.region, 'Lahore');
  });

  await test('from after to is rejected', async () => {
    await rejectsWith(
      service.getSalesmanDaily(String(ALI), '2026-08-05', '2026-08-01', String(ADMIN), 'admin'),
      /must not be after/i,
    );
  });

  await test('an excessive range is rejected rather than returning thousands of rows', async () => {
    await rejectsWith(
      service.getSalesmanDaily(String(ALI), '2020-01-01', '2026-08-01', String(ADMIN), 'admin'),
      /too large/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nScoping (a manager must not see another team)');
  // -------------------------------------------------------------------------
  await test('admin sees every region', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const names = r.regions.map((x) => x.region);
    assert.ok(names.includes('Lahore'));
    assert.ok(names.includes('Karachi'));
    assert.ok(names.includes(UNASSIGNED_REGION));
  });

  await test('a manager sees only their own team\'s regions', async () => {
    const r = await service.getRegionTotals(DAY, String(MANAGER_A), 'sales_manager');
    const names = r.regions.map((x) => x.region);
    assert.ok(names.includes('Lahore'), 'own team region visible');
    assert.ok(!names.includes('Karachi'), "another manager's region must NOT leak");
    // Manager A's totals: Lahore 2050 + Esha's unassigned 150.
    assert.equal(r.totals.totalAmount, 2200);
  });

  await test('the other manager sees only Karachi', async () => {
    const r = await service.getRegionTotals(DAY, String(MANAGER_B), 'sales_manager');
    assert.deepEqual(r.regions.map((x) => x.region), ['Karachi']);
    assert.equal(r.totals.totalAmount, 2000);
  });

  await test('a manager drilling into another team\'s region gets nothing', async () => {
    const r = await service.getRegionSalesmen(DAY, 'karachi', String(MANAGER_A), 'sales_manager');
    assert.equal(r.salesmen.length, 0);
    assert.equal(r.totals.totalAmount, 0);
  });

  await test('a manager requesting another team\'s salesman gets an empty report, not their data', async () => {
    const r = await service.getSalesmanDaily(String(DAUD), DAY, DAY, String(MANAGER_A), 'sales_manager');
    assert.equal(r.employee, null);
    assert.equal(r.totals.totalAmount, 0);
    assert.equal(r.days.length, 1);
    assert.equal(r.days[0].totalAmount, 0);
  });

  await test('a manager CAN see their own salesman\'s day-wise report', async () => {
    const r = await service.getSalesmanDaily(String(ALI), DAY, DAY, String(MANAGER_A), 'sales_manager');
    assert.equal(r.employee?.username, 'ali');
    assert.equal(r.totals.deliveredAmount, 1000);
  });

  await test('managers themselves are not listed as salesmen rows', async () => {
    const r = await service.getRegionTotals(DAY, String(ADMIN), 'admin');
    const total = r.regions.reduce((a, x) => a + x.salesmenCount, 0);
    assert.equal(total, 5, 'only the 5 field staff, neither manager nor admin');
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} region-sales integration tests passed.`);
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
