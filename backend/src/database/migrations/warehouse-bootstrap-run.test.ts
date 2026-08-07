/**
 * Tests for the REAL `runWarehouseBootstrap` function and the server startup hook that calls it.
 *
 * `warehouse-stock-bootstrap.test.ts` next door reimplements the write phase against fixtures, which
 * pins the RULES but leaves the shipped code path uncovered. This file covers the shipped path: the
 * apply/dry-run/force gates, and the quiet return that a normal pm2 restart depends on.
 *
 * Run with: npm run test:migrate:warehouse-run
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import '../../models/category.model';

import { runWarehouseBootstrap } from './warehouse-stock-bootstrap';
import { runWarehouseBootstrapOnStart } from '../warehouse-bootstrap-on-start';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

const counts = async () => ({
  balances: await WarehouseStockModel.countDocuments({}),
  movements: await StockMovementModel.countDocuments({}),
  warehouses: await WarehouseModel.countDocuments({}),
});

/** The migration is chatty by design; silence it so the test output stays readable. */
function muted<T>(fn: () => Promise<T>): Promise<T> {
  const real = console.log;
  console.log = () => undefined;
  return fn().finally(() => { console.log = real; });
}

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'bootstrap-run-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  const CATEGORY = new Types.ObjectId();
  const AUTHOR = new Types.ObjectId();
  await ProductModel.create([
    { barcode: 'X-1', name: 'Widget', quantity: 25, purchasePrice: 12, salePrice: 20, categoryId: CATEGORY, createdBy: AUTHOR },
    { barcode: 'X-2', name: 'Gadget', quantity: 0, purchasePrice: 5, salePrice: 9, categoryId: CATEGORY, createdBy: AUTHOR },
    { barcode: 'X-3', name: 'Doohickey', quantity: 7, salePrice: 15, categoryId: CATEGORY, createdBy: AUTHOR },
  ]);

  // -------------------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('Gates');
  // -------------------------------------------------------------------------
  await test('a dry run reports and writes absolutely nothing', async () => {
    const status = await muted(() => runWarehouseBootstrap({}));
    assert.equal(status, 'dry-run');
    assert.deepEqual(await counts(), { balances: 0, movements: 0, warehouses: 0 });
  });

  await test('--apply creates Main, one balance per product and one movement per non-zero product', async () => {
    const status = await muted(() => runWarehouseBootstrap({ apply: true }));
    assert.equal(status, 'applied');
    // Three products get a balance row; only Widget(25) and Doohickey(7) are non-zero.
    assert.deepEqual(await counts(), { balances: 3, movements: 2, warehouses: 1 });
    const main = await WarehouseModel.findOne({ isMain: true }).lean();
    assert.ok(main, 'a Main warehouse must exist — everything falls back to it');
  });

  await test('the mirror equals the balances straight after the run', async () => {
    const widget = await ProductModel.findOne({ barcode: 'X-1' }).lean();
    const balance = await WarehouseStockModel.findOne({ productId: widget!._id }).lean();
    assert.equal(widget?.quantity, 25);
    assert.equal(balance?.sellable, 25);
  });

  await test('a product with no purchase price gets no cost basis rather than a made-up one', async () => {
    const doohickey = await ProductModel.findOne({ barcode: 'X-3' }).lean();
    const movement = await StockMovementModel.findOne({ productId: doohickey!._id }).lean();
    assert.equal(movement?.unitCost, undefined, 'an unknown cost must stay unknown, not become 0');
  });

  await test('re-running without --force refuses instead of writing', async () => {
    const before = await counts();
    const status = await muted(() => runWarehouseBootstrap({ apply: true }));
    assert.equal(status, 'needs-force');
    assert.deepEqual(await counts(), before);
  });

  await test('--force re-runs and is a clean no-op', async () => {
    const before = await counts();
    const status = await muted(() => runWarehouseBootstrap({ apply: true, force: true }));
    assert.equal(status, 'applied');
    assert.deepEqual(await counts(), before, 'a forced re-run must fill gaps only, never duplicate');
  });

  await test('a forced re-run does not clobber a balance that real movements have since changed', async () => {
    const widget = await ProductModel.findOne({ barcode: 'X-1' }).lean();
    await WarehouseStockModel.updateOne({ productId: widget!._id }, { $inc: { sellable: -10 } });
    await muted(() => runWarehouseBootstrap({ apply: true, force: true }));
    const balance = await WarehouseStockModel.findOne({ productId: widget!._id }).lean();
    assert.equal(balance?.sellable, 15, '$setOnInsert must not reset a live balance to the seed figure');
  });

  // -------------------------------------------------------------------------
  // eslint-disable-next-line no-console
  console.log('\nStartup hook (what every pm2 restart runs)');
  // -------------------------------------------------------------------------
  await test('a restart on an already-bootstrapped database returns without writing', async () => {
    const before = await counts();
    let printed = false;
    const real = console.log;
    console.log = () => { printed = true; };
    try {
      await runWarehouseBootstrapOnStart();
    } finally {
      console.log = real;
    }
    assert.equal(printed, false, 'a normal restart must stay silent — no census on every boot');
    assert.deepEqual(await counts(), before);
  });

  await test('skipIfDone short-circuits before the census, so the check stays cheap', async () => {
    const status = await muted(() => runWarehouseBootstrap({ apply: true, skipIfDone: true }));
    assert.equal(status, 'already-bootstrapped');
  });

  await test('the kill switch stops the hook doing anything at all', async () => {
    process.env.WAREHOUSE_BOOTSTRAP_ON_START = 'false';
    const before = await counts();
    await muted(() => runWarehouseBootstrapOnStart());
    assert.deepEqual(await counts(), before);
    delete process.env.WAREHOUSE_BOOTSTRAP_ON_START;
  });

  await test('a hook failure is logged, not thrown — one broken feature beats a restart loop', async () => {
    await mongoose.disconnect();
    const realError = console.error;
    let logged = false;
    console.error = () => { logged = true; };
    try {
      // No connection: whatever the driver throws must not escape the hook.
      await runWarehouseBootstrapOnStart();
    } finally {
      console.error = realError;
    }
    assert.equal(logged, true, 'the failure must be loud enough to find in pm2 logs');
    await mongoose.connect(mongod.getUri(), { dbName: 'bootstrap-run-test' });
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} bootstrap-run tests passed.`);

  await mongoose.disconnect();
  await mongod.stop();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
