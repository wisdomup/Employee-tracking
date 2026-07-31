/**
 * Integration test for performance analytics and monthly targets.
 *
 * Runs against a throwaway in-memory MongoDB — never the real database.
 * Verifies the aggregations against known fixture data and, critically, that
 * role scoping does not leak one team's numbers to another manager.
 *
 * Run with: npm run test:analytics:flow
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import { VisitModel } from '../../models/visit.model';
import { TargetModel } from '../../models/target.model';
import { AttendanceModel } from '../../models/attendance.model';
import { ReturnModel } from '../../models/return.model';
import { TaskModel } from '../../models/task.model';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import * as analyticsService from './analytics.service';
import * as targetsService from '../targets/targets.service';
import { toPeriodMonth } from './analytics.rules';

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

// Two managers, each with their own rider, plus an unmanaged rider.
const MANAGER_A = new Types.ObjectId();
const MANAGER_B = new Types.ObjectId();
const RIDER_A = new Types.ObjectId();
const RIDER_B = new Types.ObjectId();
const ADMIN_ID = new Types.ObjectId();

const PERIOD = toPeriodMonth(new Date());
/** A date safely inside the current month (day 15, midday UTC). */
function inThisMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12, 0, 0));
}

let mongod: MongoMemoryServer;
let dealerId: Types.ObjectId;

/** Rows are keyed by employee id for readable assertions. */
function rowFor(report: { rows: { employeeId: string }[] }, id: Types.ObjectId) {
  return report.rows.find((r) => r.employeeId === String(id));
}

