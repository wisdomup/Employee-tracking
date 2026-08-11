/**
 * Inline stock correction — the "edit the quantities on the warehouse page" path.
 *
 * The point of these tests is that a direct edit is still a LEDGER movement: it computes a delta
 * against what is stored, cannot drive a bucket negative, keeps the `Product.quantity` mirror in
 * step, and carries the reason on every row it writes.
 *
 * Run with: npm run test:stock-adjust
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { UserModel } from '../../models/user.model';
import '../../models/category.model';

import * as warehousesService from './warehouses.service';
import { adjustStock } from './stock-adjustments.service';
import { applyStockMovements, getIntegrityReport } from './stock-ledger.service';
import { adjustStockSchema } from './dto/warehouse.schemas';

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
let mongod: MongoMemoryServer;
let adminId: string;
let warehouseId: string;
let otherWarehouseId: string;
let productA: string;
let productB: string;

async function balance(wid: string, pid: string) {
  const doc = await WarehouseStockModel.findOne({ warehouseId: wid, productId: pid }).lean();
  return {
    sellable: doc?.sellable ?? 0,
    damaged: doc?.damaged ?? 0,
    inTransit: doc?.inTransit ?? 0,
  };
}

async function mirrorOf(pid: string) {
  return (await ProductModel.findById(pid).select('quantity').lean())?.quantity ?? 0;
}

/** Put the fixture back to a known 100 sellable / 10 damaged at the test warehouse. */
async function resetTo(sellable: number, damaged: number) {
  await Promise.all([WarehouseStockModel.deleteMany({}), StockMovementModel.deleteMany({})]);
  await ProductModel.updateMany({}, { $set: { quantity: 0 } });
  await applyStockMovements(
    [
      { warehouseId, productId: productA, bucket: 'sellable', delta: sellable, type: 'opening_stock', unitCost: 50 },
      { warehouseId, productId: productA, bucket: 'damaged', delta: damaged, type: 'opening_stock' },
    ],
    { refType: 'opening_stock', refId: String(new Types.ObjectId()), actorId: adminId },
  );
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'stock-adjust-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
  ]);

  const admin = await UserModel.create({
    userID: 'ADM-1', username: 'admin.one', phone: '03001110001', password: 'x', role: 'admin',
  });
  adminId = String(admin._id);

  // Through the service, so `cityKey` is normalised the same way the app does it.
  warehouseId = String(
    (await warehousesService.createWarehouse({ name: 'Main Warehouse', city: 'Faisalabad' }, adminId))._id,
  );
  otherWarehouseId = String(
    (await warehousesService.createWarehouse({ name: 'Lahore Warehouse', city: 'Lahore' }, adminId))._id,
  );

  const [a, b] = await ProductModel.create([
    { barcode: 'A-1', name: 'Product A', categoryId: CATEGORY, createdBy: admin._id, salePrice: 100 },
    { barcode: 'B-1', name: 'Product B', categoryId: CATEGORY, createdBy: admin._id, salePrice: 250 },
  ]);
  productA = String(a._id);
  productB = String(b._id);

  // -------------------------------------------------------------------------
  console.log('The figures typed are absolute, the movement posted is the difference');
  // -------------------------------------------------------------------------
  await test('raising the sellable figure posts only the shortfall', async () => {
    await resetTo(100, 10);
    const result = await adjustStock(
      { warehouseId, reason: 'Recount after restack', lines: [{ productId: productA, sellable: 120 }] },
      adminId,
    );

    assert.equal((await balance(warehouseId, productA)).sellable, 120);
    assert.equal(result.changes.length, 1);
    assert.deepEqual(
      { bucket: result.changes[0].bucket, from: result.changes[0].from, to: result.changes[0].to, delta: result.changes[0].delta },
      { bucket: 'sellable', from: 100, to: 120, delta: 20 },
    );

    const movement = await StockMovementModel.findOne({ type: 'manual_adjustment' }).lean();
    assert.equal(movement?.delta, 20, 'the ledger row is the delta, not the typed figure');
    assert.equal(movement?.balanceAfter, 120);
  });

  await test('lowering it posts a negative delta', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId, reason: 'Two cartons found damaged', lines: [{ productId: productA, sellable: 92 }] },
      adminId,
    );
    assert.equal((await balance(warehouseId, productA)).sellable, 92);
    assert.equal((await StockMovementModel.findOne({ type: 'manual_adjustment' }).lean())?.delta, -8);
  });

  await test('both buckets can move in one correction', async () => {
    await resetTo(100, 10);
    const result = await adjustStock(
      { warehouseId, reason: 'Moved 5 pieces to the damage shelf', lines: [{ productId: productA, sellable: 95, damaged: 15 }] },
      adminId,
    );
    assert.deepEqual(await balance(warehouseId, productA), { sellable: 95, damaged: 15, inTransit: 0 });
    assert.equal(result.movements, 2);
    assert.equal(result.adjustedProducts, 1);
  });

  await test('a bucket left out of the line is not touched', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId, reason: 'Sellable only', lines: [{ productId: productA, sellable: 111 }] },
      adminId,
    );
    assert.deepEqual(await balance(warehouseId, productA), { sellable: 111, damaged: 10, inTransit: 0 });
  });

  await test('a bucket already matching writes no row', async () => {
    await resetTo(100, 10);
    const result = await adjustStock(
      { warehouseId, reason: 'Only damaged changed', lines: [{ productId: productA, sellable: 100, damaged: 12 }] },
      adminId,
    );
    assert.equal(result.movements, 1);
    assert.equal(result.changes[0].bucket, 'damaged');
  });

  await test('a product the warehouse has never held starts from zero', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId, reason: 'Stock found in the back room', lines: [{ productId: productB, sellable: 7 }] },
      adminId,
    );
    assert.equal((await balance(warehouseId, productB)).sellable, 7);
  });

  // -------------------------------------------------------------------------
  console.log('\nGuards');
  // -------------------------------------------------------------------------
  await test('a correction that changes nothing is refused rather than logged as a no-op', async () => {
    await resetTo(100, 10);
    await rejectsWith(
      adjustStock(
        { warehouseId, reason: 'No change', lines: [{ productId: productA, sellable: 100, damaged: 10 }] },
        adminId,
      ),
      /Nothing to change/i,
    );
    assert.equal(await StockMovementModel.countDocuments({ type: 'manual_adjustment' }), 0);
  });

  await test('re-submitting the same correction is harmless — the second finds nothing to do', async () => {
    await resetTo(100, 10);
    const payload = { warehouseId, reason: 'Recount', lines: [{ productId: productA, sellable: 130 }] };
    await adjustStock(payload, adminId);
    await rejectsWith(adjustStock(payload, adminId), /Nothing to change/i);
    assert.equal((await balance(warehouseId, productA)).sellable, 130, 'not applied twice');
  });

  await test('the same product twice in one payload is refused', async () => {
    await resetTo(100, 10);
    await rejectsWith(
      adjustStock(
        { warehouseId, reason: 'Confused', lines: [{ productId: productA, sellable: 5 }, { productId: productA, sellable: 9 }] },
        adminId,
      ),
      /more than once/i,
    );
  });

  await test('an unknown product is refused before anything is written', async () => {
    await resetTo(100, 10);
    await rejectsWith(
      adjustStock(
        { warehouseId, reason: 'Typo', lines: [{ productId: String(new Types.ObjectId()), sellable: 5 }] },
        adminId,
      ),
      /could not be found/i,
    );
    assert.equal(await StockMovementModel.countDocuments({ type: 'manual_adjustment' }), 0);
  });

  await test('a trashed product is refused', async () => {
    await resetTo(100, 10);
    await ProductModel.updateOne({ _id: productB }, { $set: { isTrashed: true } });
    await rejectsWith(
      adjustStock({ warehouseId, reason: 'Gone', lines: [{ productId: productB, sellable: 3 }] }, adminId),
      /could not be found/i,
    );
    await ProductModel.updateOne({ _id: productB }, { $set: { isTrashed: false } });
  });

  await test('a correction against another warehouse leaves this one alone', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId: otherWarehouseId, reason: 'Lahore recount', lines: [{ productId: productA, sellable: 4 }] },
      adminId,
    );
    assert.equal((await balance(warehouseId, productA)).sellable, 100);
    assert.equal((await balance(otherWarehouseId, productA)).sellable, 4);
  });

  await test('the schema rejects fractions, negatives and a line naming no bucket', () => {
    const base = { warehouseId: new Types.ObjectId().toHexString(), reason: 'Recount' };
    const pid = new Types.ObjectId().toHexString();
    assert.ok(adjustStockSchema.validate({ ...base, lines: [{ productId: pid, sellable: 1.5 }] }).error);
    assert.ok(adjustStockSchema.validate({ ...base, lines: [{ productId: pid, sellable: -1 }] }).error);
    assert.ok(adjustStockSchema.validate({ ...base, lines: [{ productId: pid }] }).error);
    // Zero is legitimate — "this shelf is empty" is a real correction.
    assert.equal(adjustStockSchema.validate({ ...base, lines: [{ productId: pid, sellable: 0 }] }).error, undefined);
  });

  await test('the reason is mandatory at the schema, so no adjustment reaches the ledger without one', () => {
    const pid = new Types.ObjectId().toHexString();
    const wid = new Types.ObjectId().toHexString();
    assert.ok(adjustStockSchema.validate({ warehouseId: wid, lines: [{ productId: pid, sellable: 1 }] }).error);
    assert.ok(
      adjustStockSchema.validate({ warehouseId: wid, reason: 'x', lines: [{ productId: pid, sellable: 1 }] }).error,
      'a one-character reason is not a reason',
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nIt is a real ledger movement, not a back door');
  // -------------------------------------------------------------------------
  await test('the reason is recorded on every row written', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId, reason: 'Physical recount 12 Aug', lines: [{ productId: productA, sellable: 90, damaged: 20 }] },
      adminId,
    );
    const rows = await StockMovementModel.find({ type: 'manual_adjustment' }).lean();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.reason, 'Physical recount 12 Aug');
      assert.equal(String(row.actorId), adminId);
      assert.equal(row.refType, 'adjustment');
    }
  });

  await test('the Product.quantity mirror follows the sellable bucket', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId, reason: 'Recount', lines: [{ productId: productA, sellable: 61, damaged: 99 }] },
      adminId,
    );
    assert.equal(await mirrorOf(productA), 61, 'damaged does not reach the mirror');
  });

  await test('an adjustment carries no unit cost, so it cannot re-price inventory', async () => {
    await resetTo(100, 10);
    const before = (await ProductModel.findById(productA).select('purchasePrice').lean())?.purchasePrice;
    await adjustStock(
      { warehouseId, reason: 'Recount', lines: [{ productId: productA, sellable: 250 }] },
      adminId,
    );
    const after = (await ProductModel.findById(productA).select('purchasePrice').lean())?.purchasePrice;
    assert.equal(after, before, 'the weighted average is untouched');
    const rows = await StockMovementModel.find({ type: 'manual_adjustment' }).lean();
    assert.ok(rows.every((r) => r.unitCost === undefined));
  });

  await test('a multi-product correction that names a bad product writes nothing at all', async () => {
    await resetTo(100, 10);
    await rejectsWith(
      adjustStock(
        {
          warehouseId,
          reason: 'Two products, one of them wrong',
          lines: [{ productId: productA, sellable: 150 }, { productId: String(new Types.ObjectId()), sellable: 5 }],
        },
        adminId,
      ),
      /could not be found/i,
    );
    assert.equal((await balance(warehouseId, productA)).sellable, 100, 'product A was not touched');
    assert.equal(await StockMovementModel.countDocuments({ type: 'manual_adjustment' }), 0);
  });

  await test('zero is a legitimate target — it clears the bucket without going negative', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId, reason: 'Shelf is empty', lines: [{ productId: productA, sellable: 0, damaged: 0 }] },
      adminId,
    );
    // Targets are absolute and the schema floors them at zero, so this path computes a delta that
    // lands exactly on the target — it can never ask the ledger for a negative balance.
    assert.deepEqual(await balance(warehouseId, productA), { sellable: 0, damaged: 0, inTransit: 0 });
    assert.equal(await mirrorOf(productA), 0);
  });

  await test('both integrity invariants hold after every correction above', async () => {
    await resetTo(100, 10);
    await adjustStock(
      { warehouseId, reason: 'Final recount', lines: [{ productId: productA, sellable: 77, damaged: 3 }] },
      adminId,
    );
    await adjustStock(
      { warehouseId: otherWarehouseId, reason: 'Final recount', lines: [{ productId: productA, sellable: 9 }] },
      adminId,
    );
    assert.deepEqual(await getIntegrityReport(), []);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} stock-adjustment tests passed.`);
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
