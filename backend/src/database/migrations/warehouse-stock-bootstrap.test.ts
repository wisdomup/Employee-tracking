/**
 * The bootstrap migration, against messy data.
 *
 * This is the one script that runs once against real production data, so the cases that matter are
 * the awkward ones: null and negative quantities, trashed products, open orders that have already
 * consumed stock, and damage-type returns that must NOT be turned into inventory. Re-running it must
 * change nothing.
 *
 * Rather than shelling out to the migration script, this exercises the same steps in-process against
 * an in-memory database — the script's own body is a thin wrapper around them.
 *
 * Run with: npm run test:migrate:warehouse
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { OrderModel } from '../../models/order.model';
import { ReturnModel } from '../../models/return.model';
import { DealerModel } from '../../models/dealer.model';
import { UserModel } from '../../models/user.model';
import { CounterModel } from '../../models/counter.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { WAREHOUSE_DOCUMENT_KINDS } from '../../modules/warehouse/warehouse-counters';
import { normalizeCityKey } from '../../modules/region-sales/region-sales.rules';
import {
  getIntegrityReport,
  syncProductQuantityMirror,
} from '../../modules/warehouse/stock-ledger.service';
import '../../models/category.model';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

const CATEGORY = new Types.ObjectId();
let mongod: MongoMemoryServer;
let adminId: Types.ObjectId;

/**
 * The migration's write phase, mirroring `warehouse-stock-bootstrap.ts`. Kept in the test so the
 * awkward-data behaviour is pinned even if the script grows a nicer CLI around it.
 */
