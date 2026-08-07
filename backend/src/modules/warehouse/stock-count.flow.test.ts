/**
 * Monthly stock count, and the returns rewiring that feeds the damaged bucket.
 *
 * The headline case is the delta rule: approving a count must apply
 * `counted − systemAtSubmission`, never an absolute overwrite, so a sale that happens while the sheet
 * waits for approval is not silently erased.
 *
 * Run with: npm run test:stock-count
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { StockCountModel } from '../../models/stock-count.model';
import { DamageClaimModel } from '../../models/damage-claim.model';
import { ReturnModel } from '../../models/return.model';
import { DealerModel } from '../../models/dealer.model';
import { UserModel } from '../../models/user.model';
import '../../models/category.model';

import * as counts from './stock-counts.service';
import * as returnsService from '../returns/returns.service';
import * as damageClaims from './damage-claims.service';
import { applyStockMovements, getIntegrityReport } from './stock-ledger.service';
import { getValuationReport, getLowStockProducts } from './warehouse-reports.service';

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
let adminA: { userId: string; role: string };
let adminB: { userId: string; role: string };
let staff: { userId: string; role: string };
let warehouseId: string;
let productA: string;
let productB: string;
let dealerId: string;

async function balance(productId: string) {
  const doc = await WarehouseStockModel.findOne({ warehouseId, productId }).lean();
  return { sellable: doc?.sellable ?? 0, damaged: doc?.damaged ?? 0 };
}

async function mirror(productId: string) {
  const p = await ProductModel.findById(productId).select('quantity').lean();
  return p?.quantity ?? 0;
}

async function resetStock(a: number, b: number, damagedA = 0) {
  await Promise.all([
    WarehouseStockModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
    StockCountModel.deleteMany({}),
    DamageClaimModel.deleteMany({}),
    ReturnModel.deleteMany({}),
  ]);

  const lines = [
    { warehouseId, productId: productA, bucket: 'sellable' as const, delta: a, type: 'opening_stock' as const },
    { warehouseId, productId: productB, bucket: 'sellable' as const, delta: b, type: 'opening_stock' as const },
    ...(damagedA > 0
      ? [{ warehouseId, productId: productA, bucket: 'damaged' as const, delta: damagedA, type: 'opening_stock' as const }]
      : []),
  ].filter((l) => l.delta > 0);

  await applyStockMovements(lines, {
    refType: 'opening_stock',
    refId: String(new Types.ObjectId()),
    actorId: adminA.userId,
  });
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'stock-count-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
    StockCountModel.syncIndexes(),
    DamageClaimModel.syncIndexes(),
  ]);

  const warehouse = await WarehouseModel.create({
    name: 'Main Warehouse',
    city: 'Lahore',
    cityKey: 'lahore',
    isMain: true,
    isActive: true,
  });
  warehouseId = String(warehouse._id);

  const users = await UserModel.create([
    { userID: 'A1', username: 'admin.a', phone: '03000000001', password: 'x', role: 'admin', address: { city: 'Lahore' } },
    { userID: 'A2', username: 'admin.b', phone: '03000000002', password: 'x', role: 'admin' },
    { userID: 'S1', username: 'store.one', phone: '03000000003', password: 'x', role: 'warehouse_staff', warehouseId: warehouse._id },
  ]);
  adminA = { userId: String(users[0]._id), role: 'admin' };
  adminB = { userId: String(users[1]._id), role: 'admin' };
  staff = { userId: String(users[2]._id), role: 'warehouse_staff' };

  const [a, b] = await ProductModel.create([
    { barcode: 'A', name: 'Product A', categoryId: CATEGORY, createdBy: users[0]._id, purchasePrice: 10, salePrice: 25, survivalQuantity: 20 },
    { barcode: 'B', name: 'Product B', categoryId: CATEGORY, createdBy: users[0]._id, purchasePrice: 40, salePrice: 100 },
  ]);
  productA = String(a._id);
  productB = String(b._id);

  const dealer = await DealerModel.create({ name: 'Test Shop', phone: '03111111111', address: { city: 'Lahore' } });
  dealerId = String(dealer._id);

  // -------------------------------------------------------------------------
  console.log('Opening a count');
  // -------------------------------------------------------------------------
  await resetStock(100, 50, 5);

  await test('the sheet lists every product the warehouse holds, with the system figures', async () => {
    const sheet = await counts.getCountSheet(warehouseId, staff);
    assert.equal(sheet.rows.length, 2);
    const rowA = sheet.rows.find((r) => r.productId === productA)!;
    assert.equal(rowA.systemSellable, 100);
    assert.equal(rowA.systemDamaged, 5);
  });

  await test('a new count is prefilled with the system figures, so an untouched sheet matches', async () => {
    const count = await counts.openStockCount({ warehouseId }, staff);
    assert.equal(count.status, 'draft');
    const lineA = count.lines.find((l) => String((l.productId as any)._id) === productA)!;
    assert.equal(lineA.countedSellable, 100);
    assert.equal(lineA.systemSellable, 100);
  });

  await test('a second open count for the same warehouse is refused', async () => {
    await rejectsWith(counts.openStockCount({ warehouseId }, staff), /already draft|already submitted/i);
  });

  await test('staff cannot count someone else’s warehouse', async () => {
    const other = await WarehouseModel.create({
      name: 'Other', city: 'Multan', cityKey: 'multan', isActive: true,
    });
    await rejectsWith(
      counts.openStockCount({ warehouseId: String(other._id) }, staff),
      /only count your own warehouse/i,
    );
    await WarehouseModel.findByIdAndDelete(other._id);
  });

  // -------------------------------------------------------------------------
  console.log('\nCounting and submitting');
  // -------------------------------------------------------------------------
  await test('counted figures are saved on the draft', async () => {
    const draft = await StockCountModel.findOne({ status: 'draft' });
    const saved = await counts.saveStockCountLines(
      String(draft!._id),
      [{ productId: productA, countedSellable: 96, countedDamaged: 5, note: '4 missing from bay 3' }],
      staff,
    );
    const lineA = saved.lines.find((l) => String((l.productId as any)._id) === productA)!;
    assert.equal(lineA.countedSellable, 96);
    assert.equal(lineA.note, '4 missing from bay 3');
  });

  await test('submitting re-snapshots the system figures at that moment', async () => {
    // A sale lands between opening the draft and submitting it.
    await applyStockMovements(
      [{ warehouseId, productId: productB, bucket: 'sellable', delta: -10, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminA.userId },
    );

    const draft = await StockCountModel.findOne({ status: 'draft' });
    const submitted = await counts.submitStockCount(String(draft!._id), staff);
    assert.equal(submitted.status, 'submitted');
    const lineB = submitted.lines.find((l) => String((l.productId as any)._id) === productB)!;
    assert.equal(lineB.systemSellable, 40, 'the snapshot follows the sale, not the stale draft');
  });

  await test('a submitted count can no longer be edited', async () => {
    const submitted = await StockCountModel.findOne({ status: 'submitted' });
    await rejectsWith(
      counts.saveStockCountLines(
        String(submitted!._id),
        [{ productId: productA, countedSellable: 1, countedDamaged: 0 }],
        staff,
      ),
      /only a draft can be edited/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nApproval applies a DELTA, not an overwrite');
  // -------------------------------------------------------------------------
  await test('a sale between submission and approval is NOT erased', async () => {
    // At submission: A system 100, counted 96 → a shortfall of 4.
    // Then 20 more are sold, so the live figure is 80.
    await applyStockMovements(
      [{ warehouseId, productId: productA, bucket: 'sellable', delta: -20, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminA.userId },
    );
    assert.equal((await balance(productA)).sellable, 80);

    const submitted = await StockCountModel.findOne({ status: 'submitted' });
    const { count, drift } = await counts.approveStockCount(String(submitted!._id), adminB.userId);

    assert.equal(count.status, 'approved');
    // An absolute overwrite would have set this to 96, wiping out the 20 that were sold.
    assert.equal(
      (await balance(productA)).sellable,
      76,
      'the counted shortfall of 4 applied to the LIVE figure of 80',
    );
    assert.ok(
      drift.some((d) => d.productId === productA && d.bucket === 'sellable'),
      'the drift between submission and approval is reported for review',
    );
  });

  await test('the mirror follows the count adjustment', async () => {
    assert.equal(await mirror(productA), 76);
  });

  await test('a count adjustment does NOT change the product cost', async () => {
    const p = await ProductModel.findById(productA).select('purchasePrice').lean();
    assert.equal(p?.purchasePrice, 10, 'found or lost pieces enter at the existing average');
  });

  await test('you cannot approve a count you submitted', async () => {
    await resetStock(100, 50);
    const count = await counts.openStockCount({ warehouseId }, adminA);
    await counts.saveStockCountLines(
      String(count._id),
      [{ productId: productA, countedSellable: 90, countedDamaged: 0 }],
      adminA,
    );
    await counts.submitStockCount(String(count._id), adminA);
    await rejectsWith(
      counts.approveStockCount(String(count._id), adminA.userId),
      /cannot approve a count you submitted/i,
    );
    await counts.approveStockCount(String(count._id), adminB.userId);
    assert.equal((await balance(productA)).sellable, 90);
  });

  await test('rejection changes no stock', async () => {
    await resetStock(100, 50);
    const count = await counts.openStockCount({ warehouseId }, staff);
    await counts.saveStockCountLines(
      String(count._id),
      [{ productId: productA, countedSellable: 10, countedDamaged: 0 }],
      staff,
    );
    await counts.submitStockCount(String(count._id), staff);
    await counts.rejectStockCount(String(count._id), 'Recount required', adminA.userId);
    assert.equal((await balance(productA)).sellable, 100);
  });

  await test('a partial count leaves the products it did not cover untouched', async () => {
    await resetStock(100, 50);
    const count = await counts.openStockCount({ warehouseId }, staff);
    // Only Product A is recounted; Product B keeps its prefilled system figure, so its delta is 0.
    await counts.saveStockCountLines(
      String(count._id),
      [{ productId: productA, countedSellable: 95, countedDamaged: 0 }],
      staff,
    );
    await counts.submitStockCount(String(count._id), staff);
    await counts.approveStockCount(String(count._id), adminB.userId);
    assert.equal((await balance(productA)).sellable, 95);
    assert.equal((await balance(productB)).sellable, 50, 'B was not zeroed out');
  });

  await test('an approved count cannot be cancelled — run another count instead', async () => {
    const approved = await StockCountModel.findOne({ status: 'approved' });
    await rejectsWith(
      counts.cancelStockCount(String(approved!._id), 'oops', adminA.userId),
      /run another count/i,
    );
  });

  await test('a positive adjustment adds stock without changing the cost basis', async () => {
    await resetStock(100, 50);
    const before = await ProductModel.findById(productA).select('purchasePrice').lean();
    const count = await counts.openStockCount({ warehouseId }, staff);
    await counts.saveStockCountLines(
      String(count._id),
      [{ productId: productA, countedSellable: 110, countedDamaged: 0 }],
      staff,
    );
    await counts.submitStockCount(String(count._id), staff);
    await counts.approveStockCount(String(count._id), adminB.userId);
    assert.equal((await balance(productA)).sellable, 110);
    const after = await ProductModel.findById(productA).select('purchasePrice').lean();
    assert.equal(after?.purchasePrice, before?.purchasePrice);
  });

  await test('the count report shows system, counted and difference per product', async () => {
    const rows = await counts.getStockCountReport({ warehouseId }, adminA);
    assert.ok(rows.length > 0);
    const row = rows.find((r) => r.productName === 'Product A' && r.diffSellable !== 0);
    assert.ok(row, 'expected at least one line with a difference');
  });

  // -------------------------------------------------------------------------
  console.log('\nReturns feeding warehouse stock');
  // -------------------------------------------------------------------------
  await test('a completed plain return credits SELLABLE stock', async () => {
    await resetStock(100, 50);
    await returnsService.createReturn(
      {
        dealerId,
        returnType: 'return',
        status: 'completed',
        products: [{ productId: productA, quantity: 6, price: 25 }],
      } as never,
      adminA.userId,
    );
    assert.equal((await balance(productA)).sellable, 106);
    assert.equal((await balance(productA)).damaged, 0);
  });

  await test('completing a return twice credits it only once', async () => {
    await resetStock(100, 50);
    const ret = await returnsService.createReturn(
      {
        dealerId,
        returnType: 'return',
        products: [{ productId: productA, quantity: 5, price: 25 }],
      },
      adminA.userId,
    );
    await returnsService.updateReturn(String(ret._id), { status: 'completed' }, adminA.userId);
    assert.equal((await balance(productA)).sellable, 105);

    // The service blocks editing a completed return, but the idempotency key is the real guarantee.
    await ReturnModel.updateOne({ _id: ret._id }, { $set: { status: 'picked' } });
    await returnsService.updateReturn(String(ret._id), { status: 'completed' }, adminA.userId);
    assert.equal((await balance(productA)).sellable, 105, 'no double credit');
  });

  await test('a completed damage return credits DAMAGED stock, not sellable', async () => {
    await resetStock(100, 50);
    const ret = await returnsService.createReturn(
      {
        dealerId,
        returnType: 'damage',
        returnReason: 'Seal broken in transit',
        products: [{ productId: productA, quantity: 4, price: 25 }],
      },
      adminA.userId,
    );
    await returnsService.updateReturn(String(ret._id), { status: 'completed' }, adminA.userId);
    const b = await balance(productA);
    assert.equal(b.sellable, 100, 'damaged goods never enter sellable stock');
    assert.equal(b.damaged, 4);
  });

  await test('it also mints an approved client-claim entry linked back to the return', async () => {
    const ret = await ReturnModel.findOne({ returnType: 'damage', status: 'completed' });
    const claim = await DamageClaimModel.findOne({ linkedReturnId: ret!._id }).lean();
    assert.ok(claim, 'the damage report would otherwise miss client damage entirely');
    assert.equal(claim?.source, 'client_claim');
    assert.equal(claim?.status, 'approved');
    assert.equal(claim?.clientName, 'Test Shop');
  });

  await test('that auto-created entry cannot be cancelled — it holds no stock of its own', async () => {
    // Regression: it is born `approved`, but the RETURN moved the stock, not the claim. Cancelling
    // it ran the sellable+q / damaged−q reversal anyway and invented pieces from nothing.
    const ret = await ReturnModel.findOne({ returnType: 'damage', status: 'completed' });
    const claim = await DamageClaimModel.findOne({ linkedReturnId: ret!._id }).lean();

    await rejectsWith(
      damageClaims.cancelDamageClaim(String(claim!._id), 'raised in error', adminB.userId),
      /correct the return instead/i,
    );

    const b = await balance(productA);
    assert.equal(b.sellable, 100, 'a refused cancel must not invent sellable stock');
    assert.equal(b.damaged, 4, 'and must not destroy the damaged pieces the return credited');
  });

  await test('the mirror ignores damaged stock', async () => {
    assert.equal(await mirror(productA), 100);
  });

  // -------------------------------------------------------------------------
  console.log('\nValuation and low stock');
  // -------------------------------------------------------------------------
  await test('valuation reports pieces, stock value and what it could sell for', async () => {
    await resetStock(100, 50, 4);
    const report = await getValuationReport({}, 'admin');
    assert.equal(report.summary.totalSellablePieces, 150);
    assert.equal(report.summary.totalDamagedPieces, 4);
    // A: 100 @ cost 10 = 1000; B: 50 @ 40 = 2000.
    assert.equal(report.summary.currentStockValue, 3000);
    // A: 100 @ 25 = 2500; B: 50 @ 100 = 5000.
    assert.equal(report.summary.potentialSaleValue, 7500);
  });

  await test('cost and profit columns are omitted for non-admins, not zeroed', async () => {
    const report = await getValuationReport({}, 'warehouse_staff');
    assert.equal(report.summary.currentStockValue, undefined);
    assert.equal(report.summary.grossProfitInPeriod, undefined);
    assert.equal(report.summary.potentialSaleValue, 7500, 'piece counts and sale value stay visible');
  });

  await test('low stock compares the all-warehouse total against the product level', async () => {
    // Product A has a level of 20 and 100 in stock — not low.
    assert.equal((await getLowStockProducts()).length, 0);

    await applyStockMovements(
      [{ warehouseId, productId: productA, bucket: 'sellable', delta: -85, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminA.userId },
    );
    const low = await getLowStockProducts();
    assert.equal(low.length, 1);
    assert.equal(low[0].productId, productA);
    assert.equal(low[0].total, 15);
    assert.equal(low[0].level, 20);
  });

  await test('both ledger invariants hold after every flow above', async () => {
    assert.deepEqual(await getIntegrityReport(), []);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} stock-count and returns tests passed.`);
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
