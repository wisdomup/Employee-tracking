/**
 * Regression tests for the stock consequences of the order lifecycle.
 *
 * Every case here corresponds to a bug that used to inflate or destroy inventory. They are
 * the floor the warehouse module is built on: if global stock can drift, per-warehouse stock
 * drifts the same way. Runs against a throwaway in-memory MongoDB — never the real database.
 *
 * Run with: npm run test:orders:stock
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import { CounterModel } from '../../models/counter.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { UserModel } from '../../models/user.model';
import { applyStockMovements, getIntegrityReport } from '../warehouse/stock-ledger.service';
// `updateOrder` returns the populated order, so these refs must be registered.
import '../../models/route.model';
import '../../models/category.model';
import { createOrderSchema, updateOrderSchema } from './dto/orders.schemas';
import * as ordersService from './orders.service';

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
let SALESMAN: Types.ObjectId;
let dealerId: string;
let warehouseId: string;
let mongod: MongoMemoryServer;

/**
 * Current sellable stock of a product by name, read through the `Product.quantity` mirror.
 *
 * Reading the mirror rather than the balance document is deliberate: it is exactly what every
 * pre-warehouse reader (the products list, the dashboard, the legacy stock reports) sees, so these
 * assertions double as a check that the mirror stays truthful.
 */
async function stockOf(name: string): Promise<number> {
  const p = await ProductModel.findOne({ name }).select('quantity').lean();
  return p?.quantity ?? 0;
}

async function invoiceSeq(): Promise<number> {
  const c = await CounterModel.findById('orderInvoice').lean();
  return c?.seq ?? 0;
}