async function seed(): Promise<void> {
  await UserModel.create([
    { _id: MANAGER_A, userID: 'M-A', username: 'manager.a', phone: '0300000001', password: 'x', role: 'sales_manager' },
    { _id: MANAGER_B, userID: 'M-B', username: 'manager.b', phone: '0300000002', password: 'x', role: 'sales_manager' },
    { _id: RIDER_A, userID: 'R-A', username: 'rider.a', phone: '0300000003', password: 'x', role: 'order_taker', managerId: MANAGER_A },
    { _id: RIDER_B, userID: 'R-B', username: 'rider.b', phone: '0300000004', password: 'x', role: 'order_taker', managerId: MANAGER_B },
    { _id: ADMIN_ID, userID: 'A-1', username: 'admin.one', phone: '0300000005', password: 'x', role: 'admin' },
  ]);

  const dealer = await DealerModel.create({ name: 'Shop', phone: '0311111111' });
  dealerId = dealer._id as Types.ObjectId;

  const when = inThisMonth();

  // Rider A: 2 delivered orders worth 1000 + 500, and 1 pending worth 300 (booked, not sales).
  await OrderModel.create([
    { dealerId, createdBy: RIDER_A, status: 'delivered', grandTotal: 1000, createdAt: when },
    { dealerId, createdBy: RIDER_A, status: 'delivered', grandTotal: 500, createdAt: when },
    { dealerId, createdBy: RIDER_A, status: 'pending', grandTotal: 300, createdAt: when },
    // Cancelled must be ignored entirely.
    { dealerId, createdBy: RIDER_A, status: 'cancelled', grandTotal: 9999, createdAt: when },
    // Trashed must be ignored entirely.
    { dealerId, createdBy: RIDER_A, status: 'delivered', grandTotal: 7777, createdAt: when, isTrashed: true },
    // An order with no grandTotal must not break the sum.
    { dealerId, createdBy: RIDER_A, status: 'delivered', createdAt: when },
  ]);

  // Rider B: one delivered order worth 250.
  await OrderModel.create([
    { dealerId, createdBy: RIDER_B, status: 'delivered', grandTotal: 250, createdAt: when },
  ]);

  // Rider A visits: 2 completed (one flagged as an overstay), 1 still todo.
  await VisitModel.create([
    { dealerId, employeeId: RIDER_A, status: 'completed', completedAt: when, visitDate: when, durationMinutes: 20, overstayFlagged: false },
    { dealerId, employeeId: RIDER_A, status: 'completed', completedAt: when, visitDate: when, durationMinutes: 40, overstayFlagged: true },
    { dealerId, employeeId: RIDER_A, status: 'todo', visitDate: when },
  ]);

  // A new shop registered by rider A this month.
  await DealerModel.create({ name: 'New Shop', phone: '0322222222', createdBy: RIDER_A, createdAt: when });

  // Rider A attendance: an 8h day, a 6h day, and an OPEN shift that must count as a day
  // present but contribute no hours.
  const shift = (dayOffset: number, hours: number | null) => {
    const date = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 10 + dayOffset));
    const checkInTime = new Date(date.getTime() + 9 * 3600_000);
    return {
      employeeId: RIDER_A,
      date,
      checkInTime,
      checkInLatitude: 24.86,
      checkInLongitude: 67.0,
      ...(hours != null && { checkOutTime: new Date(checkInTime.getTime() + hours * 3600_000) }),
    };
  };
  await AttendanceModel.create([shift(0, 8), shift(1, 6), shift(2, null)]);

  // Rider A raised one return and one damage.
  await ReturnModel.create([
    { dealerId, createdBy: RIDER_A, returnType: 'return', amount: 1200, products: [], createdAt: when },
    { dealerId, createdBy: RIDER_A, returnType: 'damage', amount: 300, products: [], createdAt: when },
  ]);

  // Rider A: 3 tasks, 2 completed.
  await TaskModel.create([
    { taskName: 'T1', assignedTo: RIDER_A, assignedBy: ADMIN_ID, createdBy: ADMIN_ID, status: 'completed', createdAt: when },
    { taskName: 'T2', assignedTo: RIDER_A, assignedBy: ADMIN_ID, createdBy: ADMIN_ID, status: 'completed', createdAt: when },
    { taskName: 'T3', assignedTo: RIDER_A, assignedBy: ADMIN_ID, createdBy: ADMIN_ID, status: 'pending', createdAt: when },
  ]);
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'analytics-flow-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await seed();

  // -------------------------------------------------------------------------
  console.log('Sales and order aggregation');
  // -------------------------------------------------------------------------
  await test('delivered orders sum into salesAmount; pending/cancelled/trashed excluded', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A);
    assert.ok(a, 'rider A should appear in the admin report');
    // 1000 + 500 + (order with no grandTotal → 0) = 1500
    assert.equal(a!.salesAmount, 1500);
    // 3 delivered orders counted (including the one with no total)
    assert.equal(a!.orderCount, 3);
  });

  await test('booked (pending/approved/packed/dispatched) is tracked separately from sales', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A);
    assert.equal(a!.bookedAmount, 300);
    // The booked order must NOT inflate realised sales.
    assert.equal(a!.salesAmount, 1500);
  });

  await test('visit productivity: completed, assigned, avg duration, overstays', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    assert.equal(a.visitsCompleted, 2);
    assert.equal(a.visitsAssigned, 3);
    assert.equal(a.visitCompletionRate, 66.7);
    assert.equal(a.avgVisitMinutes, 30); // (20 + 40) / 2
    assert.equal(a.overstayCount, 1);
  });

  await test('new clients created in the period are credited to the rider', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    assert.equal(rowFor(report, RIDER_A)!.newClients, 1);
  });

  await test('a rider with no activity still appears, with zeroes rather than being dropped', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const b = rowFor(report, RIDER_B)!;
    assert.equal(b.salesAmount, 250);
    assert.equal(b.visitsCompleted, 0);
    assert.equal(b.newClients, 0);
    assert.equal(b.avgVisitMinutes, null, 'no timed visits means null, not 0');
  });

  await test('managers are excluded from the rows (only field staff are measured)', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    assert.equal(rowFor(report, MANAGER_A), undefined);
  });

  // -------------------------------------------------------------------------
  console.log('\nTargets and achievement');
  // -------------------------------------------------------------------------
  await test('a manager can set a target for their own rider', async () => {
    const target = await targetsService.upsertTarget(
      { employeeId: String(RIDER_A), periodMonth: PERIOD, salesAmount: 3000, orderCount: 10, visitCount: 4 },
      String(MANAGER_A),
      'sales_manager',
    );
    assert.equal(target!.salesAmount, 3000);
    assert.equal(target!.periodMonth, PERIOD);
  });

  await test('setting the same month again updates rather than duplicating', async () => {
    await targetsService.upsertTarget(
      { employeeId: String(RIDER_A), periodMonth: PERIOD, salesAmount: 2000 },
      String(MANAGER_A),
      'sales_manager',
    );
    const all = await TargetModel.find({ employeeId: RIDER_A, periodMonth: PERIOD });
    assert.equal(all.length, 1, 'must upsert, not create a second row');
    assert.equal(all[0].salesAmount, 2000);
    assert.equal(all[0].orderCount, 10, 'untouched metrics survive the update');
  });

  await test('a manager CANNOT set a target for another manager\'s rider', async () => {
    await rejectsWith(
      targetsService.upsertTarget(
        { employeeId: String(RIDER_B), periodMonth: PERIOD, salesAmount: 1 },
        String(MANAGER_A),
        'sales_manager',
      ),
      /only set targets for your own team/i,
    );
  });

  await test('a rider CANNOT set targets at all', async () => {
    await rejectsWith(
      targetsService.upsertTarget(
        { employeeId: String(RIDER_A), periodMonth: PERIOD, salesAmount: 1 },
        String(RIDER_A),
        'order_taker',
      ),
      /not allowed to set targets/i,
    );
  });

  await test('a malformed period month is rejected', async () => {
    await rejectsWith(
      targetsService.upsertTarget(
        { employeeId: String(RIDER_A), periodMonth: '2026-13', salesAmount: 1 },
        String(ADMIN_ID),
        'admin',
      ),
      /YYYY-MM/,
    );
  });

  await test('achievement is computed against the target', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    assert.equal(a.targetSalesAmount, 2000);
    assert.equal(a.salesAchievementPercent, 75); // 1500 / 2000
    assert.equal(a.salesRemaining, 500);
    assert.equal(a.orderAchievementPercent, 30); // 3 / 10
    assert.equal(a.visitAchievementPercent, 50); // 2 / 4
  });

  await test('a rider with no target reports null achievement, not zero', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const b = rowFor(report, RIDER_B)!;
    assert.equal(b.targetSalesAmount, null);
    assert.equal(b.salesAchievementPercent, null);
    assert.equal(b.status, 'no_target');
  });

  // -------------------------------------------------------------------------
  console.log('\nRole scoping (the security-critical part)');
  // -------------------------------------------------------------------------
  await test('admin sees every rider', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    assert.ok(rowFor(report, RIDER_A));
    assert.ok(rowFor(report, RIDER_B));
  });

  await test('a manager sees ONLY their own rider, never the other team', async () => {
    const report = await analyticsService.getPerformance({}, String(MANAGER_A), 'sales_manager');
    assert.ok(rowFor(report, RIDER_A), 'own rider must be visible');
    assert.equal(rowFor(report, RIDER_B), undefined, 'other team must NOT leak');
  });

  await test('a manager explicitly requesting another team\'s rider gets an empty report', async () => {
    const report = await analyticsService.getPerformance(
      { employeeId: String(RIDER_B) },
      String(MANAGER_A),
      'sales_manager',
    );
    assert.equal(report.rows.length, 0);
    assert.equal(report.kpis.salesAmount, 0);
  });

  await test('a rider sees only themselves', async () => {
    const report = await analyticsService.getPerformance({}, String(RIDER_A), 'order_taker');
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].employeeId, String(RIDER_A));
  });

  await test('a rider requesting a peer gets an empty report', async () => {
    const report = await analyticsService.getPerformance(
      { employeeId: String(RIDER_B) },
      String(RIDER_A),
      'order_taker',
    );
    assert.equal(report.rows.length, 0);
  });

  await test('target listing is scoped the same way', async () => {
    const forManagerB = await targetsService.findTargets({
      employeeIds: [MANAGER_B, RIDER_B],
    });
    assert.ok(
      forManagerB.every((t) => String((t.employeeId as { _id?: Types.ObjectId })._id) !== String(RIDER_A)),
      "manager B must not see rider A's targets",
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nPeriod isolation and KPI rollup');
  // -------------------------------------------------------------------------
  await test('a different month reports zero for the same rider', async () => {
    const report = await analyticsService.getPerformance(
      { periodMonth: '2020-01' },
      String(ADMIN_ID),
      'admin',
    );
    const a = rowFor(report, RIDER_A)!;
    assert.equal(a.salesAmount, 0, 'this month\'s orders must not bleed into another month');
    assert.equal(a.visitsCompleted, 0);
  });

  await test('team KPIs roll up the per-rider rows', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    assert.equal(report.kpis.salesAmount, 1750); // 1500 + 250
    assert.equal(report.kpis.orderCount, 4); // 3 + 1
    assert.equal(report.kpis.headcount, 2);
    assert.equal(report.kpis.ridersWithTarget, 1);
    assert.equal(report.kpis.overstayCount, 1);
  });

  await test('trend returns a dense monthly series aligned to labels', async () => {
    const trend = await analyticsService.getTrend({ months: 3 }, String(ADMIN_ID), 'admin');
    assert.equal(trend.months.length, 3);
    assert.equal(trend.sales.length, 3);
    assert.equal(trend.orders.length, 3);
    assert.equal(trend.visits.length, 3);
    assert.equal(trend.months[trend.months.length - 1], PERIOD, 'series ends on the current month');
    // Current month holds all the seeded activity.
    assert.equal(trend.sales[trend.sales.length - 1], 1750);
    assert.equal(trend.visits[trend.visits.length - 1], 2);
    // Earlier months are present and zero-filled rather than missing.
    assert.equal(trend.sales[0], 0);
  });

  await test('trend is scoped to the caller too', async () => {
    const trend = await analyticsService.getTrend({ months: 3 }, String(MANAGER_A), 'sales_manager');
    // Only rider A's 1500 — rider B's 250 belongs to the other team.
    assert.equal(trend.sales[trend.sales.length - 1], 1500);
  });

  // -------------------------------------------------------------------------
  console.log('\nExpanded metrics');
  // -------------------------------------------------------------------------
  await test('attendance: days present counts open shifts, hours only closed ones', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    assert.equal(a.daysPresent, 3, 'the open shift still counts as a day present');
    assert.equal(a.hoursWorked, 14, '8h + 6h; the open shift adds nothing');
    // 14h over 3 days.
    assert.equal(a.avgHoursPerDay, 4.7);
  });

  await test('attendance: a rider with no attendance rows reports zeroes, not null', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const b = rowFor(report, RIDER_B)!;
    assert.equal(b.daysPresent, 0);
    assert.equal(b.hoursWorked, 0);
    assert.equal(b.avgHoursPerDay, null);
  });

  await test('returns and damages are attributed and rated against sales', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    assert.equal(a.returnCount, 2);
    assert.equal(a.returnAmount, 1500);
    assert.equal(a.damageCount, 1);
    // 1500 of 1500 sales = 100%.
    assert.equal(a.returnRatePercent, 100);
  });

  await test('task throughput and completion rate', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    assert.equal(a.tasksAssigned, 3);
    assert.equal(a.tasksCompleted, 2);
    assert.equal(a.taskCompletionRate, 66.7);
  });

  await test('collection health: invoiced vs collected vs outstanding', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    // Non-cancelled orders: 1000 + 500 + 300(pending) + 0(no total) = 1800 invoiced.
    // The trashed 7777 and cancelled 9999 must both be excluded.
    assert.equal(a.invoicedTotal, 1800);
    assert.equal(a.collectedTotal, 0, 'no paidAmount was seeded');
    assert.equal(a.outstandingTotal, 1800);
    assert.equal(a.collectionRatePercent, 0);
  });

  await test('efficiency ratios: avg order value, strike rate, per-day figures', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    // 1500 across 3 delivered orders.
    assert.equal(a.avgOrderValue, 500);
    // 3 orders from 2 completed visits.
    assert.equal(a.strikeRatePercent, 150);
    // 1500 over 3 days present.
    assert.equal(a.salesPerDayPresent, 500);
    assert.equal(a.visitsPerDayPresent, 0.7);
  });

  await test('visit completion threshold is surfaced per employee', async () => {
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    // 2 completed of 3 assigned = 66.7%, under the 75% pass mark.
    assert.equal(a.visitCompletionRate, 66.7);
    assert.equal(a.belowVisitThreshold, true);
    assert.equal(report.kpis.visitThresholdPercent, 75);
    assert.ok(report.kpis.ridersBelowVisitThreshold >= 1);
  });

  await test('skipped visits are counted and stay in the denominator', async () => {
    const when = inThisMonth();
    await VisitModel.create({
      dealerId,
      employeeId: RIDER_B,
      visitDate: when,
      status: 'skipped',
      skippedAt: when,
    });
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const b = rowFor(report, RIDER_B)!;
    assert.equal(b.visitsSkipped, 1);
    assert.equal(b.visitsAssigned, 1, 'a skip still counts as assigned work');
    assert.equal(b.visitsCompleted, 0);
    assert.equal(b.visitCompletionRate, 0);
    assert.equal(b.belowVisitThreshold, true);
  });

  await test('open performance flags are surfaced per employee', async () => {
    await PerformanceFlagModel.create({
      employeeId: RIDER_A,
      type: 'low_visit_completion',
      flagDate: inThisMonth(),
      message: 'test flag',
      value: 50,
      threshold: 75,
    });
    const report = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    const a = rowFor(report, RIDER_A)!;
    assert.equal(a.flagsTotal, 1);
    assert.equal(a.flagsOpen, 1);
    assert.equal(a.lowCompletionFlags, 1);
    assert.ok(report.kpis.flagsOpen >= 1);
  });

  await test('the empty report has exactly the same KPI keys as a populated one', async () => {
    const populated = await analyticsService.getPerformance({}, String(ADMIN_ID), 'admin');
    // A manager with no team resolves to an empty report.
    const empty = await analyticsService.getPerformance(
      { employeeId: String(RIDER_A) },
      String(MANAGER_B),
      'sales_manager',
    );
    assert.equal(empty.rows.length, 0);
    assert.deepEqual(
      Object.keys(empty.kpis).sort(),
      Object.keys(populated.kpis).sort(),
      'shape drift would make the frontend read undefined KPIs',
    );
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} analytics integration tests passed.`);
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
