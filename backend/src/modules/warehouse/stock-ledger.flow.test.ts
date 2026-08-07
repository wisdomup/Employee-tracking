/**
 * Invariants of the stock ledger — the choke point every other stock flow depends on.
 *
 * The important cases are the ones that stand in for a database transaction: a multi-line movement
 * whose last line fails must leave NOTHING applied, and replaying the same operation must move no
 * stock a second time. Runs against a throwaway in-memory MongoDB (a standalone node, so the
 * compensating path — not the transactional one — is what these tests exercise).
 *
 * Run with: npm run test:stock-ledger
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import '../../models/user.model';
import '../../models/category.model';
import { applyStockMovements, getIntegrityReport, syncProductQuantityMirror, resyncMirror } from './stock-ledger.service';

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

const ACTOR = new Types.ObjectId();
const CATEGORY = new Types.ObjectId();
let mongod: MongoMemoryServer;
let mainId: string;
let lahoreId: string;
let productA: string;
let productB: string;
let productC: string;

async function balance(warehouseId: string, productId: string) {
  const doc = await WarehouseStockModel.findOne({ warehouseId, productId }).lean();
  return {
    sellable: doc?.sellable ?? 0,
    damaged: doc?.damaged ?? 0,
    inTransit: doc?.inTransit ?? 0,
  };
}

async function mirror(productId: string) {
  const p = await ProductModel.findById(productId).select('quantity').lean();
  return p?.quantity ?? 0;
}

/** Σ ledger delta per bucket for one warehouse+product. */
async function ledgerNet(warehouseId: string, productId: string, bucket: string) {
  const rows = await StockMovementModel.aggregate([
    {
      $match: {
        warehouseId: new Types.ObjectId(warehouseId),
        productId: new Types.ObjectId(productId),
        bucket,
      },
    },
    { $group: { _id: null, net: { $sum: '$delta' } } },
  ]);
  return rows[0]?.net ?? 0;
}

