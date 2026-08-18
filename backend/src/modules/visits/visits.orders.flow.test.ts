/**
 * Integration tests for "Order Lena" — taking an order during a shop check-in, and the
 * order amount that then shows against that visit in the visit report.
 *
 * Runs against a throwaway in-memory MongoDB, never the real database. Run with:
 *   npm run test:visits:orders
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { VisitModel } from '../../models/visit.model';
import { DealerModel } from '../../models/dealer.model';
import { UserModel } from '../../models/user.model';
import { ProductModel } from '../../models/product.model';
import { OrderModel } from '../../models/order.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { applyStockMovements } from '../warehouse/stock-ledger.service';
import { createOrderSchema } from '../orders/dto/orders.schemas';
import '../../models/route.model';
import '../../models/category.model';
import * as ordersService from '../orders/orders.service';
import * as visitsService from './visits.service';

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

const CATEGORY = new Types.ObjectId();
const RIDER_ID = new Types.ObjectId();
const OTHER_RIDER_ID = new Types.ObjectId();
const ADMIN_ID = new Types.ObjectId();

let mongod: MongoMemoryServer;
let dealerId: string;
let otherDealerId: string;
let productId: string;
let warehouseId: string;

/** A visit for RIDER_ID at the main dealer, in whatever status the case needs. */
async function makeVisit(overrides: Record<string, unknown> = {}) {
  return VisitModel.create({
    dealerId: new Types.ObjectId(dealerId),
    employeeId: RIDER_ID,
    visitDate: new Date(),
    status: 'checked_in',
    checkedInAt: new Date(),
    ...overrides,
  });
}

/** Punch an order of `quantity` units at Rs. 100 each, optionally bound to a visit. */
async function punchOrder(
  opts: { visitId?: string; dealer?: string; quantity?: number; actor?: Types.ObjectId; role?: string } = {},
) {
  return ordersService.createOrder(
    {
      dealerId: opts.dealer ?? dealerId,
      products: [{ productId, quantity: opts.quantity ?? 1, price: 100 }],
      ...(opts.visitId ? { visitId: opts.visitId } : {}),
    },
    String(opts.actor ?? RIDER_ID),
    opts.role ?? 'order_taker',
  );
}

/** The single visit row as the report renders it. */
async function reportRowFor(visitId: string) {
  const rows = (await visitsService.findAll({ employeeId: String(RIDER_ID) })) as Record<
    string,
    unknown
  >[];
  return rows.find((r) => String((r as { _id: Types.ObjectId })._id) === visitId);
}