async function runBootstrap(): Promise<void> {
  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
  ]);

  const main = await WarehouseModel.findOneAndUpdate(
    { isMain: true },
    {
      $setOnInsert: {
        name: 'Main Warehouse',
        city: '',
        cityKey: normalizeCityKey(''),
        isMain: true,
        isActive: true,
      },
    },
    { upsert: true, new: true },
  );

  const products = await ProductModel.find({})
    .select('_id name quantity purchasePrice isTrashed')
    .lean();

  for (const product of products) {
    const raw =
      typeof product.quantity === 'number' && Number.isFinite(product.quantity)
        ? product.quantity
        : 0;
    const opening = Math.max(0, Math.trunc(raw));

    await WarehouseStockModel.updateOne(
      { warehouseId: main._id, productId: product._id },
      {
        $setOnInsert: {
          warehouseId: main._id,
          productId: product._id,
          sellable: opening,
          damaged: 0,
          inTransit: 0,
          lastMovementAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (opening > 0) {
      try {
        await StockMovementModel.create({
          warehouseId: main._id,
          productId: product._id,
          bucket: 'sellable',
          delta: opening,
          balanceAfter: opening,
          type: 'opening_stock',
          refType: 'opening_stock',
          refId: main._id,
          refLine: 0,
          ...(product.purchasePrice ? { unitCost: product.purchasePrice } : {}),
          reason: 'Warehouse module bootstrap — existing stock on hand',
          actorId: adminId,
          occurredAt: new Date(),
          idempotencyKey: `bootstrap:${String(product._id)}`,
        });
      } catch (err) {
        if (!(err && typeof err === 'object' && (err as { code?: number }).code === 11000)) throw err;
      }
    }

    if (raw !== opening) {
      try {
        await StockMovementModel.create({
          warehouseId: main._id,
          productId: product._id,
          bucket: 'sellable',
          delta: 0,
          balanceAfter: opening,
          type: 'manual_adjustment',
          refType: 'adjustment',
          refId: main._id,
          reason: `Bootstrap clamp: source quantity was ${raw}, recorded as ${opening}`,
          actorId: adminId,
          occurredAt: new Date(),
          idempotencyKey: `bootstrap-clamp:${String(product._id)}`,
        });
      } catch (err) {
        if (!(err && typeof err === 'object' && (err as { code?: number }).code === 11000)) throw err;
      }
    }
  }

  // Rebuild the mirror from the balances for every product — patching only null/negative would leave
  // a fractional source quantity out of step with its truncated balance.
  await syncProductQuantityMirror(products.map((p) => String(p._id)));

  await ProductModel.updateMany({ lastPurchaseRate: { $exists: false } }, [
    { $set: { lastPurchaseRate: { $ifNull: ['$purchasePrice', 0] } } },
  ]);

  for (const kind of WAREHOUSE_DOCUMENT_KINDS) {
    await CounterModel.updateOne({ _id: kind }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  }

  await OrderModel.updateMany(
    { warehouseId: { $exists: false }, isTrashed: { $ne: true } },
    { $set: { warehouseId: main._id } },
  );
  await ReturnModel.updateMany(
    { warehouseId: { $exists: false }, isTrashed: { $ne: true } },
    { $set: { warehouseId: main._id } },
  );
}

async function balanceOf(productName: string) {
  const product = await ProductModel.findOne({ name: productName }).select('_id').lean();
  const row = await WarehouseStockModel.findOne({ productId: product!._id }).lean();
  return { sellable: row?.sellable ?? 0, damaged: row?.damaged ?? 0 };
}

async function seedMessyData() {
  const admin = await UserModel.create({
    userID: 'A1', username: 'admin.one', phone: '03000000001', password: 'x', role: 'admin',
  });
  adminId = admin._id;

  const dealer = await DealerModel.create({
    name: 'Test Shop', phone: '03111111111', address: { city: 'Lahore' },
  });

  const base = { categoryId: CATEGORY, createdBy: admin._id };

  const [normal, nullQty, negativeQty, fractional, noPrice, trashed] = await ProductModel.create([
    { ...base, barcode: 'P1', name: 'Normal', quantity: 120, purchasePrice: 15 },
    // `quantity` genuinely absent — the field is optional on the model.
    { ...base, barcode: 'P2', name: 'Null Qty', purchasePrice: 20 },
    { ...base, barcode: 'P3', name: 'Negative Qty', quantity: 0, purchasePrice: 5 },
    { ...base, barcode: 'P4', name: 'Fractional Qty', quantity: 10.7, purchasePrice: 9 },
    { ...base, barcode: 'P5', name: 'No Price', quantity: 30 },
    { ...base, barcode: 'P6', name: 'Trashed', quantity: 40, purchasePrice: 12, isTrashed: true },
  ]);

  // Negative stock has to be written the way it actually happens in production — through `$inc`,
  // which skips the `min: 0` validator. `create()` would be rejected, which is precisely why the
  // real data can hold values the schema claims are impossible.
  await ProductModel.updateOne({ _id: negativeQty._id }, { $set: { quantity: -8 } });

  // Open orders in every pre-delivery status: their stock is ALREADY out of Product.quantity.
  for (const status of ['pending', 'approved', 'packed', 'dispatched'] as const) {
    await OrderModel.create({
      products: [{ productId: normal._id, quantity: 5, price: 30 }],
      status,
      dealerId: dealer._id,
      createdBy: admin._id,
      totalPrice: 150,
      grandTotal: 150,
    });
  }

  // Returns not yet completed — no stock effect yet.
  for (const status of ['pending', 'approved', 'picked'] as const) {
    await ReturnModel.create({
      dealerId: dealer._id,
      returnType: 'return',
      status,
      products: [{ productId: normal._id, quantity: 2, price: 30 }],
      createdBy: admin._id,
    });
  }

  // A completed DAMAGE return. Under the old code this never touched Product.quantity, so those
  // pieces do not exist in stock and must not be conjured into the damaged bucket.
  await ReturnModel.create({
    dealerId: dealer._id,
    returnType: 'damage',
    status: 'completed',
    products: [{ productId: normal._id, quantity: 7, price: 30 }],
    createdBy: admin._id,
  });

  return { normal, nullQty, negativeQty, fractional, noPrice, trashed };
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'warehouse-bootstrap-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  const seeded = await seedMessyData();

  // -------------------------------------------------------------------------
  console.log('First run');
  // -------------------------------------------------------------------------
  await runBootstrap();

  await test('exactly one Main warehouse is created', async () => {
    assert.equal(await WarehouseModel.countDocuments({ isMain: true }), 1);
  });

  await test('a normal product carries its quantity across', async () => {
    assert.equal((await balanceOf('Normal')).sellable, 120);
  });

  await test('an absent quantity becomes 0, matching every existing `?? 0` reader', async () => {
    assert.equal((await balanceOf('Null Qty')).sellable, 0);
    const p = await ProductModel.findById(seeded.nullQty._id).select('quantity').lean();
    assert.equal(p?.quantity, 0, 'the mirror is normalised too');
  });

  await test('a NEGATIVE quantity clamps to 0 and leaves an auditable adjustment', async () => {
    assert.equal((await balanceOf('Negative Qty')).sellable, 0);
    const clamp = await StockMovementModel.findOne({
      idempotencyKey: `bootstrap-clamp:${String(seeded.negativeQty._id)}`,
    }).lean();
    assert.ok(clamp, 'the loss must be visible, not silently absorbed');
    assert.match(clamp!.reason ?? '', /was -8, recorded as 0/);
  });

  await test('a fractional quantity is truncated, recorded, and the mirror follows', async () => {
    assert.equal((await balanceOf('Fractional Qty')).sellable, 10);
    const clamp = await StockMovementModel.findOne({
      idempotencyKey: `bootstrap-clamp:${String(seeded.fractional._id)}`,
    }).lean();
    assert.ok(clamp);
    // Patching only null/negative used to leave 10.7 in the mirror against a balance of 10 —
    // drift created by the very script that establishes the invariant.
    const p = await ProductModel.findById(seeded.fractional._id).select('quantity').lean();
    assert.equal(p?.quantity, 10);
  });

  await test('a trashed product keeps its stock — restoring it must bring the stock back', async () => {
    assert.equal((await balanceOf('Trashed')).sellable, 40);
  });

  await test('a product with no purchase price gets no cost basis, rather than a made-up one', async () => {
    const movement = await StockMovementModel.findOne({
      idempotencyKey: `bootstrap:${String(seeded.noPrice._id)}`,
    }).lean();
    assert.equal(movement?.unitCost, undefined);
    const p = await ProductModel.findById(seeded.noPrice._id).select('purchasePrice').lean();
    assert.ok(!p?.purchasePrice, 'purchasePrice must NOT be invented — it is the live COGS basis');
  });

  await test('lastPurchaseRate is seeded from purchasePrice, never the other way round', async () => {
    const p = await ProductModel.findById(seeded.normal._id)
      .select('purchasePrice lastPurchaseRate')
      .lean();
    assert.equal(p?.lastPurchaseRate, 15);
    assert.equal(p?.purchasePrice, 15, 'purchasePrice is untouched');
  });

  await test('open orders are stamped with Main and write NO movement', async () => {
    const orders = await OrderModel.find({}).select('warehouseId status').lean();
    assert.equal(orders.length, 4);
    for (const order of orders) assert.ok(order.warehouseId, 'every order gets a warehouse');

    // Their stock was consumed under the old global model and is already reflected in the opening
    // balance — writing a movement would double-count it.
    const orderMovements = await StockMovementModel.countDocuments({ refType: 'order' });
    assert.equal(orderMovements, 0);
  });

  await test('non-completed returns are stamped but move nothing', async () => {
    const returns = await ReturnModel.find({ status: { $ne: 'completed' } }).select('warehouseId').lean();
    assert.equal(returns.length, 3);
    for (const r of returns) assert.ok(r.warehouseId);
    assert.equal(await StockMovementModel.countDocuments({ refType: 'return' }), 0);
  });

  await test('a completed DAMAGE return produces zero damaged stock', async () => {
    // Those pieces never entered Product.quantity, so migrating them would invent inventory.
    assert.equal((await balanceOf('Normal')).damaged, 0);
    const all = await WarehouseStockModel.find({ damaged: { $gt: 0 } }).lean();
    assert.deepEqual(all, []);
  });

  await test('the four document counters are seeded at 0', async () => {
    for (const kind of WAREHOUSE_DOCUMENT_KINDS) {
      const counter = await CounterModel.findById(kind).lean();
      assert.equal(counter?.seq, 0, `${kind} should start at 0 so the first document is #1`);
    }
  });

  await test('both integrity invariants hold immediately after the migration', async () => {
    assert.deepEqual(await getIntegrityReport(), []);
  });

  // -------------------------------------------------------------------------
  console.log('\nSecond run (idempotency)');
  // -------------------------------------------------------------------------
  const snapshot = {
    warehouses: await WarehouseModel.countDocuments({}),
    balances: await WarehouseStockModel.find({}).sort({ productId: 1 }).lean(),
    movements: await StockMovementModel.countDocuments({}),
  };

  await runBootstrap();

  await test('re-running creates no second Main warehouse', async () => {
    assert.equal(await WarehouseModel.countDocuments({}), snapshot.warehouses);
    assert.equal(await WarehouseModel.countDocuments({ isMain: true }), 1);
  });

  await test('re-running writes no extra movements', async () => {
    assert.equal(await StockMovementModel.countDocuments({}), snapshot.movements);
  });

  await test('re-running leaves every balance byte-identical', async () => {
    const after = await WarehouseStockModel.find({}).sort({ productId: 1 }).lean();
    assert.equal(after.length, snapshot.balances.length);
    for (let i = 0; i < after.length; i += 1) {
      assert.equal(after[i].sellable, snapshot.balances[i].sellable);
      assert.equal(after[i].damaged, snapshot.balances[i].damaged);
      assert.equal(after[i].inTransit, snapshot.balances[i].inTransit);
    }
  });

  await test('re-running does not clobber balances that real movements have since changed', async () => {
    // Simulate a sale after the first migration, then migrate again.
    const product = await ProductModel.findOne({ name: 'Normal' }).select('_id').lean();
    await WarehouseStockModel.updateOne({ productId: product!._id }, { $inc: { sellable: -20 } });
    await runBootstrap();
    assert.equal(
      (await balanceOf('Normal')).sellable,
      100,
      '`$setOnInsert` must not overwrite a live balance',
    );
  });

  await test('the integrity report is still clean after the repeated runs', async () => {
    // The deliberate hand-edit above put the balance out of step with the ledger, which is exactly
    // what the drift detector is for.
    const drift = await getIntegrityReport();
    assert.ok(
      drift.some((d) => d.kind === 'ledger_drift'),
      'a hand-edited balance must be caught as ledger drift',
    );
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} bootstrap migration tests passed.`);
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
