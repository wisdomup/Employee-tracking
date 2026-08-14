/**
 * The live stock matrix — the product × warehouse grid — plus the two things that had to change
 * underneath it: the `damagedQuantity` mirror, and the optimistic-concurrency guard on inline
 * corrections.
 *
 * The properties worth defending here:
 *   • a product that has never held stock anywhere STILL gets a row — that is the whole reason
 *     this endpoint exists instead of reusing the flat stock report
 *   • `isLow` follows the all-warehouse mirror, not the columns a scoped viewer can see
 *   • `damagedQuantity` mirrors damaged WITHOUT changing what `quantity` means
 *   • a stale grid can no longer silently reverse someone else's sale
 *
 * Run with: npm run test:stock-matrix
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { UserModel } from '../../models/user.model';
import { CategoryModel } from '../../models/category.model';

import * as warehousesService from './warehouses.service';
import { getStockMatrix } from './stock.service';
import { adjustStock } from './stock-adjustments.service';
import {
  applyStockMovements,
  getIntegrityReport,
  resyncMirror,
  syncProductQuantityMirror,
} from './stock-ledger.service';
import { adjustStockSchema } from './dto/warehouse.schemas';
import * as productsService from '../products/products.service';

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

let mongod: MongoMemoryServer;
let adminId: string;
let staffId: string;
let orphanStaffId: string;
let categoryId: Types.ObjectId;
let otherCategoryId: Types.ObjectId;

let mainId: string;
let lahoreId: string;
let idleId: string; // inactive
let goneId: string; // trashed

let cola: string;
let chips: string;
let juice: string;
let ghost: string; // never held stock anywhere

const ADMIN = { userId: '', role: 'admin' };
const MANAGER = { userId: '', role: 'warehouse_manager' };

function row(matrix: Awaited<ReturnType<typeof getStockMatrix>>, productId: string) {
  return matrix.products.find((p) => p.productId === productId);
}

async function seedStock(
  warehouseId: string,
  productId: string,
  sellable: number,
  damaged = 0,
) {
  const lines = [];
  if (sellable) {
    lines.push({ warehouseId, productId, bucket: 'sellable' as const, delta: sellable, type: 'opening_stock' as const, unitCost: 50 });
  }
  if (damaged) {
    lines.push({ warehouseId, productId, bucket: 'damaged' as const, delta: damaged, type: 'opening_stock' as const });
  }
  if (lines.length === 0) return;
  await applyStockMovements(lines, {
    refType: 'opening_stock',
    refId: String(new Types.ObjectId()),
    actorId: adminId,
  });
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'stock-matrix-test' });
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
  ADMIN.userId = adminId;
  MANAGER.userId = adminId;

  const category = await CategoryModel.create({ name: 'Drinks', createdBy: admin._id });
  const otherCategory = await CategoryModel.create({ name: 'Snacks', createdBy: admin._id });
  categoryId = category._id as Types.ObjectId;
  otherCategoryId = otherCategory._id as Types.ObjectId;

  // Through the service, so `cityKey` is normalised the same way the app does it.
  mainId = String((await warehousesService.createWarehouse({ name: 'Main Warehouse', city: 'Faisalabad' }, adminId))._id);
  lahoreId = String((await warehousesService.createWarehouse({ name: 'Lahore G7 Shop', city: 'Lahore' }, adminId))._id);
  idleId = String((await warehousesService.createWarehouse({ name: 'Idle Depot', city: 'Multan' }, adminId))._id);
  goneId = String((await warehousesService.createWarehouse({ name: 'Closed Depot', city: 'Sialkot' }, adminId))._id);

  await WarehouseModel.updateOne({ _id: goneId }, { $set: { isTrashed: true } });
  // Idle Depot is deactivated AFTER it is stocked, below — the ledger refuses to move stock to an
  // inactive warehouse, and a warehouse holding stock that is later deactivated is exactly the
  // case that makes hiding inactive columns wrong.

  const staff = await UserModel.create({
    userID: 'WS-1', username: 'staff.lahore', phone: '03001110002', password: 'x',
    role: 'warehouse_staff', warehouseId: new Types.ObjectId(lahoreId),
  });
  staffId = String(staff._id);

  const orphan = await UserModel.create({
    userID: 'WS-2', username: 'staff.orphan', phone: '03001110003', password: 'x',
    role: 'warehouse_staff',
  });
  orphanStaffId = String(orphan._id);

  const [c, ch, j, g] = await ProductModel.create([
    { barcode: 'COLA-1', name: 'Cola 1L', categoryId, createdBy: admin._id, salePrice: 180 },
    { barcode: 'CHIP-1', name: 'Chips Family Pack', categoryId: otherCategoryId, createdBy: admin._id, salePrice: 90, survivalQuantity: 10 },
    { barcode: 'JUCE-1', name: 'Juice 500ml', categoryId, createdBy: admin._id, salePrice: 140 },
    { barcode: 'GHOST.1+X', name: 'Ghost Product', categoryId, createdBy: admin._id, salePrice: 10 },
  ]);
  cola = String(c._id);
  chips = String(ch._id);
  juice = String(j._id);
  ghost = String(g._id);

  await seedStock(mainId, cola, 100, 4);
  await seedStock(lahoreId, cola, 40, 1);
  await seedStock(mainId, chips, 5, 100); // below its survivalQuantity of 10
  await seedStock(idleId, juice, 25, 0);
  // `ghost` deliberately gets nothing, anywhere.

  // Only now — stock cannot be moved to an inactive warehouse, but stock already there stays there.
  await WarehouseModel.updateOne({ _id: idleId }, { $set: { isActive: false } });

  // -------------------------------------------------------------------------
  console.log('The grid shape');
  // -------------------------------------------------------------------------
  await test('a product that has never held stock anywhere still gets a row of zeros', async () => {
    // The whole reason this endpoint exists rather than reusing the flat stock report: that one
    // reads the balance collection, where this product has no document at all.
    const matrix = await getStockMatrix({}, ADMIN);
    const ghostRow = row(matrix, ghost);
    assert.ok(ghostRow, 'the ghost product is present');
    assert.deepEqual(ghostRow!.cells, {}, 'no cells');
    assert.equal(ghostRow!.totalSellable, 0);
    assert.equal(ghostRow!.totalDamaged, 0);
    assert.equal(ghostRow!.totalOnHand, 0);
  });

  await test('columns are Main first then alphabetical, trashed absent, inactive present', async () => {
    const matrix = await getStockMatrix({}, ADMIN);
    const names = matrix.warehouses.map((w) => w.name);
    assert.equal(names[0], 'Main Warehouse', 'Main leads');
    assert.deepEqual(names.slice(1), ['Idle Depot', 'Lahore G7 Shop'], 'then alphabetical');
    assert.ok(!names.includes('Closed Depot'), 'a trashed warehouse is gone');

    const idle = matrix.warehouses.find((w) => w._id === idleId)!;
    // Deactivating does not empty a warehouse, so hiding the column would hide real pieces.
    assert.equal(idle.isActive, false, 'the inactive one is present and flagged');
  });

  await test('cells carry the live figures and totals add up across warehouses', async () => {
    const matrix = await getStockMatrix({}, ADMIN);
    const colaRow = row(matrix, cola)!;
    assert.deepEqual(colaRow.cells[mainId], { sellable: 100, damaged: 4 });
    assert.deepEqual(colaRow.cells[lahoreId], { sellable: 40, damaged: 1 });
    assert.equal(colaRow.totalSellable, 140);
    assert.equal(colaRow.totalDamaged, 5);
    assert.equal(colaRow.totalOnHand, 145, 'on hand is sellable + damaged');
  });

  await test('in-transit is reported but excluded from on-hand', async () => {
    await applyStockMovements(
      [{ warehouseId: mainId, productId: juice, bucket: 'in_transit', delta: 7, type: 'transfer_out' }],
      { refType: 'transfer', refId: String(new Types.ObjectId()), actorId: adminId },
    );
    const matrix = await getStockMatrix({}, ADMIN);
    const juiceRow = row(matrix, juice)!;
    assert.equal(juiceRow.cells[mainId]?.inTransit, 7);
    assert.equal(juiceRow.totalInTransit, 7);
    // Those pieces are at no warehouse — counting them as on hand would double-count a transfer.
    assert.equal(juiceRow.totalOnHand, juiceRow.totalSellable + juiceRow.totalDamaged);
    assert.ok(!('inTransit' in (matrix.products.find((p) => p.productId === cola)!.cells[lahoreId] ?? {})),
      'a zero in-transit is omitted rather than sent as 0');
  });

  await test('sparseness is not lossy — an all-zero balance row is omitted, totals still zero', async () => {
    // A real balance ROW that has been emptied, which is different from never having existed.
    const temp = await ProductModel.create({
      barcode: 'ZERO-1', name: 'Zeroed Product', categoryId, createdBy: new Types.ObjectId(adminId), salePrice: 1,
    });
    const tempId = String(temp._id);
    await seedStock(mainId, tempId, 12, 0);
    await adjustStock(
      { warehouseId: mainId, reason: 'Emptied for the test', lines: [{ productId: tempId, sellable: 0 }] },
      adminId,
    );

    const stillARow = await WarehouseStockModel.findOne({ warehouseId: mainId, productId: tempId }).lean();
    assert.ok(stillARow, 'the balance document survives at zero');

    const matrix = await getStockMatrix({}, ADMIN);
    const zeroed = row(matrix, tempId)!;
    assert.deepEqual(zeroed.cells, {}, 'but the all-zero cell is not shipped');
    assert.equal(zeroed.totalOnHand, 0, 'and the totals are still right');

    await Promise.all([
      ProductModel.deleteOne({ _id: tempId }),
      WarehouseStockModel.deleteMany({ productId: tempId }),
      StockMovementModel.deleteMany({ productId: tempId }),
    ]);
  });

  await test('an inactive warehouse keeps the stock it already held', async () => {
    const matrix = await getStockMatrix({}, ADMIN);
    const juiceRow = row(matrix, juice)!;
    // The reason inactive columns are shown rather than filtered out: these pieces are real.
    assert.equal(juiceRow.cells[idleId]?.sellable, 25);
    assert.ok(matrix.warehouses.find((w) => w._id === idleId && !w.isActive));
  });

  // -------------------------------------------------------------------------
  console.log('\nScoping, filtering and privacy');
  // -------------------------------------------------------------------------
  await test('isLow follows the ALL-warehouse mirror, not the visible columns', async () => {
    // Chips: 5 sellable at Main, nothing at Lahore, survivalQuantity 10. A Lahore-scoped viewer
    // sees a column of zeros — but the low-stock level is a company-wide threshold.
    const scoped = await getStockMatrix({}, { userId: staffId, role: 'warehouse_staff' });
    const chipsRow = row(scoped, chips)!;
    assert.equal(chipsRow.totalSellable, 0, 'nothing in the column they can see');
    assert.equal(chipsRow.isLow, true, 'still flagged low, from the mirror');
  });

  await test('warehouse staff get exactly one column and scopedWarehouseId is set', async () => {
    const scoped = await getStockMatrix({}, { userId: staffId, role: 'warehouse_staff' });
    assert.equal(scoped.warehouses.length, 1);
    assert.equal(scoped.warehouses[0]._id, lahoreId);
    assert.equal(scoped.scopedWarehouseId, lahoreId);
  });

  await test('warehouse staff with no warehouse are refused, not shown everything', async () => {
    await rejectsWith(
      getStockMatrix({}, { userId: orphanStaffId, role: 'warehouse_staff' }),
      /not assigned to a warehouse/i,
    );
  });

  await test('avgCost is admin-only', async () => {
    const asAdmin = await getStockMatrix({}, ADMIN);
    assert.equal(typeof row(asAdmin, cola)!.avgCost, 'number');

    const asManager = await getStockMatrix({}, { userId: adminId, role: 'warehouse_manager' });
    assert.equal(row(asManager, cola)!.avgCost, undefined);

    const asSales = await getStockMatrix({}, { userId: adminId, role: 'sales_manager' });
    assert.equal(row(asSales, cola)!.avgCost, undefined);
  });

  await test('search, category, lowOnly and nonZeroOnly narrow the rows', async () => {
    const searched = await getStockMatrix({ search: 'cola' }, ADMIN);
    assert.deepEqual(searched.products.map((p) => p.name), ['Cola 1L']);

    const byCategory = await getStockMatrix({ categoryId: String(otherCategoryId) }, ADMIN);
    assert.deepEqual(byCategory.products.map((p) => p.name), ['Chips Family Pack']);

    const low = await getStockMatrix({ lowOnly: 'true' }, ADMIN);
    assert.deepEqual(low.products.map((p) => p.name), ['Chips Family Pack']);

    const nonZero = await getStockMatrix({ nonZeroOnly: 'true' }, ADMIN);
    assert.ok(!nonZero.products.some((p) => p.productId === ghost), 'the empty product drops out');
    assert.ok(nonZero.products.some((p) => p.productId === cola));
  });

  await test('a regex metacharacter in search is matched literally', async () => {
    // 'GHOST.1+X' — an unescaped `.` and `+` would either match nothing or match too much.
    const matrix = await getStockMatrix({ search: 'GHOST.1+X' }, ADMIN);
    assert.deepEqual(matrix.products.map((p) => p.name), ['Ghost Product']);
  });

  await test('truncated flips only when the limit actually bites', async () => {
    const full = await getStockMatrix({}, ADMIN);
    assert.equal(full.truncated, false);

    const cut = await getStockMatrix({ limit: '2' }, ADMIN);
    assert.equal(cut.products.length, 2);
    assert.equal(cut.truncated, true);
  });

  await test('a trashed product leaves the grid even though its balances survive', async () => {
    await ProductModel.updateOne({ _id: juice }, { $set: { isTrashed: true } });
    const matrix = await getStockMatrix({}, ADMIN);
    assert.ok(!matrix.products.some((p) => p.productId === juice));
    const stillThere = await WarehouseStockModel.findOne({ productId: juice }).lean();
    assert.ok(stillThere, 'the balance row survives, so restoring the product restores its stock');
    await ProductModel.updateOne({ _id: juice }, { $set: { isTrashed: false } });
  });

  // -------------------------------------------------------------------------
  console.log('\nThe damagedQuantity mirror');
  // -------------------------------------------------------------------------
  await test('damagedQuantity mirrors damaged while quantity still means sellable', async () => {
    const doc = await ProductModel.findById(cola).select('quantity damagedQuantity').lean();
    assert.equal(doc?.quantity, 140, 'sellable across both warehouses');
    assert.equal(doc?.damagedQuantity, 5, 'damaged across both warehouses');
  });

  await test('re-running the sync is idempotent (absolute $set, never $inc)', async () => {
    await syncProductQuantityMirror([cola]);
    await syncProductQuantityMirror([cola]);
    const doc = await ProductModel.findById(cola).select('quantity damagedQuantity').lean();
    assert.equal(doc?.quantity, 140);
    assert.equal(doc?.damagedQuantity, 5);
  });

  await test('both mirrors reset to zero when the last balance row goes', async () => {
    const temp = await ProductModel.create({
      barcode: 'TMP-1', name: 'Temp Product', categoryId, createdBy: new Types.ObjectId(adminId), salePrice: 1,
    });
    const tempId = String(temp._id);
    await seedStock(mainId, tempId, 9, 3);
    assert.equal((await ProductModel.findById(tempId).lean())?.damagedQuantity, 3);

    await WarehouseStockModel.deleteMany({ productId: tempId });
    await syncProductQuantityMirror([tempId]);

    const after = await ProductModel.findById(tempId).select('quantity damagedQuantity').lean();
    assert.equal(after?.quantity, 0);
    assert.equal(after?.damagedQuantity, 0, 'a stale damaged mirror would silently inflate on-hand');

    // The movements must go too, not just the product: `getIntegrityReport`'s equality B compares
    // the ledger against the balances, and orphaned movements with no balance row read as drift.
    await Promise.all([
      ProductModel.deleteOne({ _id: tempId }),
      StockMovementModel.deleteMany({ productId: tempId }),
    ]);
  });

  await test('the integrity report names WHICH mirror drifted, and resync repairs it', async () => {
    assert.deepEqual(await getIntegrityReport(), [], 'clean to begin with');

    // Corrupt only the damaged mirror.
    await ProductModel.updateOne({ _id: cola }, { $set: { damagedQuantity: 999 } });
    const drifted = await getIntegrityReport();
    const mirrorRows = drifted.filter((r) => r.kind === 'mirror_drift');
    assert.equal(mirrorRows.length, 1, 'only the damaged mirror is reported');
    assert.equal(mirrorRows[0].field, 'damagedQuantity');
    assert.equal(mirrorRows[0].expected, 5);
    assert.equal(mirrorRows[0].actual, 999);

    await resyncMirror([cola]);
    assert.deepEqual(await getIntegrityReport(), [], 'repaired');
  });

  await test('the two mirrors are reported independently', async () => {
    await ProductModel.updateOne({ _id: cola }, { $set: { quantity: 1, damagedQuantity: 2 } });
    const rows = (await getIntegrityReport()).filter((r) => r.kind === 'mirror_drift');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.field).sort(), ['damagedQuantity', 'quantity']);
    await resyncMirror([cola]);
    assert.deepEqual(await getIntegrityReport(), []);
  });

  await test('updateProduct ignores a client-sent damagedQuantity', async () => {
    // The exact drift path the `delete data.quantity` line exists to close: the edit form
    // re-sends what it read at page load.
    await productsService.updateProduct(
      cola,
      { name: 'Cola 1L', quantity: 1, damagedQuantity: 777 } as never,
      adminId,
    );
    const doc = await ProductModel.findById(cola).select('quantity damagedQuantity').lean();
    assert.equal(doc?.quantity, 140, 'sellable mirror untouched');
    assert.equal(doc?.damagedQuantity, 5, 'damaged mirror untouched');
  });

  // -------------------------------------------------------------------------
  console.log('\nOptimistic concurrency — a stale grid must not reverse a sale');
  // -------------------------------------------------------------------------
  await test('an expectation that matches applies exactly as before', async () => {
    const before = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())!;
    const result = await adjustStock(
      {
        warehouseId: mainId,
        reason: 'Recount',
        lines: [{ productId: cola, sellable: before.sellable + 5, expectedSellable: before.sellable }],
      },
      adminId,
    );
    assert.equal(result.changes[0].delta, 5);
    const after = await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean();
    assert.equal(after?.sellable, before.sellable + 5);
  });

  await test('a stale expectation is REFUSED and nothing at all is written', async () => {
    const before = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())!;
    const movementsBefore = await StockMovementModel.countDocuments({});

    await rejectsWith(
      adjustStock(
        {
          warehouseId: mainId,
          reason: 'Recount from a stale screen',
          // Claims it saw 999; the warehouse holds something else entirely.
          lines: [{ productId: cola, sellable: 1000, expectedSellable: 999 }],
        },
        adminId,
      ),
      /stock moved while you were editing/i,
    );

    const after = await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean();
    assert.equal(after?.sellable, before.sellable, 'the balance is untouched');
    assert.equal(await StockMovementModel.countDocuments({}), movementsBefore, 'no ledger row written');
  });

  await test('the refusal names the product and the figure it actually holds', async () => {
    const current = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())!;
    await rejectsWith(
      adjustStock(
        { warehouseId: mainId, reason: 'stale', lines: [{ productId: cola, sellable: 1, expectedSellable: 42 }] },
        adminId,
      ),
      new RegExp(`Cola 1L.*sellable.*42.*${current.sellable}`),
    );
  });

  await test('a sale between load and save can no longer be silently reversed', async () => {
    // The scenario the guard exists for, end to end.
    const seen = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())!.sellable;

    // …someone sells 10 while the grid sits open…
    await applyStockMovements(
      [{ warehouseId: mainId, productId: cola, bucket: 'sellable', delta: -10, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminId },
    );

    // …and the operator saves the figure they were shown, plus their own correction.
    await rejectsWith(
      adjustStock(
        { warehouseId: mainId, reason: 'Recount', lines: [{ productId: cola, sellable: seen + 5, expectedSellable: seen }] },
        adminId,
      ),
      /stock moved while you were editing/i,
    );

    const after = await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean();
    assert.equal(after?.sellable, seen - 10, 'the sale survived');
  });

  await test('one conflicting line abandons the whole warehouse, not just that line', async () => {
    const colaBefore = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())!;
    const chipsBefore = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: chips }).lean())!;

    await rejectsWith(
      adjustStock(
        {
          warehouseId: mainId,
          reason: 'mixed batch',
          lines: [
            { productId: chips, sellable: chipsBefore.sellable + 1, expectedSellable: chipsBefore.sellable }, // fine
            { productId: cola, sellable: 1, expectedSellable: 99999 },                                        // stale
          ],
        },
        adminId,
      ),
      /stock moved while you were editing/i,
    );

    assert.equal(
      (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: chips }).lean())?.sellable,
      chipsBefore.sellable,
      'the good line did not land either — the call is all-or-nothing',
    );
    assert.equal(
      (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())?.sellable,
      colaBefore.sellable,
    );
  });

  await test('a conflict reports as a conflict, never as "nothing to change"', async () => {
    const current = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())!;
    // Every line is both stale AND a no-op against the stored figure — the ordering of the two
    // throws is what decides which message the operator sees.
    await rejectsWith(
      adjustStock(
        { warehouseId: mainId, reason: 'stale no-op', lines: [{ productId: cola, sellable: current.sellable, expectedSellable: 123456 }] },
        adminId,
      ),
      /stock moved while you were editing/i,
    );
  });

  await test('omitting the expectations behaves exactly as it always has', async () => {
    // The back-compat guarantee for the per-warehouse adjust screen, which sends nothing.
    const before = (await WarehouseStockModel.findOne({ warehouseId: mainId, productId: cola }).lean())!;
    const result = await adjustStock(
      { warehouseId: mainId, reason: 'No expectations sent', lines: [{ productId: cola, sellable: before.sellable + 3 }] },
      adminId,
    );
    assert.equal(result.changes[0].delta, 3);
  });

  // -------------------------------------------------------------------------
  console.log('\nThe adjust schema stays strict');
  // -------------------------------------------------------------------------
  await test('an expectation without the bucket it guards is rejected', async () => {
    const { error } = adjustStockSchema.validate({
      warehouseId: mainId,
      reason: 'valid reason',
      lines: [{ productId: cola, damaged: 1, expectedSellable: 5 }],
    });
    assert.ok(error, 'expectedSellable without sellable means nothing');
  });

  await test('the reason is still mandatory and still has a minimum length', async () => {
    // The promise made when adding the optional fields: nothing existing was relaxed.
    assert.ok(adjustStockSchema.validate({
      warehouseId: mainId, lines: [{ productId: cola, sellable: 1 }],
    }).error, 'missing reason');

    assert.ok(adjustStockSchema.validate({
      warehouseId: mainId, reason: 'x', lines: [{ productId: cola, sellable: 1 }],
    }).error, 'one-character reason');
  });

  await test('a valid payload carrying the expectations passes the schema', async () => {
    const { error } = adjustStockSchema.validate({
      warehouseId: mainId,
      reason: 'Inline correction from the stock matrix',
      lines: [{ productId: cola, sellable: 10, expectedSellable: 5, damaged: 2, expectedDamaged: 1 }],
    });
    assert.equal(error, undefined);
  });

  // -------------------------------------------------------------------------
  console.log('\nEnd state');
  // -------------------------------------------------------------------------
  await test('the ledger and both mirrors are still consistent after all of it', async () => {
    assert.deepEqual(await getIntegrityReport(), []);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} stock-matrix tests passed.`);
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
