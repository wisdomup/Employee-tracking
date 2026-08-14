/**
 * Integration test for the Delivery Boy (Rider) collection flow.
 *
 * Runs against a throwaway in-memory MongoDB — never the real database.
 * Covers the things most likely to be quietly wrong or expensive if wrong: the delivery state
 * machine, the cash+online+credit invariant, city segregation, double-tap idempotency, the
 * two-step cash settlement, and — the load-bearing one — that delivering an order moves NO
 * stock, because stock already left the warehouse when the order was created.
 *
 * Run with: npm run test:collections:flow
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import { ProductModel } from '../../models/product.model';
import { CategoryModel } from '../../models/category.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { CreditRecoveryModel } from '../../models/credit-recovery.model';
import { SettlementModel } from '../../models/settlement.model';

import * as collections from './collections.service';
import * as recoveries from './credit-recovery.service';
import * as settlements from './settlements.service';
import * as reports from './collection-reports.service';
import * as orders from '../orders/orders.service';

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
const R1 = new Types.ObjectId(); // Lahore rider
const R2 = new Types.ObjectId(); // Karachi rider
const R_NO_CITY = new Types.ObjectId(); // rider with no city — must be unassignable

let mongod: MongoMemoryServer;
let lahoreShop: Types.ObjectId;
let lahoreShop2: Types.ObjectId;
let karachiShop: Types.ObjectId;
let warehouseId: Types.ObjectId;
let productId: Types.ObjectId;

async function makeOrder(opts: {
  dealerId: Types.ObjectId;
  grandTotal?: number;
  status?: string;
  rider?: Types.ObjectId | null;
  invoiceNumber?: number;
}) {
  const doc = await OrderModel.create({
    dealerId: opts.dealerId,
    createdBy: TAKER,
    warehouseId,
    products: [{ productId, quantity: 1, price: opts.grandTotal ?? 0 }],
    grandTotal: opts.grandTotal,
    totalPrice: opts.grandTotal,
    status: opts.status ?? 'approved',
    ...(opts.invoiceNumber ? { invoiceNumber: opts.invoiceNumber } : {}),
    ...(opts.rider === null
      ? {}
      : { assignedRiderId: opts.rider ?? R1, assignedAt: new Date() }),
  });
  return doc;
}

/** A stock fingerprint: the C13 guard compares this before and after a delivery. */
async function stockFingerprint() {
  const balances = await WarehouseStockModel.find({}).select('warehouseId productId sellable damaged inTransit').lean();
  const movements = await StockMovementModel.countDocuments({});
  return {
    movements,
    balances: balances
      .map((b) => `${b.warehouseId}:${b.productId}:${b.sellable}:${b.damaged}:${b.inTransit}`)
      .sort()
      .join('|'),
  };
}