type Summary = { orderCount: number; totalAmount: number; cancelledCount: number; invoiceNumbers: number[] };

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'visit-orders-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
  ]);

  const [dealer, otherDealer] = await DealerModel.create([
    { name: 'Test Shop', phone: '03001234567', address: { city: 'Lahore' } },
    { name: 'Other Shop', phone: '03001234568', address: { city: 'Lahore' } },
  ]);
  dealerId = String(dealer._id);
  otherDealerId = String(otherDealer._id);

  const warehouse = await WarehouseModel.create({
    name: 'Main Warehouse',
    city: 'Lahore',
    cityKey: 'lahore',
    isMain: true,
    isActive: true,
  });
  warehouseId = String(warehouse._id);

  await UserModel.create([
    {
      _id: RIDER_ID,
      userID: 'OT-1',
      username: 'rider.one',
      phone: '03009998887',
      password: 'x',
      role: 'order_taker',
      address: { city: 'Lahore' },
    },
    {
      _id: OTHER_RIDER_ID,
      userID: 'OT-2',
      username: 'rider.two',
      phone: '03009998888',
      password: 'x',
      role: 'order_taker',
      address: { city: 'Lahore' },
    },
    {
      _id: ADMIN_ID,
      userID: 'AD-1',
      username: 'admin.one',
      phone: '03009998889',
      password: 'x',
      role: 'admin',
      address: { city: 'Lahore' },
    },
  ]);

  const product = await ProductModel.create({
    barcode: 'P-1',
    name: 'Product A',
    purchasePrice: 40,
    salePrice: 100,
    categoryId: CATEGORY,
    createdBy: RIDER_ID,
  });
  productId = String(product._id);

  await applyStockMovements(
    [{ warehouseId, productId, bucket: 'sellable', delta: 10_000, type: 'opening_stock' }],
    { refType: 'opening_stock', refId: String(new Types.ObjectId()), actorId: String(RIDER_ID) },
  );

  // -------------------------------------------------------------------------
  console.log('Taking an order during check-in');
  // -------------------------------------------------------------------------
  await test('the DTO accepts a visitId', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      visitId: String(new Types.ObjectId()),
      products: [{ productId, quantity: 1, price: 100 }],
    });
    assert.equal(error, undefined);
  });

  await test('the DTO rejects a malformed visitId', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      visitId: 'not-an-id',
      products: [{ productId, quantity: 1, price: 100 }],
    });
    assert.ok(error, 'expected a validation error');
  });

  await test('a checked-in rider can punch an order bound to the visit', async () => {
    const visit = await makeVisit();
    const order = await punchOrder({ visitId: String(visit._id), quantity: 3 });

    assert.equal(String(order.visitId), String(visit._id));
    assert.equal(order.grandTotal, 300);
  });

  await test('an order with no visitId is stored unlinked, as before', async () => {
    const order = await punchOrder({ quantity: 2 });
    assert.equal(order.visitId, undefined);
  });

  // -------------------------------------------------------------------------
  console.log('\nGuards on the visit link');
  // -------------------------------------------------------------------------
  await test('a visit that is only "todo" is refused — the rider is not at the shop yet', async () => {
    const visit = await makeVisit({ status: 'todo', checkedInAt: undefined });
    await rejectsWith(
      punchOrder({ visitId: String(visit._id) }),
      /must be checked in at the store/i,
    );
  });

  await test('an already-completed visit is refused', async () => {
    const visit = await makeVisit({ status: 'completed', completedAt: new Date() });
    await rejectsWith(
      punchOrder({ visitId: String(visit._id) }),
      /must be checked in at the store/i,
    );
  });

  await test("another rider's visit is refused", async () => {
    const visit = await makeVisit({ employeeId: OTHER_RIDER_ID });
    await rejectsWith(punchOrder({ visitId: String(visit._id) }), /not assigned to you/i);
  });

  await test('an admin may punch an order against a rider visit on their behalf', async () => {
    const visit = await makeVisit();
    const order = await punchOrder({
      visitId: String(visit._id),
      actor: ADMIN_ID,
      role: 'admin',
    });
    assert.equal(String(order.visitId), String(visit._id));
  });

  await test('a client that is not the visit\'s shop is refused', async () => {
    const visit = await makeVisit();
    await rejectsWith(
      punchOrder({ visitId: String(visit._id), dealer: otherDealerId }),
      /does not match the client of this visit/i,
    );
  });

  await test('an unknown visit id is a 404', async () => {
    await rejectsWith(
      punchOrder({ visitId: String(new Types.ObjectId()) }),
      /Visit not found/i,
    );
  });

  await test('a trashed visit is refused', async () => {
    const visit = await makeVisit({ isTrashed: true });
    await rejectsWith(punchOrder({ visitId: String(visit._id) }), /Visit not found/i);
  });

  await test('a rejected visit link reserves NO stock — the order never existed', async () => {
    const visit = await makeVisit({ status: 'todo', checkedInAt: undefined });
    const before = await ProductModel.findById(productId).select('quantity').lean();

    await rejectsWith(punchOrder({ visitId: String(visit._id), quantity: 5 }), /checked in/i);

    const after = await ProductModel.findById(productId).select('quantity').lean();
    assert.equal(after?.quantity, before?.quantity);
  });

  // -------------------------------------------------------------------------
  console.log('\nThe visit report');
  // -------------------------------------------------------------------------
  await test('a visit with an order reports the amount', async () => {
    const visit = await makeVisit();
    await punchOrder({ visitId: String(visit._id), quantity: 4 });

    const row = await reportRowFor(String(visit._id));
    const summary = row?.orderSummary as Summary;

    assert.ok(summary, 'expected an orderSummary');
    assert.equal(summary.orderCount, 1);
    assert.equal(summary.totalAmount, 400);
    assert.equal(summary.invoiceNumbers.length, 1);
  });

  await test('a visit with NO order has no summary at all — the UI reads that as "No Order"', async () => {
    const visit = await makeVisit();
    const row = await reportRowFor(String(visit._id));

    // Deliberately absent rather than a zeroed object: "no order" and "an order worth 0"
    // are different facts and the report must not collapse them.
    assert.equal(row?.orderSummary, undefined);
  });

  await test('two orders during one visit are summed and counted', async () => {
    const visit = await makeVisit();
    await punchOrder({ visitId: String(visit._id), quantity: 2 });
    await punchOrder({ visitId: String(visit._id), quantity: 3 });

    const summary = (await reportRowFor(String(visit._id)))?.orderSummary as Summary;
    assert.equal(summary.orderCount, 2);
    assert.equal(summary.totalAmount, 500);
  });

  await test('a cancelled order still counts but is excluded from the amount', async () => {
    const visit = await makeVisit();
    const live = await punchOrder({ visitId: String(visit._id), quantity: 2 });
    const dead = await punchOrder({ visitId: String(visit._id), quantity: 7 });
    await OrderModel.updateOne({ _id: dead._id }, { $set: { status: 'cancelled' } });

    const summary = (await reportRowFor(String(visit._id)))?.orderSummary as Summary;
    assert.equal(summary.orderCount, 2);
    assert.equal(summary.cancelledCount, 1);
    // Only the live order's money — the cancelled 700 must not inflate the report.
    assert.equal(summary.totalAmount, 200);
    assert.equal(String(live.dealerId), dealerId);
  });

  await test('a trashed order drops out of the visit total entirely', async () => {
    const visit = await makeVisit();
    const order = await punchOrder({ visitId: String(visit._id), quantity: 2 });
    await OrderModel.updateOne({ _id: order._id }, { $set: { isTrashed: true } });

    assert.equal((await reportRowFor(String(visit._id)))?.orderSummary, undefined);
  });

  await test('an unlinked order never leaks onto another visit of the same shop', async () => {
    const visit = await makeVisit();
    await punchOrder({ quantity: 9 }); // same dealer, same rider, but no visit link

    assert.equal((await reportRowFor(String(visit._id)))?.orderSummary, undefined);
  });

  await test('findById carries the same summary as the list', async () => {
    const visit = await makeVisit();
    await punchOrder({ visitId: String(visit._id), quantity: 6 });

    const detail = (await visitsService.findById(String(visit._id))) as Record<string, unknown>;
    const summary = detail.orderSummary as Summary;

    assert.equal(summary.orderCount, 1);
    assert.equal(summary.totalAmount, 600);
  });

  await test('findById still enforces scope, and still returns a plain object', async () => {
    const foreign = await VisitModel.create({
      dealerId: new Types.ObjectId(dealerId),
      employeeId: OTHER_RIDER_ID,
      visitDate: new Date(),
      status: 'checked_in',
    });

    await rejectsWith(visitsService.findById(String(foreign._id), [RIDER_ID]), /not found/i);

    const ok = (await visitsService.findById(String(foreign._id), [OTHER_RIDER_ID])) as Record<
      string,
      unknown
    >;
    assert.equal(String(ok._id), String(foreign._id));
    // The populated dealer must survive the toObject() the summary attach does.
    assert.equal((ok.dealerId as { name?: string })?.name, 'Test Shop');
  });

  await test('the order survives checkout — the report still shows it after completion', async () => {
    const visit = await makeVisit();
    await punchOrder({ visitId: String(visit._id), quantity: 5 });
    await VisitModel.updateOne(
      { _id: visit._id },
      { $set: { status: 'completed', completedAt: new Date() } },
    );

    const summary = (await reportRowFor(String(visit._id)))?.orderSummary as Summary;
    assert.equal(summary.totalAmount, 500);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} visit-order integration tests passed.`);
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
