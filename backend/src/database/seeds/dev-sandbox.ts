/**
 * Disposable local sandbox: starts an in-memory MongoDB on port 27018, seeds demo
 * data, and stays running so the backend + admin panel can be exercised without
 * touching the real database.
 *
 * Usage (three terminals):
 *   1. npm run sandbox                              # this script — keep it running
 *   2. MONGODB_URI=mongodb://127.0.0.1:27018/sandbox npm run dev
 *   3. cd ../admin && npm run dev
 *
 * Logins (all password `admin123`):
 *   admin          — sees every team
 *   manager.north  — sales manager, sees only their own riders
 *   rider.ali      — rider, sees only their own scorecard
 *
 * All data vanishes when the script is stopped.
 */
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import { VisitModel } from '../../models/visit.model';
import { TargetModel } from '../../models/target.model';
import { RouteModel } from '../../models/route.model';
import { AttendanceModel } from '../../models/attendance.model';
import { ReturnModel } from '../../models/return.model';
import { TaskModel } from '../../models/task.model';
import { ProductModel } from '../../models/product.model';
import { CategoryModel } from '../../models/category.model';
import { seedAccessPolicies } from './access-policies.seed';
import { toPeriodMonth } from '../../modules/analytics/analytics.rules';

const PORT = 27018;
const DB_NAME = 'sandbox';

/** A date `daysAgo` days back, at midday UTC. */
function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

