/**
 * Integration test for the dashboard cards and the client profile's "last visit".
 *
 * The theme is agreement: every card deep-links into a list, so a card whose number does not
 * match the rows that list returns is worse than no card at all. These tests pin the number to
 * the list rather than to a hand-computed constant, so a future change to either side that
 * breaks the pairing fails here.
 *
 * Runs against a throwaway in-memory MongoDB — never the real database.
 *
 * Run with: npm run test:dashboard
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { RouteModel } from '../../models/route.model';
import { VisitModel } from '../../models/visit.model';
import { OrderModel } from '../../models/order.model';
import '../../models/category.model';
import '../../models/product.model';

import * as dashboardService from './dashboard.service';
import * as visitsService from '../visits/visits.service';
import * as ordersService from '../orders/orders.service';
import { REPORT_TIMEZONE, localDayRangeUtc, todayDayKey } from '../region-sales/region-sales.rules';

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

let mongod: MongoMemoryServer;
let adminId: string;
let riderId: string;
let otherRiderId: string;
let dealerId: Types.ObjectId;
let routeId: Types.ObjectId;

/**
 * The `YYYY-MM-DD` the service considers "today".
 *
 * This used to read the process clock. The API container has no `TZ`, so that clock is UTC
 * while the business day is `REPORT_TIMEZONE` — the test agreed with the bug rather than with
 * the business, and passed all day except during the five hours it should have caught.
 */
function todayKey(): string {
  return todayDayKey();
}

