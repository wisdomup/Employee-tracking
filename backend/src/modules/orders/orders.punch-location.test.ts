/**
 * Regression tests for the order punch location trail.
 *
 * The trail exists so an admin can see where an order taker actually stood when they punched an
 * order, next to where the client's shop is pinned. Three things make it trustworthy, and each
 * has burnt someone somewhere: the coordinates are MANDATORY for an order taker (an order with no
 * fix proves nothing), the client's pin is SNAPSHOTTED (re-pinning a shop must not silently
 * rewrite the recorded distance of every past order), and the distance is stored rather than
 * recomputed from live data at read time.
 *
 * Runs against a throwaway in-memory MongoDB — never the real database.
 *
 * Run with: npm run test:orders:punch-location
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { UserModel } from '../../models/user.model';
import { applyStockMovements } from '../warehouse/stock-ledger.service';
import { calculateDistance } from '../../services/distance.service';
import { createOrderSchema } from './dto/orders.schemas';
import * as ordersService from './orders.service';
import * as ordersController from './orders.controller';

// Lahore: Liberty Market and a point a few hundred metres away.
const SHOP_LAT = 31.5115;
const SHOP_LNG = 74.3435;
const NEARBY_LAT = 31.5124;
const NEARBY_LNG = 74.3448;

const CATEGORY = new Types.ObjectId();
let ORDER_TAKER: Types.ObjectId;
let ADMIN: Types.ObjectId;
let dealerId: string;
let unpinnedDealerId: string;
let warehouseId: string;
let mongod: MongoMemoryServer;

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

/** A fresh product with stock in the warehouse, so each order has something to draw from. */
async function seedProduct(barcode: string, qty: number): Promise<string> {
  const product = await ProductModel.create({
    barcode,
    name: `Product ${barcode}`,
    purchasePrice: 10,
    salePrice: 20,
    categoryId: CATEGORY,
    createdBy: ORDER_TAKER,
  });
  await applyStockMovements(
    [
      {
        warehouseId,
        productId: String(product._id),
        bucket: 'sellable' as const,
        delta: qty,
        type: 'opening_stock' as const,
      },
    ],
    { refType: 'opening_stock', refId: String(new Types.ObjectId()), actorId: String(ORDER_TAKER) },
  );
  return String(product._id);
}

/**
 * Drives `controller.create` far enough to see whether it lets the request through. Returns the
 * error handed to `next`, or null when the controller accepted the body.
 */