async function main(): Promise<void> {
  let mongod: MongoMemoryServer | null = null;
  let uri = `mongodb://127.0.0.1:${PORT}/${DB_NAME}`;
  try {
    mongod = await MongoMemoryServer.create({ instance: { port: PORT, dbName: DB_NAME } });
    uri = mongod.getUri();
  } catch {
    // A sandbox from a previous run is still holding the port — reuse it rather than
    // failing, then wipe below so seeding stays idempotent.
    // eslint-disable-next-line no-console
    console.log(`  Reusing the sandbox already listening on port ${PORT}.`);
  }

  await mongoose.connect(uri, { dbName: DB_NAME });
  // Always start from a clean slate so re-running never hits duplicate-key errors.
  await mongoose.connection.dropDatabase();

  const password = await bcrypt.hash('admin123', 10);

  const adminId = new Types.ObjectId();
  const managerNorthId = new Types.ObjectId();
  const managerSouthId = new Types.ObjectId();
  const aliId = new Types.ObjectId();
  const binaId = new Types.ObjectId();
  const chandId = new Types.ObjectId();

  await UserModel.create([
    { _id: adminId, userID: 'ADM-1', username: 'admin', fullName: 'System Admin', phone: '03000000000', password, role: 'admin' },
    { _id: managerNorthId, userID: 'SM-1', username: 'manager.north', fullName: 'Nadia North', phone: '03000000001', password, role: 'sales_manager' },
    { _id: managerSouthId, userID: 'SM-2', username: 'manager.south', fullName: 'Sami South', phone: '03000000002', password, role: 'sales_manager' },
    // Cities drive both the rider client-filter and the region-sales dashboard.
    // Ali and Bina share a city with deliberately different casing, to exercise the
    // region grouping's normalisation.
    { _id: aliId, userID: 'RID-1', username: 'rider.ali', fullName: 'Ali Raza', phone: '03000000003', password, role: 'order_taker', managerId: managerNorthId, address: { city: 'Lahore' } },
    { _id: binaId, userID: 'RID-2', username: 'rider.bina', fullName: 'Bina Khan', phone: '03000000004', password, role: 'order_taker', managerId: managerNorthId, address: { city: 'lahore' } },
    { _id: chandId, userID: 'RID-3', username: 'rider.chand', fullName: 'Chand Bibi', phone: '03000000005', password, role: 'order_taker', managerId: managerSouthId, address: { city: 'Karachi' } },
  ]);

  const route = await RouteModel.create({ name: 'North Beat', startingPoint: 'Depot', endingPoint: 'Clifton' });

  // Shops, split across the two cities so the rider client-filter has something to hide.
  const shops = await DealerModel.create([
    { name: 'Al-Madina Store', phone: '03111111101', latitude: 24.8607, longitude: 67.0011, route: route._id, address: { city: 'Lahore' } },
    { name: 'Bismillah Mart', phone: '03111111102', latitude: 24.8650, longitude: 67.0100, route: route._id, address: { city: 'Lahore' } },
    { name: 'City Kiryana', phone: '03111111103', latitude: 24.8700, longitude: 67.0200, route: route._id, address: { city: 'Karachi' } },
    // Registered in the field by Ali this month — shows up as a "new client".
    { name: 'New Corner Shop', phone: '03111111104', latitude: 24.8720, longitude: 67.0250, createdBy: aliId, createdAt: daysAgo(4), address: { city: 'Karachi' } },
  ]);

  const riders = [
    { id: aliId, delivered: [42000, 31500, 18750], booked: [9500], visits: [18, 26, 41, 22], target: { salesAmount: 120000, orderCount: 8, visitCount: 12 } },
    { id: binaId, delivered: [15000, 9800], booked: [4200, 3100], visits: [25, 35], target: { salesAmount: 90000, orderCount: 6, visitCount: 10 } },
    // No target set — exercises the "no target ≠ 0%" path in the UI.
    { id: chandId, delivered: [67000, 22000], booked: [], visits: [15, 19, 55], target: null },
  ];

  for (const [index, rider] of riders.entries()) {
    const orders: Record<string, unknown>[] = [];
    rider.delivered.forEach((grandTotal, i) => {
      orders.push({
        dealerId: shops[i % shops.length]._id,
        createdBy: rider.id,
        status: 'delivered',
        grandTotal,
        products: [],
        createdAt: daysAgo(3 + i * 2),
      });
    });
    rider.booked.forEach((grandTotal, i) => {
      orders.push({
        dealerId: shops[i % shops.length]._id,
        createdBy: rider.id,
        status: 'pending',
        grandTotal,
        products: [],
        createdAt: daysAgo(1 + i),
      });
    });
    if (orders.length) await OrderModel.create(orders);

    // Completed visits with real durations — some deliberately over the 30-minute limit.
    const visits = rider.visits.map((durationMinutes, i) => {
      const checkedInAt = daysAgo(2 + i);
      const completedAt = new Date(checkedInAt.getTime() + durationMinutes * 60_000);
      return {
        dealerId: shops[i % shops.length]._id,
        employeeId: rider.id,
        routeId: route._id,
        visitDate: checkedInAt,
        status: 'completed',
        checkedInAt,
        checkedInLatitude: 24.8607,
        checkedInLongitude: 67.0011,
        completedAt,
        durationMinutes,
        overstayFlagged: durationMinutes > 30,
        latitude: 24.8607,
        longitude: 67.0011,
        completionImages: [
          { type: 'shop', url: '/uploads/completions/demo-shop.jpg' },
          { type: 'selfie', url: '/uploads/completions/demo-selfie.jpg' },
        ],
        ...(i === 0 && {
          galleryImages: [{ url: '/uploads/completions/demo-gallery.jpg', caption: 'Storefront' }],
          visitNotes: 'Owner asked for more stock of the 500ml bottles next week.',
          galleryUpdatedAt: completedAt,
        }),
      };
    });
    // Plus one still-open visit so completion rate is not a flat 100%.
    visits.push({
      dealerId: shops[(index + 1) % shops.length]._id,
      employeeId: rider.id,
      routeId: route._id,
      visitDate: daysAgo(0),
      status: 'todo',
    } as never);
    await VisitModel.create(visits);

    // Attendance: a few worked days, one still open (no checkout) so hours < days.
    const attendance = [6, 5, 4, 3].map((back, i) => {
      const date = daysAgo(back);
      const checkInTime = new Date(date.getTime() - 3 * 3600_000);
      const open = i === 3;
      return {
        employeeId: rider.id,
        date,
        checkInTime,
        checkInLatitude: 24.8607,
        checkInLongitude: 67.0011,
        ...(open ? {} : { checkOutTime: new Date(checkInTime.getTime() + (7 + i) * 3600_000) }),
      };
    });
    await AttendanceModel.create(attendance);

    // A return and a damage, so the quality metrics are non-zero.
    await ReturnModel.create([
      {
        dealerId: shops[index % shops.length]._id,
        createdBy: rider.id,
        returnType: 'return',
        amount: 1500 * (index + 1),
        products: [],
        status: 'completed',
        createdAt: daysAgo(3),
      },
      {
        dealerId: shops[index % shops.length]._id,
        createdBy: rider.id,
        returnType: 'damage',
        amount: 400,
        products: [],
        status: 'completed',
        createdAt: daysAgo(2),
      },
    ]);

    // Assigned tasks, partially done.
    await TaskModel.create([
      { taskName: 'Merchandising check', assignedTo: rider.id, assignedBy: adminId, createdBy: adminId, status: 'completed', createdAt: daysAgo(4) },
      { taskName: 'Collect signage', assignedTo: rider.id, assignedBy: adminId, createdBy: adminId, status: 'completed', createdAt: daysAgo(3) },
      { taskName: 'Competitor pricing survey', assignedTo: rider.id, assignedBy: adminId, createdBy: adminId, status: 'pending', createdAt: daysAgo(1) },
    ]);

    if (rider.target) {
      await TargetModel.create({
        employeeId: rider.id,
        periodMonth: toPeriodMonth(new Date()),
        ...rider.target,
        createdBy: managerNorthId,
      });
    }
  }

  // A catalogue to pick from. Without this the order form has an empty product dropdown and
  // nothing about product access can be exercised here.
  const [beverages, snacks] = await CategoryModel.create([
    { name: 'Beverages', createdBy: adminId },
    { name: 'Snacks', createdBy: adminId },
  ]);

  await ProductModel.create([
    // `purchasePrice` and `lastPurchaseRate` are set deliberately: they are what the picker
    // endpoint must NOT return to a Salesman.
    { barcode: '8001', name: 'Cola 500ml', salePrice: 120, purchasePrice: 80, lastPurchaseRate: 78, quantity: 240, survivalQuantity: 24, categoryId: beverages._id, createdBy: adminId },
    { barcode: '8002', name: 'Cola 1.5L', salePrice: 260, purchasePrice: 190, lastPurchaseRate: 186, quantity: 90, survivalQuantity: 12, categoryId: beverages._id, createdBy: adminId },
    { barcode: '8003', name: 'Mango Juice 250ml', salePrice: 70, purchasePrice: 44, quantity: 0, survivalQuantity: 20, categoryId: beverages._id, createdBy: adminId },
    { barcode: '8004', name: 'Salted Chips 60g', salePrice: 60, purchasePrice: 38, lastPurchaseRate: 37, quantity: 310, categoryId: snacks._id, createdBy: adminId },
    { barcode: '8005', name: 'Chocolate Bar', salePrice: 150, purchasePrice: 96, quantity: 45, categoryId: snacks._id, createdBy: adminId },
  ]);

  // The permission matrix lives in the database. With no policy documents every non-admin
  // resolves to the empty set and 403s on everything, which looks like a broken build rather
  // than an unseeded one.
  await seedAccessPolicies({ force: true, backfillUsers: true });

  /* eslint-disable no-console */
  console.log('\n  Sandbox MongoDB ready — the real database is untouched.\n');
  console.log(`  MONGODB_URI=mongodb://127.0.0.1:${PORT}/${DB_NAME}\n`);
  console.log('  Start the API against it with:');
  console.log(`    MONGODB_URI=mongodb://127.0.0.1:${PORT}/${DB_NAME} npm run dev\n`);
  console.log('  Logins (password: admin123)');
  console.log('    admin          — sees every team');
  console.log('    manager.north  — sales manager: Ali + Bina only');
  console.log('    manager.south  — sales manager: Chand only');
  console.log('    rider.ali      — Salesman: books orders, no product catalogue\n');
  console.log('  5 products across 2 categories; the permission matrix is seeded.\n');
  console.log('  Ctrl+C to stop and discard all data.\n');
  /* eslint-enable no-console */

  const shutdown = async () => {
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Sandbox failed to start:', err);
  process.exit(1);
});