async function seed() {
  await WarehouseStockModel.deleteMany({});
  await StockMovementModel.deleteMany({});
  await ProductModel.deleteMany({});
  await WarehouseModel.deleteMany({});

  const [main, lahore] = await WarehouseModel.create([
    { name: 'Main Warehouse', city: 'Faisalabad', cityKey: 'faisalabad', isMain: true, isActive: true },
    { name: 'Lahore Warehouse', city: 'Lahore', cityKey: 'lahore', isActive: true },
  ]);
  mainId = String(main._id);
  lahoreId = String(lahore._id);

  const [a, b, c] = await ProductModel.create([
    { barcode: 'A', name: 'Product A', categoryId: CATEGORY, createdBy: ACTOR },
    { barcode: 'B', name: 'Product B', categoryId: CATEGORY, createdBy: ACTOR },
    { barcode: 'C', name: 'Product C', categoryId: CATEGORY, createdBy: ACTOR },
  ]);
  productA = String(a._id);
  productB = String(b._id);
  productC = String(c._id);
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'stock-ledger-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await WarehouseStockModel.syncIndexes();
  await StockMovementModel.syncIndexes();
  await WarehouseModel.syncIndexes();

  // -------------------------------------------------------------------------
  console.log('Applying movements');
  // -------------------------------------------------------------------------
  await seed();

  await test('a positive movement creates the balance row with the other buckets at zero', async () => {
    // Guards the `$setOnInsert` / `$inc` field-conflict trap: seeding the same field both ways
    // makes Mongo throw "would create a conflict".
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productA, bucket: 'sellable', delta: 100, type: 'stock_in', unitCost: 10 }],
      { refType: 'stock_in', refId: String(new Types.ObjectId()), actorId: String(ACTOR) },
    );
    const b = await balance(mainId, productA);
    assert.deepEqual(b, { sellable: 100, damaged: 0, inTransit: 0 });
  });

  await test('the ledger records balanceAfter', async () => {
    const row = await StockMovementModel.findOne({ productId: productA }).lean();
    assert.equal(row?.balanceAfter, 100);
    assert.equal(row?.delta, 100);
    assert.equal(row?.type, 'stock_in');
  });

  await test('a receipt sets the product cost and the last purchase rate', async () => {
    const p = await ProductModel.findById(productA).select('purchasePrice lastPurchaseRate').lean();
    assert.equal(p?.purchasePrice, 10);
    assert.equal(p?.lastPurchaseRate, 10);
  });

  await test('the mirror equals the sum of sellable across warehouses', async () => {
    await applyStockMovements(
      [{ warehouseId: lahoreId, productId: productA, bucket: 'sellable', delta: 40, type: 'transfer_in' }],
      { refType: 'transfer', refId: String(new Types.ObjectId()), actorId: String(ACTOR) },
    );
    assert.equal(await mirror(productA), 140);
  });

  await test('a transfer cannot carry a unit cost — cost is structurally receipt-only', async () => {
    await rejectsWith(
      applyStockMovements(
        [
          {
            warehouseId: mainId,
            productId: productA,
            bucket: 'sellable',
            delta: 5,
            type: 'transfer_in',
            unitCost: 999,
          },
        ],
        { refType: 'transfer', refId: String(new Types.ObjectId()), actorId: String(ACTOR) },
      ),
      /may not carry a unit cost/i,
    );
  });

  await test('a fractional quantity is refused', async () => {
    await rejectsWith(
      applyStockMovements(
        [{ warehouseId: mainId, productId: productA, bucket: 'sellable', delta: 1.5, type: 'stock_in' }],
        { refType: 'stock_in', refId: String(new Types.ObjectId()) },
      ),
      /whole pieces/i,
    );
  });

  await test('duplicate lines for the same warehouse+product+bucket are merged', async () => {
    const refId = String(new Types.ObjectId());
    await applyStockMovements(
      [
        { warehouseId: mainId, productId: productB, bucket: 'sellable', delta: 10, type: 'stock_in' },
        { warehouseId: mainId, productId: productB, bucket: 'sellable', delta: 15, type: 'stock_in' },
      ],
      { refType: 'stock_in', refId },
    );
    assert.equal((await balance(mainId, productB)).sellable, 25);
    // One merged ledger row, not two.
    assert.equal(await StockMovementModel.countDocuments({ refId: new Types.ObjectId(refId) }), 1);
  });

  // -------------------------------------------------------------------------
  console.log('\nNon-negative stock');
  // -------------------------------------------------------------------------
  await test('taking more than is available is refused and the balance is untouched', async () => {
    await seed();
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productA, bucket: 'sellable', delta: 3, type: 'stock_in' }],
      { refType: 'stock_in', refId: String(new Types.ObjectId()) },
    );
    await rejectsWith(
      applyStockMovements(
        [{ warehouseId: mainId, productId: productA, bucket: 'sellable', delta: -5, type: 'sale_out' }],
        { refType: 'order', refId: String(new Types.ObjectId()) },
      ),
      /insufficient sellable stock/i,
    );
    assert.equal((await balance(mainId, productA)).sellable, 3, 'compensation must leave 3');
  });

  await test('the error names the product, warehouse, available and required', async () => {
    try {
      await applyStockMovements(
        [{ warehouseId: mainId, productId: productA, bucket: 'sellable', delta: -9, type: 'sale_out' }],
        { refType: 'order', refId: String(new Types.ObjectId()) },
      );
      assert.fail('expected a rejection');
    } catch (err) {
      const message = (err as Error).message;
      assert.match(message, /Product A/);
      assert.match(message, /Main Warehouse/);
      assert.match(message, /Available: 3/);
      assert.match(message, /required: 9/);
    }
  });

  await test('a product with no balance row at all reads as zero, not as unlimited', async () => {
    await rejectsWith(
      applyStockMovements(
        [{ warehouseId: lahoreId, productId: productC, bucket: 'sellable', delta: -1, type: 'sale_out' }],
        { refType: 'order', refId: String(new Types.ObjectId()) },
      ),
      /Available: 0/,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nAll-or-nothing (what stands in for a transaction)');
  // -------------------------------------------------------------------------
  await test('a 3-line movement whose LAST line fails leaves the first two rolled back', async () => {
    await seed();
    await applyStockMovements(
      [
        { warehouseId: mainId, productId: productA, bucket: 'sellable', delta: 50, type: 'stock_in' },
        { warehouseId: mainId, productId: productB, bucket: 'sellable', delta: 50, type: 'stock_in' },
        { warehouseId: mainId, productId: productC, bucket: 'sellable', delta: 1, type: 'stock_in' },
      ],
      { refType: 'stock_in', refId: String(new Types.ObjectId()) },
    );

    // Lines are applied in a stable sorted order; C only has 1 piece, so its line fails.
    await rejectsWith(
      applyStockMovements(
        [
          { warehouseId: mainId, productId: productA, bucket: 'sellable', delta: -10, type: 'sale_out' },
          { warehouseId: mainId, productId: productB, bucket: 'sellable', delta: -10, type: 'sale_out' },
          { warehouseId: mainId, productId: productC, bucket: 'sellable', delta: -10, type: 'sale_out' },
        ],
        { refType: 'order', refId: String(new Types.ObjectId()) },
      ),
      /insufficient/i,
    );

    assert.equal((await balance(mainId, productA)).sellable, 50, 'A must be rolled back');
    assert.equal((await balance(mainId, productB)).sellable, 50, 'B must be rolled back');
    assert.equal((await balance(mainId, productC)).sellable, 1);
  });

  await test('a failed movement writes no ledger rows', async () => {
    const refId = String(new Types.ObjectId());
    await rejectsWith(
      applyStockMovements(
        [{ warehouseId: mainId, productId: productC, bucket: 'sellable', delta: -10, type: 'sale_out' }],
        { refType: 'order', refId },
      ),
      /insufficient/i,
    );
    assert.equal(await StockMovementModel.countDocuments({ refId: new Types.ObjectId(refId) }), 0);
  });

  await test('a movement against a missing product is refused before anything is written', async () => {
    const before = (await balance(mainId, productA)).sellable;
    await rejectsWith(
      applyStockMovements(
        [
          { warehouseId: mainId, productId: productA, bucket: 'sellable', delta: -1, type: 'sale_out' },
          { warehouseId: mainId, productId: String(new Types.ObjectId()), bucket: 'sellable', delta: -1, type: 'sale_out' },
        ],
        { refType: 'order', refId: String(new Types.ObjectId()) },
      ),
      /could not be found/i,
    );
    assert.equal((await balance(mainId, productA)).sellable, before);
  });

  // -------------------------------------------------------------------------
  console.log('\nIdempotency (replay safety)');
  // -------------------------------------------------------------------------
  await test('replaying the same operation moves no stock and writes no extra ledger rows', async () => {
    await seed();
    const refId = String(new Types.ObjectId());
    const lines = [
      { warehouseId: mainId, productId: productA, bucket: 'sellable' as const, delta: 20, type: 'stock_in' as const, refLine: 0 },
    ];
    const first = await applyStockMovements(lines, { refType: 'stock_in', refId });
    assert.equal(first.alreadyApplied, false);

    const second = await applyStockMovements(lines, { refType: 'stock_in', refId });
    assert.equal(second.alreadyApplied, true, 'the replay must be recognised');
    assert.equal((await balance(mainId, productA)).sellable, 20, 'stock must not double');
    assert.equal(await StockMovementModel.countDocuments({ refId: new Types.ObjectId(refId) }), 1);
  });

  await test('an idempotencyScope lets the same document legitimately move stock again', async () => {
    const refId = String(new Types.ObjectId());
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productB, bucket: 'sellable', delta: 5, type: 'transfer_out' }],
      { refType: 'transfer', refId, idempotencyScope: 'approve' },
    );
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productB, bucket: 'sellable', delta: 5, type: 'transfer_out' }],
      { refType: 'transfer', refId, idempotencyScope: 'receive' },
    );
    assert.equal((await balance(mainId, productB)).sellable, 10);
  });

  // -------------------------------------------------------------------------
  console.log('\nThe Product.quantity mirror');
  // -------------------------------------------------------------------------
  await test('the mirror tracks only the sellable bucket, not damaged or in-transit', async () => {
    await seed();
    await applyStockMovements(
      [
        { warehouseId: mainId, productId: productA, bucket: 'sellable', delta: 100, type: 'stock_in' },
        { warehouseId: mainId, productId: productA, bucket: 'damaged', delta: 30, type: 'opening_stock' },
        { warehouseId: mainId, productId: productA, bucket: 'in_transit', delta: 20, type: 'transfer_out' },
      ],
      { refType: 'opening_stock', refId: String(new Types.ObjectId()) },
    );
    assert.equal(await mirror(productA), 100);
  });

  await test('recomputing the mirror twice gives the same value (absolute $set, not $inc)', async () => {
    await syncProductQuantityMirror([productA]);
    const once = await mirror(productA);
    await syncProductQuantityMirror([productA]);
    assert.equal(await mirror(productA), once);
  });

  await test('a hand-corrupted mirror is repaired by resyncMirror', async () => {
    await ProductModel.updateOne({ _id: productA }, { $set: { quantity: 999 } });
    const before = await getIntegrityReport();
    assert.ok(before.some((r) => r.kind === 'mirror_drift'), 'drift must be detected');

    await resyncMirror([productA]);
    assert.equal(await mirror(productA), 100);
  });

  await test('a negative mirror does not brick the product update path', async () => {
    // `min: 0` on the schema is not enforced by `updateOne`, but IS enforced by `save()` — so a
    // negative mirror used to make the product permanently uneditable. The mirror writer must use
    // updateOne and clamp.
    await ProductModel.updateOne({ _id: productA }, { $set: { quantity: -5 } });
    await syncProductQuantityMirror([productA]);
    assert.equal(await mirror(productA), 100);
    const doc = await ProductModel.findById(productA);
    doc!.description = 'edited after a negative mirror';
    await doc!.save();
  });

  // -------------------------------------------------------------------------
  console.log('\nIntegrity: Σ ledger === balance, mirror === Σ sellable');
  // -------------------------------------------------------------------------
  await test('after a run of mixed movements both invariants hold', async () => {
    await seed();
    const ops: Array<[string, string, 'sellable' | 'damaged' | 'in_transit', number, 'stock_in' | 'sale_out' | 'damage_marked' | 'transfer_out']> = [
      [mainId, productA, 'sellable', 200, 'stock_in'],
      [mainId, productB, 'sellable', 90, 'stock_in'],
      [lahoreId, productA, 'sellable', 40, 'stock_in'],
      [mainId, productA, 'sellable', -35, 'sale_out'],
      [mainId, productA, 'damaged', 12, 'damage_marked'],
      [lahoreId, productA, 'sellable', -8, 'sale_out'],
      [mainId, productB, 'sellable', -20, 'sale_out'],
    ];

    for (const [warehouseId, productId, bucket, delta, type] of ops) {
      await applyStockMovements([{ warehouseId, productId, bucket, delta, type }], {
        refType: type === 'stock_in' ? 'stock_in' : 'order',
        refId: String(new Types.ObjectId()),
        actorId: String(ACTOR),
      });
    }

    for (const [warehouseId, productId, bucket] of ops) {
      const current = (await balance(warehouseId, productId))[
        bucket === 'in_transit' ? 'inTransit' : bucket
      ];
      assert.equal(await ledgerNet(warehouseId, productId, bucket), current, `${bucket} ledger vs balance`);
    }

    assert.equal(await mirror(productA), 200 - 35 + 40 - 8);
    assert.equal(await mirror(productB), 90 - 20);

    const drift = await getIntegrityReport();
    assert.deepEqual(drift, [], 'the integrity report must be empty');
  });

  await test('every movement is attributed to an actor and a business date', async () => {
    const rows = await StockMovementModel.find({ actorId: ACTOR }).lean();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(row.occurredAt instanceof Date);
      assert.equal(String(row.actorId), String(ACTOR));
    }
  });

  await test('a backdated movement keeps its own business date', async () => {
    const when = new Date('2026-01-15T00:00:00.000Z');
    const refId = String(new Types.ObjectId());
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productC, bucket: 'sellable', delta: 5, type: 'stock_in' }],
      { refType: 'stock_in', refId, occurredAt: when },
    );
    const row = await StockMovementModel.findOne({ refId: new Types.ObjectId(refId) }).lean();
    assert.equal(row?.occurredAt?.toISOString(), when.toISOString());
  });

  // -------------------------------------------------------------------------
  console.log('\nThe choke point is the only writer');
  // -------------------------------------------------------------------------
  await test('no file outside the ledger service writes a stock balance or the mirror', async () => {
    // Crude, but it is the only thing that will stop the next contributor reintroducing the drift
    // this whole design exists to prevent. If this fails, add a movement type instead.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const ALLOWED = new Set([
      // The choke point itself.
      path.join('modules', 'warehouse', 'stock-ledger.service.ts'),
      // The bootstrap migration seeds balances before any traffic exists, by design.
      path.join('database', 'migrations', 'warehouse-stock-bootstrap.ts'),
    ]);

    const srcRoot = path.resolve(__dirname, '..', '..');
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;

        const relative = path.relative(srcRoot, full);
        if (ALLOWED.has(relative)) continue;
        // Seeds set up fixtures, and tests deliberately corrupt the invariant to prove the repair
        // path works. The guard is about production code paths.
        if (relative.includes(`database${path.sep}seeds`)) continue;
        if (entry.name.endsWith('.test.ts')) continue;

        const source = await fs.readFile(full, 'utf8');

        // A write against the balance collection.
        if (/WarehouseStockModel\.(updateOne|updateMany|findOneAndUpdate|bulkWrite|create)\b/.test(source)) {
          offenders.push(`${relative}: writes WarehouseStock directly`);
        }
        // A write of the derived mirror.
        if (/ProductModel\.[a-zA-Z]+\([^)]*\$(inc|set)[^)]*quantity/s.test(source)) {
          offenders.push(`${relative}: writes Product.quantity directly`);
        }
      }
    }

    await walk(srcRoot);
    assert.deepEqual(
      offenders,
      [],
      `Stock must only be written through applyStockMovements:\n  ${offenders.join('\n  ')}`,
    );
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} stock-ledger tests passed.`);
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