/** Reset the catalogue and seed known warehouse stock before each scenario. */
async function resetStock(a: number, b: number): Promise<{ a: string; b: string }> {
  await ProductModel.deleteMany({});
  await OrderModel.deleteMany({});
  await WarehouseStockModel.deleteMany({});
  await StockMovementModel.deleteMany({});

  const [prodA, prodB] = await ProductModel.create([
    { barcode: 'A-1', name: 'Product A', purchasePrice: 10, salePrice: 20, categoryId: CATEGORY, createdBy: SALESMAN },
    { barcode: 'B-1', name: 'Product B', purchasePrice: 30, salePrice: 50, categoryId: CATEGORY, createdBy: SALESMAN },
  ]);

  const lines = [
    { warehouseId, productId: String(prodA._id), bucket: 'sellable' as const, delta: a, type: 'opening_stock' as const },
    { warehouseId, productId: String(prodB._id), bucket: 'sellable' as const, delta: b, type: 'opening_stock' as const },
  ].filter((l) => l.delta > 0);

  if (lines.length > 0) {
    await applyStockMovements(lines, {
      refType: 'opening_stock',
      refId: String(new Types.ObjectId()),
      actorId: String(SALESMAN),
    });
  }

  return { a: String(prodA._id), b: String(prodB._id) };
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'orders-stock-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
  ]);

  const dealer = await DealerModel.create({ name: 'Test Shop', phone: '03001234567', address: { city: 'Lahore' } });
  dealerId = String(dealer._id);

  // Orders now draw stock from a warehouse resolved from the salesman's city.
  const warehouse = await WarehouseModel.create({
    name: 'Main Warehouse',
    city: 'Lahore',
    cityKey: 'lahore',
    isMain: true,
    isActive: true,
  });
  warehouseId = String(warehouse._id);

  const salesman = await UserModel.create({
    userID: 'OT-1',
    username: 'rider.one',
    phone: '03009998887',
    password: 'x',
    role: 'order_taker',
    address: { city: 'Lahore' },
  });
  SALESMAN = salesman._id;

  // -------------------------------------------------------------------------
  console.log('Order line validation (pieces only, never negative)');
  // -------------------------------------------------------------------------
  await test('a negative line quantity is rejected — it used to MINT stock', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: -5, price: 10 }],
    });
    assert.ok(error, 'quantity -5 must not validate');
  });

  await test('a zero line quantity is rejected', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 0, price: 10 }],
    });
    assert.ok(error);
  });

  await test('a fractional line quantity is rejected — stock is whole pieces', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 1.5, price: 10 }],
    });
    assert.ok(error);
  });

  await test('the same rules apply on update, not just create', () => {
    assert.ok(updateOrderSchema.validate({
      products: [{ productId: String(new Types.ObjectId()), quantity: -1, price: 10 }],
    }).error);
  });

  await test('a valid whole-piece line passes', () => {
    const { error } = createOrderSchema.validate({
      dealerId,
      products: [{ productId: String(new Types.ObjectId()), quantity: 3, price: 10 }],
    });
    assert.equal(error, undefined);
  });

  // -------------------------------------------------------------------------
  console.log('\nCreating an order');
  // -------------------------------------------------------------------------
  await test('a successful create decrements every line exactly once', async () => {
    const ids = await resetStock(10, 10);
    await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 4, price: 20 }, { productId: ids.b, quantity: 2, price: 50 }] },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 6);
    assert.equal(await stockOf('Product B'), 8);
  });

  await test('a short line rolls back the lines already reserved', async () => {
    const ids = await resetStock(10, 1);
    await rejectsWith(
      ordersService.createOrder(
        { dealerId, products: [{ productId: ids.a, quantity: 5, price: 20 }, { productId: ids.b, quantity: 5, price: 50 }] },
        String(SALESMAN),
      ),
      /insufficient.*stock/i,
    );
    // Product A was reserved first, then B failed. A must be back at 10, not 5.
    assert.equal(await stockOf('Product A'), 10, 'the first line was not released');
    assert.equal(await stockOf('Product B'), 1);
  });

  await test('a failed create leaves no order document behind', async () => {
    assert.equal(await OrderModel.countDocuments({}), 0);
  });

  await test('a failed create does not burn an invoice number', async () => {
    const ids = await resetStock(10, 1);
    const before = await invoiceSeq();
    await rejectsWith(
      ordersService.createOrder(
        { dealerId, products: [{ productId: ids.a, quantity: 5, price: 20 }, { productId: ids.b, quantity: 5, price: 50 }] },
        String(SALESMAN),
      ),
      /insufficient.*stock/i,
    );
    assert.equal(await invoiceSeq(), before, 'the invoice series must stay gap-free');
  });

  await test('a product with no quantity set behaves as zero stock, with a clear message', async () => {
    await ProductModel.deleteMany({});
    const p = await ProductModel.create({ barcode: 'N-1', name: 'No Qty', categoryId: CATEGORY, createdBy: SALESMAN });
    await rejectsWith(
      ordersService.createOrder(
        { dealerId, products: [{ productId: String(p._id), quantity: 1, price: 10 }] },
        String(SALESMAN),
      ),
      /insufficient.*stock/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nCancelling');
  // -------------------------------------------------------------------------
  await test('pending → cancelled restores stock exactly once', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 3, price: 20 }] },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 7);
    await ordersService.updateOrder(String(order._id), { status: 'cancelled' }, String(SALESMAN));
    assert.equal(await stockOf('Product A'), 10);
  });

  await test('cancelled → cancelled is a no-op, not a second restore', async () => {
    const order = await OrderModel.findOne({ status: 'cancelled' });
    await ordersService.updateOrder(String(order!._id), { status: 'cancelled' }, String(SALESMAN));
    assert.equal(await stockOf('Product A'), 10);
  });

  await test('delivered → cancelled does NOT restore stock — the goods already shipped', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 3, price: 20 }] },
      String(SALESMAN),
    );
    await ordersService.updateOrder(String(order._id), { status: 'delivered' }, String(SALESMAN));
    assert.equal(await stockOf('Product A'), 7);
    await ordersService.updateOrder(String(order._id), { status: 'cancelled' }, String(SALESMAN));
    assert.equal(await stockOf('Product A'), 7, 'cancelling a delivered order invented stock');
  });

  await test('cancelled → pending is refused — it would hold stock it never reserved', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 3, price: 20 }] },
      String(SALESMAN),
    );
    await ordersService.updateOrder(String(order._id), { status: 'cancelled' }, String(SALESMAN));
    await rejectsWith(
      ordersService.updateOrder(String(order._id), { status: 'pending' }, String(SALESMAN)),
      /cannot be re-opened/i,
    );
    assert.equal(await stockOf('Product A'), 10);
  });

  // -------------------------------------------------------------------------
  console.log('\nTrash round-trip');
  // -------------------------------------------------------------------------
  await test('trash gives stock back and restore takes it again — net zero', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 4, price: 20 }] },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 6);
    await ordersService.deleteOrder(String(order._id), String(SALESMAN));
    assert.equal(await stockOf('Product A'), 10);
    await ordersService.restoreOrder(String(order._id), String(SALESMAN));
    assert.equal(await stockOf('Product A'), 6, 'restore must re-reserve the stock trash released');
  });

  await test('a SECOND trash still gives the stock back', async () => {
    // Regression: both trash calls used a fixed idempotency scope, so the second one collided with
    // the first on the ledger's unique key, was compensated away and reported as already applied.
    // The order landed in the trash still holding stock nobody could see.
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 4, price: 20 }] },
      String(SALESMAN),
    );
    const orderId = String(order._id);

    await ordersService.deleteOrder(orderId, String(SALESMAN));
    await ordersService.restoreOrder(orderId, String(SALESMAN));
    await ordersService.deleteOrder(orderId, String(SALESMAN));
    assert.equal(await stockOf('Product A'), 10, 'a trashed order must not keep holding stock');

    await ordersService.restoreOrder(orderId, String(SALESMAN));
    assert.equal(await stockOf('Product A'), 6, 'and restoring must take it again');

    assert.deepEqual(await getIntegrityReport(), [], 'no drift after repeated trash cycles');
  });

  await test('restore is refused when the stock it needs is gone', async () => {
    const ids = await resetStock(5, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 5, price: 20 }] },
      String(SALESMAN),
    );
    await ordersService.deleteOrder(String(order._id), String(SALESMAN)); // stock back to 5
    // Someone else consumes it all in the meantime.
    await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 5, price: 20 }] },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 0);
    await rejectsWith(ordersService.restoreOrder(String(order._id), String(SALESMAN)), /insufficient.*stock/i);
    assert.equal(await stockOf('Product A'), 0, 'a refused restore must not move stock');
    const stillTrashed = await OrderModel.findById(order._id).select('isTrashed').lean();
    assert.equal(stillTrashed?.isTrashed, true);
  });

  await test('a delivered order returns no stock on trash and takes none on restore', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 2, price: 20 }] },
      String(SALESMAN),
    );
    await ordersService.updateOrder(String(order._id), { status: 'delivered' }, String(SALESMAN));
    await ordersService.deleteOrder(String(order._id), String(SALESMAN));
    assert.equal(await stockOf('Product A'), 8);
    await ordersService.restoreOrder(String(order._id), String(SALESMAN));
    assert.equal(await stockOf('Product A'), 8);
  });

  // -------------------------------------------------------------------------
  console.log('\nEditing line quantities');
  // -------------------------------------------------------------------------
  await test('raising one line and lowering another nets correctly', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 2, price: 20 }, { productId: ids.b, quantity: 5, price: 50 }] },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 8);
    assert.equal(await stockOf('Product B'), 5);
    await ordersService.updateOrder(
      String(order._id),
      { products: [{ productId: ids.a, quantity: 5, price: 20 }, { productId: ids.b, quantity: 1, price: 50 }] },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 5); // 8 - 3 more
    assert.equal(await stockOf('Product B'), 9); // 5 + 4 released
  });

  await test('an edit that oversells one line leaves the others and the order untouched', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 1, price: 20 }, { productId: ids.b, quantity: 1, price: 50 }] },
      String(SALESMAN),
    );
    await rejectsWith(
      ordersService.updateOrder(
        String(order._id),
        { products: [{ productId: ids.a, quantity: 500, price: 20 }] },
        String(SALESMAN),
      ),
      /insufficient.*stock/i,
    );
    assert.equal(await stockOf('Product A'), 9, 'the failed increase must not consume stock');
    assert.equal(await stockOf('Product B'), 9, 'the dropped line must not be released by a rejected edit');
    const saved = await OrderModel.findById(order._id).select('products').lean();
    assert.equal(saved?.products.length, 2, 'a rejected edit must not persist');
  });

  await test('an edit that changes products AND cancels restores the OLD quantities once', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 2, price: 20 }] },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 8);
    await ordersService.updateOrder(
      String(order._id),
      { products: [{ productId: ids.a, quantity: 5, price: 20 }], status: 'cancelled' },
      String(SALESMAN),
    );
    assert.equal(await stockOf('Product A'), 10, 'exactly the 2 originally reserved come back');
  });

  // -------------------------------------------------------------------------
  console.log('\nWarehouse routing and cost snapshots');
  // -------------------------------------------------------------------------
  await test('the order is stamped with the warehouse resolved from the salesman’s city', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 2, price: 20 }] },
      String(SALESMAN),
    );
    const saved = await OrderModel.findById(order._id).select('warehouseId').lean();
    assert.equal(String(saved?.warehouseId), warehouseId);
  });

  await test('each line snapshots the cost at the moment stock moved', async () => {
    const ids = await resetStock(10, 10);
    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 2, price: 20 }] },
      String(SALESMAN),
    );
    const saved = await OrderModel.findById(order._id).select('products').lean();
    // Product A's purchasePrice is 10 at this point.
    assert.equal(saved?.products[0].unitCost, 10);
  });

  await test('a later cost change does NOT rewrite the snapshot — closed periods stay put', async () => {
    const order = await OrderModel.findOne({}).sort({ createdAt: -1 }).lean();
    const before = order?.products[0].unitCost;
    await ProductModel.updateOne({ name: 'Product A' }, { $set: { purchasePrice: 99 } });
    const after = await OrderModel.findById(order!._id).select('products').lean();
    assert.equal(after?.products[0].unitCost, before);
    await ProductModel.updateOne({ name: 'Product A' }, { $set: { purchasePrice: 10 } });
  });

  await test('an admin can move the order to another warehouse without changing total stock', async () => {
    const ids = await resetStock(10, 10);
    const other = await WarehouseModel.create({
      name: 'Gujranwala Warehouse',
      city: 'Gujranwala',
      cityKey: 'gujranwala',
      isActive: true,
    });
    // Give the other warehouse enough to cover the order.
    await applyStockMovements(
      [{ warehouseId: String(other._id), productId: ids.a, bucket: 'sellable', delta: 20, type: 'opening_stock' }],
      { refType: 'opening_stock', refId: String(new Types.ObjectId()), actorId: String(SALESMAN) },
    );

    const order = await ordersService.createOrder(
      { dealerId, products: [{ productId: ids.a, quantity: 3, price: 20 }] },
      String(SALESMAN),
    );
    const totalBefore = await stockOf('Product A');

    await ordersService.updateOrder(
      String(order._id),
      { warehouseId: String(other._id) },
      String(SALESMAN),
    );

    assert.equal(await stockOf('Product A'), totalBefore, 'total stock must be unchanged');
    const main = await WarehouseStockModel.findOne({ warehouseId, productId: ids.a }).lean();
    const moved = await WarehouseStockModel.findOne({ warehouseId: other._id, productId: ids.a }).lean();
    assert.equal(main?.sellable, 10, 'the original warehouse got its stock back');
    assert.equal(moved?.sellable, 17, 'the new warehouse gave up the stock');

    await WarehouseModel.findByIdAndDelete(other._id);
  });

  await test('both ledger invariants hold after every order flow above', async () => {
    assert.deepEqual(await getIntegrityReport(), []);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} order stock-lifecycle tests passed.`);
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