async function createViaController(
  role: string,
  body: Record<string, unknown>,
): Promise<{ statusCode?: number; message: string } | null> {
  let captured: { statusCode?: number; message: string } | null = null;
  const req = { user: { role, userId: String(ORDER_TAKER) }, body } as never;
  const res = { status: () => ({ json: () => undefined }), json: () => undefined } as never;
  const next = (err?: unknown) => {
    if (err) {
      const e = err as { statusCode?: number; message?: string };
      captured = { statusCode: e.statusCode, message: e.message ?? String(err) };
    }
  };
  await ordersController.create(req, res, next as never);
  return captured;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'orders-punch-location-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
  ]);

  const dealer = await DealerModel.create({
    name: 'Liberty Shop',
    phone: '03001234567',
    address: { city: 'Lahore' },
    latitude: SHOP_LAT,
    longitude: SHOP_LNG,
  });
  dealerId = String(dealer._id);

  const unpinned = await DealerModel.create({
    name: 'Unpinned Shop',
    phone: '03007654321',
    address: { city: 'Lahore' },
  });
  unpinnedDealerId = String(unpinned._id);

  const warehouse = await WarehouseModel.create({
    name: 'Main Warehouse',
    city: 'Lahore',
    cityKey: 'lahore',
    isMain: true,
    isActive: true,
  });
  warehouseId = String(warehouse._id);

  const taker = await UserModel.create({
    userID: 'OT-1',
    username: 'taker.one',
    phone: '03009998887',
    password: 'x',
    role: 'order_taker',
    address: { city: 'Lahore' },
  });
  ORDER_TAKER = taker._id;

  const admin = await UserModel.create({
    userID: 'AD-1',
    username: 'admin.one',
    phone: '03009998888',
    password: 'x',
    role: 'admin',
    address: { city: 'Lahore' },
  });
  ADMIN = admin._id;

  // -------------------------------------------------------------------------
  console.log('Coordinate validation');
  // -------------------------------------------------------------------------
  await test('a latitude with no longitude is rejected — half a pair plots nowhere', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 1, price: 10 }],
      latitude: SHOP_LAT,
    });
    assert.ok(error, 'latitude alone must not validate');
  });

  await test('an out-of-range latitude is rejected', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 1, price: 10 }],
      latitude: 120,
      longitude: 74,
    });
    assert.ok(error);
  });

  await test('a complete pair passes', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 1, price: 10 }],
      latitude: NEARBY_LAT,
      longitude: NEARBY_LNG,
    });
    assert.equal(error, undefined);
  });

  // -------------------------------------------------------------------------
  console.log('\nThe order taker cannot punch blind');
  // -------------------------------------------------------------------------
  await test('an order_taker punch with no coordinates is refused with 400', async () => {
    const err = await createViaController('order_taker', {
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 1, price: 10 }],
    });
    assert.ok(err, 'the punch must not reach the service');
    assert.equal(err?.statusCode, 400);
    assert.match(err?.message ?? '', /location is required/i);
  });

  await test('a non-numeric latitude does not slip past the role check', async () => {
    const err = await createViaController('order_taker', {
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 1, price: 10 }],
      latitude: '31.5124',
      longitude: '74.3448',
    });
    assert.equal(err?.statusCode, 400);
  });

  // -------------------------------------------------------------------------
  console.log('\nWhat gets stored on the order');
  // -------------------------------------------------------------------------
  let punchedOrderId = '';

  await test('a punch stores the taker position, the client pin snapshot and the distance', async () => {
    const productId = await seedProduct('P-1', 50);
    const order = await ordersService.createOrder(
      {
        dealerId,
        products: [{ productId, quantity: 2, price: 20 }],
        latitude: NEARBY_LAT,
        longitude: NEARBY_LNG,
      },
      String(ORDER_TAKER),
      'order_taker',
    );
    punchedOrderId = String(order._id);

    assert.equal(order.punchedLatitude, NEARBY_LAT);
    assert.equal(order.punchedLongitude, NEARBY_LNG);
    assert.equal(order.clientLatitudeAtPunch, SHOP_LAT);
    assert.equal(order.clientLongitudeAtPunch, SHOP_LNG);
    assert.equal(
      order.punchDistanceMetres,
      calculateDistance(NEARBY_LAT, NEARBY_LNG, SHOP_LAT, SHOP_LNG),
    );
    // Sanity: these two points really are a few hundred metres apart, so a formula that silently
    // returned 0 or a value in kilometres would fail here rather than pass by symmetry.
    assert.ok((order.punchDistanceMetres ?? 0) > 100 && (order.punchDistanceMetres ?? 0) < 500);
  });

  await test('re-pinning the client later does NOT rewrite the stored trail', async () => {
    await DealerModel.updateOne(
      { _id: dealerId },
      { $set: { latitude: SHOP_LAT + 0.05, longitude: SHOP_LNG + 0.05 } },
    );
    const stored = await OrderModel.findById(punchedOrderId).lean();
    assert.equal(stored?.clientLatitudeAtPunch, SHOP_LAT);
    assert.equal(stored?.clientLongitudeAtPunch, SHOP_LNG);
    assert.equal(
      stored?.punchDistanceMetres,
      calculateDistance(NEARBY_LAT, NEARBY_LNG, SHOP_LAT, SHOP_LNG),
    );
    // Put the shop back so later cases read the original pin.
    await DealerModel.updateOne({ _id: dealerId }, { $set: { latitude: SHOP_LAT, longitude: SHOP_LNG } });
  });

  await test('a client with no map pin still records the taker position, but no distance', async () => {
    const productId = await seedProduct('P-2', 50);
    const order = await ordersService.createOrder(
      {
        dealerId: unpinnedDealerId,
        products: [{ productId, quantity: 1, price: 20 }],
        latitude: NEARBY_LAT,
        longitude: NEARBY_LNG,
      },
      String(ORDER_TAKER),
      'order_taker',
    );
    assert.equal(order.punchedLatitude, NEARBY_LAT);
    assert.equal(order.punchedLongitude, NEARBY_LNG);
    assert.equal(order.clientLatitudeAtPunch, undefined);
    assert.equal(order.punchDistanceMetres, undefined);
  });

  await test('an admin order with no coordinates is created with an empty trail', async () => {
    const productId = await seedProduct('P-3', 50);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId, quantity: 1, price: 20 }] },
      String(ADMIN),
      'admin',
    );
    assert.equal(order.punchedLatitude, undefined);
    assert.equal(order.punchedLongitude, undefined);
    assert.equal(order.punchDistanceMetres, undefined);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} order punch-location tests passed.`);
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