async function seed(): Promise<void> {
  await UserModel.create([
    { _id: ADMIN, userID: 'ADM', username: 'admin.one', phone: '0300000000', password: 'x', role: 'admin' },
    { _id: TAKER, userID: 'OT1', username: 'taker', phone: '0300000001', password: 'x', role: 'order_taker', address: { city: 'Lahore' } },
    { _id: R1, userID: 'DM1', username: 'ali', fullName: 'Ali Raza', phone: '0300000002', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } },
    { _id: R2, userID: 'DM2', username: 'daud', fullName: 'Daud Ali', phone: '0300000003', password: 'x', role: 'delivery_man', address: { city: 'Karachi' } },
    { _id: R_NO_CITY, userID: 'DM3', username: 'noor', fullName: 'Noor Zia', phone: '0300000004', password: 'x', role: 'delivery_man' },
  ]);

  const wh = await WarehouseModel.create({ name: 'Main', city: 'Lahore', cityKey: 'lahore' });
  warehouseId = wh._id as Types.ObjectId;

  const category = await CategoryModel.create({ name: 'General', createdBy: ADMIN });
  const product = await ProductModel.create({
    name: 'Widget',
    salePrice: 100,
    purchasePrice: 60,
    categoryId: category._id,
    barcode: 'WIDGET-0001',
    createdBy: ADMIN,
  });
  productId = product._id as Types.ObjectId;

  await WarehouseStockModel.create({ warehouseId, productId, sellable: 500, damaged: 0, inTransit: 0 });

  const [s1, s2, s3] = await DealerModel.create([
    { name: 'Ahmed Traders', shopName: 'Ahmed Kiryana', phone: '0311111111', address: { city: 'Lahore' }, latitude: 31.52, longitude: 74.35 },
    { name: 'Bilal Store', shopName: 'Bilal Mart', phone: '0311111112', address: { city: 'lahore' } },
    { name: 'Karachi Shop', shopName: 'KS', phone: '0311111113', address: { city: 'Karachi' } },
  ]);
  lahoreShop = s1._id as Types.ObjectId;
  lahoreShop2 = s2._id as Types.ObjectId;
  karachiShop = s3._id as Types.ObjectId;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'collections-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');
  await seed();

  // -------------------------------------------------------------------------
  console.log('Assignment (spec §1)');
  // -------------------------------------------------------------------------
  await test('a rider with no city cannot be assigned an order', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100, rider: null });
    await rejectsWith(
      orders.assignRider(String(o._id), String(R_NO_CITY), String(ADMIN)),
      /No city is set for Noor Zia/,
    );
  });

  await test('only a delivery_man can be assigned', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100, rider: null });
    await rejectsWith(
      orders.assignRider(String(o._id), String(TAKER), String(ADMIN)),
      /only be assigned to a delivery boy/,
    );
  });

  await test('a pending order must be approved before it can be assigned', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100, status: 'pending', rider: null });
    await rejectsWith(
      orders.assignRider(String(o._id), String(R1), String(ADMIN)),
      /Approve the order before assigning/,
    );
  });

  await test('approve can assign the rider in the same call', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100, status: 'pending', rider: null });
    const approved: any = await orders.approveOrder(String(o._id), String(ADMIN), {
      assignedRiderId: String(R1),
    });
    assert.equal(approved.status, 'approved');
    assert.equal(String(approved.assignedRiderId._id ?? approved.assignedRiderId), String(R1));
    assert.ok(approved.assignedAt, 'assignedAt is stamped');
  });

  await test('a rejected rider leaves the order pending and re-approvable', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100, status: 'pending', rider: null });
    await rejectsWith(
      orders.approveOrder(String(o._id), String(ADMIN), { assignedRiderId: String(R_NO_CITY) }),
      /No city is set/,
    );
    const after = await OrderModel.findById(o._id).lean();
    assert.equal(after!.status, 'pending', 'still pending, so the admin can fix and retry');
  });

  await test('the generic order PUT cannot set rider fields or jump to delivered', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100, rider: null });
    await orders.updateOrder(
      String(o._id),
      { assignedRiderId: String(R1), deliveredAt: new Date(), packedAt: new Date() } as any,
      String(ADMIN),
    );
    const after = await OrderModel.findById(o._id).lean();
    assert.equal(after!.assignedRiderId, undefined, 'assignedRiderId was stripped');
    assert.equal(after!.deliveredAt, undefined, 'deliveredAt was stripped');
    assert.equal(after!.packedAt, undefined, 'packedAt was stripped');
  });

  // -------------------------------------------------------------------------
  console.log('\nThe rider’s own list (spec §§1-2)');
  // -------------------------------------------------------------------------
  await test('a rider sees only their own assigned orders, grouped client-wise', async () => {
    await makeOrder({ dealerId: lahoreShop, grandTotal: 1000, rider: R1 });
    await makeOrder({ dealerId: lahoreShop, grandTotal: 500, rider: R1 });
    await makeOrder({ dealerId: lahoreShop2, grandTotal: 200, rider: R1 });
    await makeOrder({ dealerId: karachiShop, grandTotal: 900, rider: R2 });

    const mine = await collections.getRiderOrders(String(R1), {});
    const shops = mine.groups.map((g: any) => g.dealer._id);
    assert.ok(shops.includes(String(lahoreShop)), 'my Lahore shop is present');
    assert.ok(!shops.includes(String(karachiShop)), 'another rider’s shop is absent');

    const group = mine.groups.find((g: any) => g.dealer._id === String(lahoreShop))! as any;
    assert.ok(group.orders.length >= 2, 'both orders for one shop are in one group');
    assert.equal(group.dealer.hasLocation, true, 'the saved pin is surfaced for the map');
  });

  await test('an unapproved order never reaches a rider', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 700, status: 'pending', rider: R1 });
    const mine = await collections.getRiderOrders(String(R1), {});
    const ids = mine.groups.flatMap((g: any) => g.orders.map((x: any) => x._id));
    assert.ok(!ids.includes(String(o._id)), 'pending orders are invisible to the rider');
  });

  await test('an unassigned approved order is invisible to every rider', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 700, rider: null });
    for (const rider of [R1, R2]) {
      const mine = await collections.getRiderOrders(String(rider), {});
      const ids = mine.groups.flatMap((g: any) => g.orders.map((x: any) => x._id));
      assert.ok(!ids.includes(String(o._id)));
    }
  });

  // -------------------------------------------------------------------------
  console.log('\nState machine (spec §§3-4)');
  // -------------------------------------------------------------------------
  await test('approved -> packed -> delivered succeeds in order', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 1200, invoiceNumber: 9001 });
    const packed = await collections.markPacked(String(o._id), String(R1));
    assert.equal(packed.status, 'packed');
    assert.ok(packed.packedAt, 'packedAt is stamped');

    const { order } = await collections.deliverOrder(String(o._id), String(R1), {
      cash: 700, online: 300, credit: 200,
    });
    assert.equal(order.status, 'delivered');
    assert.ok(order.deliveredAt, 'deliveredAt is stamped');
  });

  await test('delivering without packing first is refused', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 500 });
    await rejectsWith(
      collections.deliverOrder(String(o._id), String(R1), { cash: 500, online: 0, credit: 0 }),
      /Mark the order packed before delivering/,
    );
  });

  await test('a rider cannot touch an order assigned to someone else', async () => {
    const o = await makeOrder({ dealerId: karachiShop, grandTotal: 400, rider: R2 });
    await rejectsWith(collections.markPacked(String(o._id), String(R1)), /not assigned to you/);
    await rejectsWith(
      collections.deliverOrder(String(o._id), String(R1), { cash: 400, online: 0, credit: 0 }),
      /not assigned to you/,
    );
  });

  await test('packing twice is refused with a specific message, not a generic 400', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 300 });
    await collections.markPacked(String(o._id), String(R1));
    await rejectsWith(collections.markPacked(String(o._id), String(R1)), /already marked packed/);
  });

  await test('a delivered order cannot be reassigned', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100 });
    await collections.markPacked(String(o._id), String(R1));
    await collections.deliverOrder(String(o._id), String(R1), { cash: 100, online: 0, credit: 0 });
    await rejectsWith(
      orders.assignRider(String(o._id), String(R2), String(ADMIN)),
      /already been delivered and cannot be reassigned/,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nThe collection split (spec §4)');
  // -------------------------------------------------------------------------
  await test('a split that does not sum to the order total is refused and writes NOTHING', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 1000 });
    await collections.markPacked(String(o._id), String(R1));
    await rejectsWith(
      collections.deliverOrder(String(o._id), String(R1), { cash: 700, online: 100, credit: 100 }),
      /still unaccounted for/,
    );
    const after = await OrderModel.findById(o._id).lean();
    assert.equal(after!.status, 'packed', 'the order is untouched and still deliverable');
    const entry = await DeliveryCollectionModel.findOne({ orderId: o._id });
    assert.equal(entry, null, 'no collection entry was created');
  });

  await test('paidAmount counts cash+online only, and paymentType is derived', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 1000 });
    await collections.markPacked(String(o._id), String(R1));
    await collections.deliverOrder(String(o._id), String(R1), { cash: 600, online: 100, credit: 300 });
    const after = await OrderModel.findById(o._id).lean();
    assert.equal(after!.paidAmount, 700, 'credit is a receivable, not a payment');
    assert.equal(after!.paymentType, 'cash', 'largest component wins');
  });

  await test('an order with no amount is refused with a rider-actionable message', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: undefined });
    await collections.markPacked(String(o._id), String(R1));
    await rejectsWith(
      collections.deliverOrder(String(o._id), String(R1), { cash: 0, online: 0, credit: 0 }),
      /Ask an admin to fix the order/,
    );
  });

  await test('delivering twice creates exactly ONE collection entry', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 800 });
    await collections.markPacked(String(o._id), String(R1));
    await collections.deliverOrder(String(o._id), String(R1), { cash: 800, online: 0, credit: 0 });
    await rejectsWith(
      collections.deliverOrder(String(o._id), String(R1), { cash: 800, online: 0, credit: 0 }),
      /already been delivered/,
    );
    const count = await DeliveryCollectionModel.countDocuments({ orderId: o._id });
    assert.equal(count, 1, 'the status CAS is the mutex; the unique index is the backstop');
  });

  await test('the unique index rejects a second entry even if the status guard is bypassed', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 800 });
    await collections.markPacked(String(o._id), String(R1));
    await collections.deliverOrder(String(o._id), String(R1), { cash: 800, online: 0, credit: 0 });
    await rejectsWith(
      DeliveryCollectionModel.create({
        orderId: o._id, dealerId: lahoreShop, riderId: R1, city: 'Lahore', cityKey: 'lahore',
        orderAmount: 800, cash: 800, online: 0, credit: 0, deliveredAt: new Date(), createdBy: R1,
      }),
      /E11000|duplicate key/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nCity segregation (spec §4: no mixing across cities)');
  // -------------------------------------------------------------------------
  await test('a rider cannot collect against a client in another city', async () => {
    const o = await makeOrder({ dealerId: karachiShop, grandTotal: 600, rider: R1 });
    await collections.markPacked(String(o._id), String(R1));
    await rejectsWith(
      collections.deliverOrder(String(o._id), String(R1), { cash: 600, online: 0, credit: 0 }),
      /Collections cannot cross cities/,
    );
  });

  await test('the entry snapshots the RIDER’s city, normalised, plus the dealer’s for proof', async () => {
    const o = await makeOrder({ dealerId: lahoreShop2, grandTotal: 400 }); // dealer city is 'lahore'
    await collections.markPacked(String(o._id), String(R1)); // rider city is 'Lahore'
    const { collection } = await collections.deliverOrder(String(o._id), String(R1), {
      cash: 400, online: 0, credit: 0,
    });
    assert.equal(collection.city, 'Lahore', 'display label keeps the rider’s casing');
    assert.equal(collection.cityKey, 'lahore', 'the grouping key is normalised');
    assert.equal(collection.dealerCityKey, 'lahore', 'the dealer’s city is snapshotted too');
  });

  await test('a rider with no city cannot record a collection even if somehow assigned', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 100, rider: R_NO_CITY });
    await OrderModel.updateOne({ _id: o._id }, { $set: { status: 'packed' } });
    await rejectsWith(
      collections.deliverOrder(String(o._id), String(R_NO_CITY), { cash: 100, online: 0, credit: 0 }),
      /No city is set/,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nStock is NOT touched by delivery (the load-bearing guard)');
  // -------------------------------------------------------------------------
  await test('delivering an order leaves warehouse stock and the movement ledger byte-identical', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 900 });
    await collections.markPacked(String(o._id), String(R1));

    const before = await stockFingerprint();
    await collections.deliverOrder(String(o._id), String(R1), { cash: 500, online: 400, credit: 0 });
    const after = await stockFingerprint();

    // Stock left the warehouse at order-CREATE time (orders.service reserveWarehouseStock).
    // A second deduction here would double-deduct every order in the system.
    assert.equal(after.movements, before.movements, 'no new stock movements');
    assert.equal(after.balances, before.balances, 'no balance changed');
  });

  // -------------------------------------------------------------------------
  console.log('\nRider balance');
  // -------------------------------------------------------------------------
  await test('cash in hand and online outstanding accumulate from collections', async () => {
    const rider = new Types.ObjectId();
    await UserModel.create({ _id: rider, userID: 'DMX', username: 'bal', phone: '0300009999', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } });
    const o1 = await makeOrder({ dealerId: lahoreShop, grandTotal: 1000, rider });
    const o2 = await makeOrder({ dealerId: lahoreShop, grandTotal: 500, rider });
    await collections.markPacked(String(o1._id), String(rider));
    await collections.deliverOrder(String(o1._id), String(rider), { cash: 700, online: 200, credit: 100 });
    await collections.markPacked(String(o2._id), String(rider));
    await collections.deliverOrder(String(o2._id), String(rider), { cash: 300, online: 0, credit: 200 });

    const b = await reports.getRiderBalance(String(rider));
    assert.equal(b.cash.inHand, 1000);
    assert.equal(b.online.outstanding, 200);
    assert.equal(b.creditIssuedOutstanding, 300);
  });

  // -------------------------------------------------------------------------
  console.log('\nCredit recovery (spec §5)');
  // -------------------------------------------------------------------------
  const recoveryRider = new Types.ObjectId();
  let recoveryShop: Types.ObjectId;

  await test('a recovery reduces the client’s outstanding and raises the rider’s balance', async () => {
    await UserModel.create({ _id: recoveryRider, userID: 'DMR', username: 'rec', phone: '0300008888', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } });
    const shop = await DealerModel.create({ name: 'Credit Shop', phone: '0311999999', address: { city: 'Lahore' } });
    recoveryShop = shop._id as Types.ObjectId;

    const o = await makeOrder({ dealerId: recoveryShop, grandTotal: 2000, rider: recoveryRider });
    await collections.markPacked(String(o._id), String(recoveryRider));
    await collections.deliverOrder(String(o._id), String(recoveryRider), { cash: 0, online: 0, credit: 2000 });

    let outstanding = await reports.getDealerOutstanding(String(recoveryShop));
    assert.equal(outstanding.outstanding, 2000);

    const res = await recoveries.createRecovery(String(recoveryRider), {
      dealerId: String(recoveryShop), amount: 1500, mode: 'cash',
    });
    assert.equal(res.dealerOutstanding.outstanding, 500);
    assert.equal(res.balance.cash.inHand, 1500);

    outstanding = await reports.getDealerOutstanding(String(recoveryShop));
    assert.equal(outstanding.outstanding, 500);
  });

  await test('recovering more than is outstanding is refused, naming the real figure', async () => {
    await rejectsWith(
      recoveries.createRecovery(String(recoveryRider), {
        dealerId: String(recoveryShop), amount: 1000, mode: 'cash',
      }),
      /pending credit is Rs\. 500/,
    );
  });

  await test('a recovery for a client in another city is refused', async () => {
    await rejectsWith(
      recoveries.createRecovery(String(recoveryRider), {
        dealerId: String(karachiShop), amount: 10, mode: 'cash',
      }),
      /Recoveries cannot cross cities/,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nSettlement (spec §6)');
  // -------------------------------------------------------------------------
  const settleRider = new Types.ObjectId();

  await test('a CASH settlement is pending and does NOT move the balance', async () => {
    await UserModel.create({ _id: settleRider, userID: 'DMS', username: 'set', phone: '0300007777', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } });
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 10000, rider: settleRider });
    await collections.markPacked(String(o._id), String(settleRider));
    await collections.deliverOrder(String(o._id), String(settleRider), { cash: 8500, online: 1500, credit: 0 });

    const { settlement, balance } = await settlements.submitSettlement(String(settleRider), {
      mode: 'cash', amount: 8000,
    });
    assert.equal(settlement.status, 'pending');
    assert.equal(settlement.autoReceived, false);
    assert.equal(balance.cash.inHand, 8500, 'step 1 does NOT reduce the balance (spec §6)');
    assert.equal(balance.cash.pendingSettlement, 8000);
    assert.equal(balance.cash.availableToSettle, 500, 'the pending amount is reserved');
  });

  await test('a rider cannot queue more than they hold', async () => {
    await rejectsWith(
      settlements.submitSettlement(String(settleRider), { mode: 'cash', amount: 1000 }),
      /at most Rs\. 500/,
    );
  });

  await test('an ONLINE settlement self-confirms and reduces the balance immediately', async () => {
    const { settlement, balance } = await settlements.submitSettlement(String(settleRider), {
      mode: 'online', amount: 1500, screenshotUrl: '/api/uploads/settlements/x.png',
    });
    assert.equal(settlement.status, 'received');
    assert.equal(settlement.autoReceived, true);
    assert.ok(settlement.receivedAt, 'receivedAt is stamped at submit');
    assert.equal(balance.online.outstanding, 0);
  });

  await test('a screenshot cannot be attached to a cash settlement', async () => {
    await rejectsWith(
      settlements.submitSettlement(String(settleRider), {
        mode: 'cash', amount: 100, screenshotUrl: '/api/uploads/settlements/y.png',
      }),
      /only be attached to an online settlement/,
    );
  });

  await test('admin marking received is what finally reduces the cash balance', async () => {
    const pending = await SettlementModel.findOne({ riderId: settleRider, status: 'pending' });
    const { riderBalance } = await settlements.receiveSettlement(String(pending!._id), String(ADMIN));
    assert.equal(riderBalance.cash.inHand, 500, '8500 - 8000');
    assert.equal(riderBalance.cash.pendingSettlement, 0);
  });

  await test('marking received twice produces one receipt, not two', async () => {
    const done = await SettlementModel.findOne({ riderId: settleRider, mode: 'cash', status: 'received' });
    await rejectsWith(
      settlements.receiveSettlement(String(done!._id), String(ADMIN)),
      /already been marked received/,
    );
  });

  await test('an online settlement needs no admin action', async () => {
    const online = await SettlementModel.findOne({ riderId: settleRider, mode: 'online' });
    await rejectsWith(
      settlements.receiveSettlement(String(online!._id), String(ADMIN)),
      /confirmed automatically/,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nCorrection, void and the audit trail (spec §7)');
  // -------------------------------------------------------------------------
  let correctable: string;

  await test('an admin correction reallocates between modes and keeps the total', async () => {
    const rider = new Types.ObjectId();
    await UserModel.create({ _id: rider, userID: 'DMC', username: 'cor', phone: '0300006666', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } });
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 12000, rider });
    await collections.markPacked(String(o._id), String(rider));
    const { collection } = await collections.deliverOrder(String(o._id), String(rider), {
      cash: 7000, online: 3000, credit: 2000,
    });
    correctable = String(collection._id);

    const before = await reports.getRiderBalance(String(rider));
    assert.equal(before.cash.inHand, 7000);

    const fixed = await collections.correctCollection(correctable, String(ADMIN), {
      cash: 5000, online: 5000, credit: 2000, reason: 'Rs. 2000 was a bank transfer',
    });
    assert.equal(fixed.cash + fixed.online + fixed.credit, 12000, 'the total is immutable');
    assert.equal(fixed.corrections.length, 1, 'the audit trail is on the document itself');
    assert.equal(fixed.corrections[0].from.cash, 7000);
    assert.equal(fixed.corrections[0].to.cash, 5000);
    assert.equal(String(fixed.corrections[0].by), String(ADMIN));
    assert.ok(fixed.corrections[0].at, 'when');

    const after = await reports.getRiderBalance(String(rider));
    assert.equal(after.cash.inHand, 5000, 'the balance follows the correction');
    assert.equal(after.online.outstanding, 5000);

    const order = await OrderModel.findById(o._id).lean();
    assert.equal(order!.paidAmount, 10000, 'legacy fields are re-derived');
  });

  await test('a correction that changes the total is refused', async () => {
    await rejectsWith(
      collections.correctCollection(correctable, String(ADMIN), { cash: 5000, online: 5000, credit: 5000 }),
      /more than the order total/,
    );
  });

  await test('a voided entry counts for nothing but is still retrievable', async () => {
    const rider = new Types.ObjectId();
    await UserModel.create({ _id: rider, userID: 'DMV', username: 'voi', phone: '0300005555', password: 'x', role: 'delivery_man', address: { city: 'Lahore' } });
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 3000, rider });
    await collections.markPacked(String(o._id), String(rider));
    const { collection } = await collections.deliverOrder(String(o._id), String(rider), {
      cash: 3000, online: 0, credit: 0,
    });

    assert.equal((await reports.getRiderBalance(String(rider))).cash.inHand, 3000);

    await collections.voidCollection(String(collection._id), String(ADMIN), 'Delivered by mistake');

    assert.equal((await reports.getRiderBalance(String(rider))).cash.inHand, 0, 'excluded from balances');
    const still = await DeliveryCollectionModel.findById(collection._id).lean();
    assert.ok(still, 'the row survives — deleting evidence of a mistake is worse than showing it');
    assert.ok(still!.voidedAt);
    assert.equal(still!.voidReason, 'Delivered by mistake');
  });

  await test('voiding twice is refused', async () => {
    const voided = await DeliveryCollectionModel.findOne({ voidedAt: { $exists: true } });
    await rejectsWith(
      collections.voidCollection(String(voided!._id), String(ADMIN), 'again'),
      /already been voided/,
    );
  });

  await test('an order holding a live collection cannot be trashed', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 450 });
    await collections.markPacked(String(o._id), String(R1));
    const { collection } = await collections.deliverOrder(String(o._id), String(R1), {
      cash: 450, online: 0, credit: 0,
    });

    await rejectsWith(orders.deleteOrder(String(o._id), String(ADMIN)), /Void that entry before/);

    await collections.voidCollection(String(collection._id), String(ADMIN), 'reversing');
    const res = await orders.deleteOrder(String(o._id), String(ADMIN));
    assert.match(res.message, /trash/i, 'once voided, the trash succeeds');
  });

  await test('a delivered order cannot be re-opened while its collection is live', async () => {
    const o = await makeOrder({ dealerId: lahoreShop, grandTotal: 250 });
    await collections.markPacked(String(o._id), String(R1));
    await collections.deliverOrder(String(o._id), String(R1), { cash: 250, online: 0, credit: 0 });
    await rejectsWith(
      orders.updateOrder(String(o._id), { status: 'cancelled' }, String(ADMIN)),
      /Void that entry before changing the order status/,
    );
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} collection flow tests passed.`);
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