/** A visit dated on `dayKey`, at midday UTC so it sits inside the list's UTC day bounds. */
function visitOn(dayKey: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    dealerId,
    employeeId: new Types.ObjectId(riderId),
    routeId,
    status,
    visitDate: new Date(`${dayKey}T12:00:00.000Z`),
    ...extra,
  };
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'dashboard-flow-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  const [admin, rider, other] = await UserModel.create([
    { userID: 'ADM', username: 'admin.one', phone: '0300000001', password: 'x', role: 'admin' },
    { userID: 'R1', username: 'rider.one', phone: '0300000002', password: 'x', role: 'order_taker', address: { city: 'Lahore' } },
    { userID: 'R2', username: 'rider.two', phone: '0300000003', password: 'x', role: 'order_taker', address: { city: 'Lahore' } },
  ]);
  adminId = String(admin._id);
  riderId = String(rider._id);
  otherRiderId = String(other._id);

  const route = await RouteModel.create({
    name: 'Route 1', startingPoint: 'A', endingPoint: 'B', createdBy: admin._id,
  });
  routeId = route._id as Types.ObjectId;

  const dealer = await DealerModel.create({
    name: 'Shop One', shopName: 'Shop One', phone: '0311111101',
    latitude: 31.52, longitude: 74.35, shopImage: 'shop.jpg', category: 'retailer',
    route: route._id, createdBy: admin._id, address: { city: 'Lahore' },
  });
  dealerId = dealer._id as Types.ObjectId;

  const today = todayKey();

  // -------------------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('Last visit on the client profile');
  // -------------------------------------------------------------------------
  await test('a never-visited shop reads as null rather than erroring', async () => {
    assert.equal(await visitsService.findLastVisitForDealer(String(dealerId)), null);
  });

  await test('a generated-but-unworked visit is not a visit to the shopkeeper', async () => {
    await VisitModel.create(visitOn(today, 'todo'));
    assert.equal(
      await visitsService.findLastVisitForDealer(String(dealerId)),
      null,
      'only a completed checkout counts',
    );
  });

  await test('the newest completed checkout wins, with its rider and duration', async () => {
    await VisitModel.create([
      visitOn('2026-08-03', 'completed', { completedAt: new Date('2026-08-03T09:00:00Z'), durationMinutes: 12 }),
      visitOn('2026-08-08', 'completed', { completedAt: new Date('2026-08-08T09:00:00Z'), durationMinutes: 20 }),
    ]);
    const last = await visitsService.findLastVisitForDealer(String(dealerId));
    assert.ok(last, 'a completed visit was found');
    assert.equal(new Date(last!.visit.completedAt as Date).toISOString().slice(0, 10), '2026-08-08');
    assert.equal(last!.visit.durationMinutes, 20);
    assert.equal((last!.visit.employeeId as unknown as { username: string }).username, 'rider.one');
  });

  await test('the gap is counted in whole calendar days and is never negative', async () => {
    // Regression: the gap was computed from UTC calendar days. Pakistan is UTC+5, so between
    // midnight and 05:00 PKT the UTC date is still yesterday's — a visit that really happened
    // yesterday afternoon read as "today". It is now bucketed in the report timezone.
    await VisitModel.deleteMany({ dealerId });
    await VisitModel.create(visitOn(today, 'completed', { completedAt: new Date() }));
    const sameDay = await visitsService.findLastVisitForDealer(String(dealerId));
    assert.equal(sameDay!.daysAgo, 0, 'a checkout earlier today is "today"');

    await VisitModel.deleteMany({ dealerId });
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    await VisitModel.create({
      dealerId, employeeId: new Types.ObjectId(riderId), routeId,
      status: 'completed', visitDate: threeDaysAgo, completedAt: threeDaysAgo,
    });
    const older = await visitsService.findLastVisitForDealer(String(dealerId));
    assert.equal(older!.daysAgo, 3);
  });

  await test('a trashed visit is not the last visit', async () => {
    await VisitModel.deleteMany({ dealerId });
    await VisitModel.create(visitOn(today, 'completed', { completedAt: new Date(), isTrashed: true }));
    assert.equal(await visitsService.findLastVisitForDealer(String(dealerId)), null);
  });

  // -------------------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('\nSalesman dashboard cards');
  // -------------------------------------------------------------------------
  await test('a malformed date is refused instead of reporting a blank day', async () => {
    await rejectsWith(dashboardService.getMyDashboardStats(riderId, 'not-a-date'), /YYYY-MM-DD/);
    // Well-formed but impossible: JS quietly rolls this over to March 2, so a shape check
    // alone would have reported a day the caller never asked for.
    await rejectsWith(dashboardService.getMyDashboardStats(riderId, '2026-02-30'), /YYYY-MM-DD/);
  });

  await test('every card number equals the list that card opens', async () => {
    await VisitModel.deleteMany({});
    await VisitModel.create([
      visitOn(today, 'completed', { completedAt: new Date() }),
      visitOn(today, 'completed', { completedAt: new Date() }),
      visitOn(today, 'todo'),
      visitOn(today, 'checked_in'),
      visitOn('2026-08-01', 'completed', { completedAt: new Date('2026-08-01T09:00:00Z') }),
    ]);

    const stats = await dashboardService.getMyDashboardStats(riderId, today);
    const all = await visitsService.findAll({ employeeId: riderId, startDate: today, endDate: today });
    const done = await visitsService.findAll({ employeeId: riderId, status: 'completed', startDate: today, endDate: today });
    const todo = await visitsService.findAll({ employeeId: riderId, status: 'todo', startDate: today, endDate: today });

    assert.equal(stats.date, today);
    assert.equal(stats.visits.total, all.length, 'total matches the unfiltered day');
    assert.equal(stats.visits.completed, done.length, 'completed matches its filtered list');
    assert.equal(stats.visits.todo, todo.length, 'to-do matches its filtered list');
    assert.equal(stats.visits.inProgress, 1, 'checked_in counts as in progress');
    assert.equal(stats.visits.completed, 2, 'yesterday\'s completed visit stays out');
  });

  await test('one rider\'s cards never include another rider\'s work', async () => {
    await VisitModel.create({
      dealerId, employeeId: new Types.ObjectId(otherRiderId), routeId,
      status: 'completed', visitDate: new Date(`${today}T12:00:00.000Z`), completedAt: new Date(),
    });
    const mine = await dashboardService.getMyDashboardStats(riderId, today);
    assert.equal(mine.visits.completed, 2, 'still only my own two');
  });

  await test('own sale is split into delivered and booked', async () => {
    await OrderModel.create([
      { dealerId, createdBy: new Types.ObjectId(riderId), status: 'delivered', grandTotal: 1000, items: [] },
      { dealerId, createdBy: new Types.ObjectId(riderId), status: 'pending', grandTotal: 250, items: [] },
      { dealerId, createdBy: new Types.ObjectId(riderId), status: 'cancelled', grandTotal: 9999, items: [] },
      { dealerId, createdBy: new Types.ObjectId(otherRiderId), status: 'delivered', grandTotal: 5000, items: [] },
    ]);
    const stats = await dashboardService.getMyDashboardStats(riderId);
    assert.equal(stats.sales.deliveredAmount, 1000);
    assert.equal(stats.sales.bookedAmount, 250);
    assert.equal(stats.sales.totalAmount, 1250, 'cancelled excluded, other riders excluded');
  });

  // -------------------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('\nAdmin dashboard cards');
  // -------------------------------------------------------------------------
  await test('completed is a real subset of scheduled, never larger', async () => {
    // Regression: the completed count was bounded by `completedAt` while the denominator used
    // `visitDate`, so a visit scheduled yesterday and checked out this morning landed in the
    // numerator only — and the card could read "48 of 46".
    await VisitModel.create({
      dealerId, employeeId: new Types.ObjectId(riderId), routeId,
      status: 'completed',
      visitDate: new Date('2026-08-03T12:00:00.000Z'),
      completedAt: new Date(),
    });
    const { stats } = await dashboardService.getDashboardStats();
    assert.ok(
      stats.visitsCompletedToday <= stats.visitsToday,
      `completed ${stats.visitsCompletedToday} must not exceed scheduled ${stats.visitsToday}`,
    );
  });

  await test('the admin card number equals the list it links to', async () => {
    const { stats, today: reportedDay } = await dashboardService.getDashboardStats();
    assert.equal(reportedDay, today, 'the response carries the day the cards link with');

    // `visibleEmployeeIds: null` is what an admin request resolves to.
    const scheduled = await visitsService.findAll({ startDate: reportedDay, endDate: reportedDay, visibleEmployeeIds: null });
    const completed = await visitsService.findAll({ status: 'completed', startDate: reportedDay, endDate: reportedDay, visibleEmployeeIds: null });
    assert.equal(stats.visitsToday, scheduled.length);
    assert.equal(stats.visitsCompletedToday, completed.length);
  });

  await test('an order booked in the small hours lands on that business day, not the next', async () => {
    // Regression: every `createdAt` window was cut on the process clock. The API container sets
    // no `TZ`, so that clock is UTC while the business runs on Asia/Karachi (UTC+5) — the window
    // opened five hours late. An order taken at 01:00 PKT falls on the *previous* UTC date, so
    // it dropped out of "Orders Today", out of "Delivered Sales Today", and out of the list the
    // card opens. This is what made the cards look random first thing in the morning.
    await OrderModel.deleteMany({});
    const today = todayKey();
    const { start, end } = localDayRangeUtc(today);
    const oneAm = new Date(start.getTime() + 60 * 60 * 1000);
    const elevenPm = new Date(end.getTime() - 60 * 60 * 1000);
    const justBefore = new Date(start.getTime() - 1);

    const created = await OrderModel.create([
      { dealerId, createdBy: new Types.ObjectId(riderId), status: 'delivered', grandTotal: 700, items: [] },
      { dealerId, createdBy: new Types.ObjectId(riderId), status: 'pending', grandTotal: 300, items: [] },
      { dealerId, createdBy: new Types.ObjectId(riderId), status: 'delivered', grandTotal: 5000, items: [] },
    ]);
    // `timestamps: true` stamps `createdAt` on save, so backdate it afterwards with the
    // timestamp plugin switched off for the write.
    await OrderModel.collection.updateOne({ _id: created[0]._id }, { $set: { createdAt: oneAm } });
    await OrderModel.collection.updateOne({ _id: created[1]._id }, { $set: { createdAt: elevenPm } });
    await OrderModel.collection.updateOne({ _id: created[2]._id }, { $set: { createdAt: justBefore } });

    const { stats, today: reportedDay } = await dashboardService.getDashboardStats();
    assert.equal(reportedDay, today, 'the reported day is the business day');
    assert.equal(stats.ordersToday, 2, 'both of today\'s orders count, the late-night one included');
    assert.equal(stats.deliveredSalesToday, 700, 'yesterday\'s 23:59 order stays out');
    assert.equal(stats.bookedSalesToday, 300);

    // The number on the card must equal the rows the card's link returns.
    const listed = await ordersService.findAll({ startDate: reportedDay, endDate: reportedDay });
    assert.equal(
      listed.length,
      stats.ordersToday,
      `card says ${stats.ordersToday} but /orders?startDate=${reportedDay}&endDate=${reportedDay} returns ${listed.length}`,
    );

    const delivered = await ordersService.findAll({
      status: 'delivered',
      startDate: reportedDay,
      endDate: reportedDay,
    });
    const deliveredTotal = delivered.reduce((sum, o) => sum + (o.grandTotal ?? 0), 0);
    assert.equal(deliveredTotal, stats.deliveredSalesToday, 'the sales card equals its own list');
  });

  await test('a start-only order filter means that day, not that day and the one before', async () => {
    // The widening was a workaround for the UTC/Karachi skew above. With the skew gone it only
    // returned rows the caller never asked for.
    const today = todayKey();
    const startOnly = await ordersService.findAll({ startDate: today });
    const bothBounds = await ordersService.findAll({ startDate: today, endDate: today });
    assert.equal(startOnly.length, bothBounds.length, 'one bound or two, the same day is meant');
  });

  await test('Total Clients equals the list that card opens', async () => {
    // The card counted only `status: 'active'` while `/clients` lists every client that is not
    // trashed, so the number read lower than the page it opened.
    await DealerModel.create({
      name: 'Dormant Shop', shopName: 'Dormant Shop', phone: '0311111102',
      latitude: 31.5, longitude: 74.3, shopImage: 'shop.jpg', category: 'retailer',
      route: routeId, createdBy: new Types.ObjectId(adminId), address: { city: 'Lahore' },
      status: 'inactive',
    });
    const { stats } = await dashboardService.getDashboardStats();
    const listed = await DealerModel.countDocuments({ isTrashed: { $ne: true } });
    assert.equal(stats.totalClients, listed, 'the card counts what /clients shows');
    assert.equal(stats.activeClients, listed - 1, 'the inactive one is reported separately');
  });

  await test('report buckets are labelled in the business timezone', async () => {
    // A UTC window sliced into Karachi buckets — or the reverse — puts the first and last five
    // hours of the range into periods only partly covered, so both ends of every trend line
    // read low for no visible reason.
    const today = todayKey();
    const reports = await dashboardService.getDashboardReports({
      startDate: today,
      endDate: today,
      groupBy: 'day',
    });
    for (const row of reports.salesTrend) {
      assert.equal(row.period, today, `a bucket outside the requested day leaked in: ${row.period}`);
    }
    assert.equal(
      reports.kpis.salesInRange,
      700,
      `only today's delivered order counts in ${REPORT_TIMEZONE}`,
    );
  });

  await test('the completed-tasks map carries the client pin under the name the page reads', async () => {
    // Regression: the API only ever sent `dealerLocation` while the dashboard read
    // `clientLocation`, so the shop pin silently never rendered.
    const payload = await dashboardService.getDashboardStats();
    for (const entry of payload.completedTasksForMap) {
      assert.ok('clientLocation' in entry, 'clientLocation is present');
      assert.deepEqual(entry.clientLocation, entry.dealerLocation, 'both names describe one pin');
    }
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} dashboard flow tests passed.`);
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
