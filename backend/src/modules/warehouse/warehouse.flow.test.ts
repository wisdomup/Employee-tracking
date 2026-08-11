/**
 * Phase 1 warehouse flows end to end: Stock In, opening stock, receipt cancellation, and the
 * guards that stop the products form from overwriting the derived stock mirror.
 *
 * Run with: npm run test:warehouse-flow
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { OpeningStockModel } from '../../models/opening-stock.model';
import { UserModel } from '../../models/user.model';
import '../../models/category.model';

import * as warehousesService from './warehouses.service';
import * as receiptsService from './stock-receipts.service';
import * as openingService from './opening-stock.service';
import * as stockService from './stock.service';
import { applyStockMovements, getIntegrityReport } from './stock-ledger.service';
import * as productsService from '../products/products.service';
import { createProductSchema, updateProductSchema } from '../products/dto/products.schemas';

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
let mainId: string;
let lahoreId: string;
let productA: string;
let productB: string;

async function balance(warehouseId: string, productId: string) {
  const doc = await WarehouseStockModel.findOne({ warehouseId, productId }).lean();
  return {
    sellable: doc?.sellable ?? 0,
    damaged: doc?.damaged ?? 0,
    inTransit: doc?.inTransit ?? 0,
  };
}

async function costOf(productId: string) {
  const p = await ProductModel.findById(productId).select('purchasePrice lastPurchaseRate quantity').lean();
  return {
    avg: p?.purchasePrice ?? 0,
    last: p?.lastPurchaseRate ?? 0,
    mirror: p?.quantity ?? 0,
  };
}

async function resetStockState() {
  await Promise.all([
    WarehouseStockModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
    StockReceiptModel.deleteMany({}),
    OpeningStockModel.deleteMany({}),
  ]);
  await ProductModel.updateMany({}, { $unset: { purchasePrice: '', lastPurchaseRate: '' }, $set: { quantity: 0 } });
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'warehouse-flow-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
    OpeningStockModel.syncIndexes(),
    StockReceiptModel.syncIndexes(),
  ]);

  const admin = await UserModel.create({
    userID: 'ADM-1', username: 'admin.one', phone: '03001110001', password: 'x', role: 'admin',
  });
  adminId = String(admin._id);

  const [a, b] = await ProductModel.create([
    { barcode: 'A-1', name: 'Product A', categoryId: CATEGORY, createdBy: admin._id, salePrice: 100, survivalQuantity: 20 },
    { barcode: 'B-1', name: 'Product B', categoryId: CATEGORY, createdBy: admin._id, salePrice: 250 },
  ]);
  productA = String(a._id);
  productB = String(b._id);

  // -------------------------------------------------------------------------
  console.log('Warehouse master data');
  // -------------------------------------------------------------------------
  await test('the FIRST warehouse becomes Main automatically — nothing can receive stock otherwise', async () => {
    const created = await warehousesService.createWarehouse(
      { name: 'Main Warehouse', city: 'Faisalabad', address: 'Site A' },
      adminId,
    );
    mainId = String(created._id);
    assert.equal(created.isMain, true);
  });

  await test('a second warehouse is not Main', async () => {
    const created = await warehousesService.createWarehouse(
      { name: 'Lahore Warehouse', city: 'Lahore' },
      adminId,
    );
    lahoreId = String(created._id);
    assert.equal(created.isMain, false);
  });

  await test('the city is normalised into cityKey for sale routing', async () => {
    const created = await warehousesService.createWarehouse(
      { name: 'Gujranwala Warehouse', city: '  GUJRANWALA ' },
      adminId,
    );
    const doc = await WarehouseModel.findById(created._id).lean();
    assert.equal(doc?.cityKey, 'gujranwala');
    assert.equal(doc?.city, 'GUJRANWALA');
    await WarehouseModel.findByIdAndDelete(created._id);
  });

  await test('a duplicate warehouse name is refused, case-insensitively', async () => {
    await rejectsWith(
      warehousesService.createWarehouse({ name: 'lahore warehouse', city: 'Lahore' }, adminId),
      /already exists/i,
    );
  });

  await test('moving the Main flag clears it from the previous holder', async () => {
    await warehousesService.setMainWarehouse(lahoreId, adminId);
    assert.equal((await WarehouseModel.findById(lahoreId).lean())?.isMain, true);
    assert.equal((await WarehouseModel.findById(mainId).lean())?.isMain, false);
    // Only ever one Main — the unique partial index would reject a second.
    assert.equal(await WarehouseModel.countDocuments({ isMain: true }), 1);
    await warehousesService.setMainWarehouse(mainId, adminId);
  });

  await test('the Main warehouse cannot be trashed or deactivated', async () => {
    await rejectsWith(warehousesService.trashWarehouse(mainId, adminId), /cannot be deleted/i);
    await rejectsWith(
      warehousesService.updateWarehouse(mainId, { isActive: false }, adminId),
      /cannot be deactivated/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nStock In');
  // -------------------------------------------------------------------------
  await resetStockState();

  await test('a receipt lands in Main even when another warehouse is posted', async () => {
    const receipt = await receiptsService.createStockReceipt(
      {
        receiptDate: new Date('2026-08-01'),
        supplierName: 'Acme Traders',
        // A client sending this must not be able to redirect the receipt.
        warehouseId: lahoreId,
        products: [{ productId: productA, quantity: 100, rate: 10 }],
      } as never,
      adminId,
    );
    assert.equal(String((receipt.warehouseId as unknown as { _id: unknown })._id), mainId);
    assert.equal((await balance(mainId, productA)).sellable, 100);
    assert.equal((await balance(lahoreId, productA)).sellable, 0);
  });

  await test('the receipt gets a printable document number and server-computed totals', async () => {
    const receipt = await StockReceiptModel.findOne({}).lean();
    assert.equal(receipt?.documentNo, 1);
    assert.equal(receipt?.totalPieces, 100);
    assert.equal(receipt?.totalAmount, 1000);
    assert.equal(receipt?.status, 'posted');
  });

  await test('the first receipt sets the average cost and the last purchase rate', async () => {
    const cost = await costOf(productA);
    assert.equal(cost.avg, 10);
    assert.equal(cost.last, 10);
  });

  await test('a second receipt at a different rate moves the average, not just the last rate', async () => {
    await receiptsService.createStockReceipt(
      {
        receiptDate: new Date('2026-08-02'),
        products: [{ productId: productA, quantity: 100, rate: 20 }],
      },
      adminId,
    );
    const cost = await costOf(productA);
    assert.equal(cost.avg, 15, '100@10 + 100@20 must average to 15');
    assert.equal(cost.last, 20);
    assert.equal((await balance(mainId, productA)).sellable, 200);
  });

  await test('the mirror follows the receipts, so the old products list still shows the right number', async () => {
    assert.equal((await costOf(productA)).mirror, 200);
  });

  await test('the same product twice on one receipt is refused rather than silently merged', async () => {
    await rejectsWith(
      receiptsService.createStockReceipt(
        {
          receiptDate: new Date('2026-08-03'),
          products: [
            { productId: productB, quantity: 5, rate: 10 },
            { productId: productB, quantity: 7, rate: 12 },
          ],
        },
        adminId,
      ),
      /more than one line/i,
    );
  });

  await test('a receipt for a missing product writes nothing', async () => {
    const before = await StockReceiptModel.countDocuments({});
    await rejectsWith(
      receiptsService.createStockReceipt(
        {
          receiptDate: new Date('2026-08-03'),
          products: [{ productId: String(new Types.ObjectId()), quantity: 5, rate: 10 }],
        },
        adminId,
      ),
      /could not be found/i,
    );
    assert.equal(await StockReceiptModel.countDocuments({}), before);
  });

  await test('the last purchase rate lookup reports the rate, date and supplier', async () => {
    const info = await stockService.getLastPurchaseRate(productA, 'admin');
    assert.equal(info.lastPurchaseRate, 20);
    assert.equal(info.lastReceiptDate?.toISOString().slice(0, 10), '2026-08-02');
    assert.equal(info.avgCost, 15);
  });

  await test('the running average is admin-only in that lookup', async () => {
    const info = await stockService.getLastPurchaseRate(productA, 'warehouse_staff');
    // Staff enter rates, so they see the last rate; the company cost basis stays hidden.
    assert.equal(info.lastPurchaseRate, 20);
    assert.equal('avgCost' in info, false);
  });

  // -------------------------------------------------------------------------
  console.log('\nCancelling a receipt');
  // -------------------------------------------------------------------------
  await test('cancelling reverses the stock and records who and why', async () => {
    const receipt = await StockReceiptModel.findOne({ documentNo: 2 }).lean();
    await receiptsService.cancelStockReceipt(String(receipt!._id), 'Wrong supplier invoice', adminId);
    assert.equal((await balance(mainId, productA)).sellable, 100);
    const after = await StockReceiptModel.findById(receipt!._id).lean();
    assert.equal(after?.status, 'cancelled');
    assert.equal(after?.cancelReason, 'Wrong supplier invoice');
    assert.equal(String(after?.cancelledBy), adminId);
  });

  await test('cancelling drops that receipt out of the weighted average cost', async () => {
    // Regression: the reversal carries no rate of its own (it cannot — only receipts may), and no
    // caller was setting `reversalOf`, so a cancelled receipt kept weighting the average for ever.
    // 100@10 and 100@20 averaged to 15; with the 20 cancelled, only the 10 receipt is live.
    const cost = await costOf(productA);
    assert.equal(cost.avg, 10, 'a cancelled receipt must stop weighting the average');
    assert.equal(cost.last, 10, 'the last purchase rate follows the newest LIVE receipt');
  });

  await test('the cancelled receipt is still there — nothing is ever deleted', async () => {
    assert.equal(await StockReceiptModel.countDocuments({ documentNo: 2 }), 1);
  });

  await test('cancelling twice is refused', async () => {
    const receipt = await StockReceiptModel.findOne({ documentNo: 2 }).lean();
    await rejectsWith(
      receiptsService.cancelStockReceipt(String(receipt!._id), 'again', adminId),
      /already been cancelled/i,
    );
  });

  await test('a cancel is refused once the pieces have already left the warehouse', async () => {
    // Sell everything, then try to cancel the receipt that brought it in.
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productA, bucket: 'sellable', delta: -100, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminId },
    );
    const receipt = await StockReceiptModel.findOne({ documentNo: 1 }).lean();
    await rejectsWith(
      receiptsService.cancelStockReceipt(String(receipt!._id), 'too late', adminId),
      /insufficient sellable stock/i,
    );
    assert.equal((await balance(mainId, productA)).sellable, 0, 'a refused cancel moves nothing');
    assert.equal((await StockReceiptModel.findById(receipt!._id).lean())?.status, 'posted');
  });

  // -------------------------------------------------------------------------
  console.log('\nEditing and deleting a receipt (admin correction path)');
  // -------------------------------------------------------------------------
  await resetStockState();

  // The document series is global and never rewinds, so the number under test is whatever this
  // receipt was issued — the point is that an edit does not change it.
  let editDocNo: number | undefined;
  let editReceiptId = "";

  await test('editing a receipt re-posts the stock at the corrected quantity', async () => {
    const receipt = await receiptsService.createStockReceipt(
      {
        receiptDate: new Date('2026-09-01'),
        supplierName: 'Acme Traders',
        products: [{ productId: productA, quantity: 100, rate: 10 }],
      },
      adminId,
    );
    editDocNo = (receipt as unknown as { documentNo?: number }).documentNo;
    editReceiptId = String((receipt as unknown as { _id: unknown })._id);
    assert.ok(editDocNo, 'the receipt was issued a document number');
    assert.equal((await balance(mainId, productA)).sellable, 100);

    await receiptsService.updateStockReceipt(
      String((receipt as unknown as { _id: unknown })._id),
      {
        receiptDate: new Date('2026-09-01'),
        supplierName: 'Acme Traders',
        reason: 'Counted 120 pieces, invoice said 100',
        products: [{ productId: productA, quantity: 120, rate: 10 }],
      },
      adminId,
    );
    assert.equal((await balance(mainId, productA)).sellable, 120);
  });

  await test('a corrected RATE replaces the old one in the weighted average', async () => {
    // The reason this is a reverse-and-repost rather than a quantity diff: a diff would leave the
    // original row weighting the average at the wrong rate for ever.
    const receipt = await StockReceiptModel.findById(editReceiptId).lean();
    await receiptsService.updateStockReceipt(
      editReceiptId,
      {
        receiptDate: new Date('2026-09-01'),
        reason: 'Rate was 25, not 10',
        products: [{ productId: productA, quantity: 120, rate: 25 }],
      },
      adminId,
    );
    const cost = await costOf(productA);
    assert.equal(cost.avg, 25, 'the old rate must not survive the edit');
    assert.equal(cost.last, 25);
    assert.equal((await balance(mainId, productA)).sellable, 120, 'quantity unchanged');
  });

  await test('the document number and the totals survive the edit', async () => {
    const receipt = await StockReceiptModel.findById(editReceiptId).lean();
    assert.equal(receipt?.documentNo, editDocNo, 'a correction is not a new document');
    assert.equal(receipt?.totalPieces, 120);
    assert.equal(receipt?.totalAmount, 3000, '120 × 25');
    assert.equal(receipt?.editCount, 2);
    assert.equal(receipt?.editReason, 'Rate was 25, not 10');
    assert.equal(String(receipt?.lastEditedBy), adminId);
  });

  await test('a product can be swapped out entirely, moving stock on both', async () => {
    const receipt = await StockReceiptModel.findById(editReceiptId).lean();
    await receiptsService.updateStockReceipt(
      editReceiptId,
      {
        receiptDate: new Date('2026-09-01'),
        reason: 'Wrong product picked',
        products: [{ productId: productB, quantity: 40, rate: 5 }],
      },
      adminId,
    );
    assert.equal((await balance(mainId, productA)).sellable, 0, 'the wrong product gives it all back');
    assert.equal((await balance(mainId, productB)).sellable, 40);
  });

  await test('an edit is refused once the pieces have already left the warehouse', async () => {
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productB, bucket: 'sellable', delta: -40, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminId },
    );
    const receipt = await StockReceiptModel.findById(editReceiptId).lean();
    await rejectsWith(
      receiptsService.updateStockReceipt(
        String(receipt!._id),
        {
          receiptDate: new Date('2026-09-01'),
          reason: 'too late',
          products: [{ productId: productB, quantity: 10, rate: 5 }],
        },
        adminId,
      ),
      /insufficient sellable stock/i,
    );
    const after = await StockReceiptModel.findById(receipt!._id).lean();
    assert.equal(after?.products[0].quantity, 40, 'a refused edit changes nothing');
    assert.equal(after?.editCount, 3);
  });

  await test('an edit that fails half-way puts the original stock back', async () => {
    await resetStockState();
    const receipt = await receiptsService.createStockReceipt(
      { receiptDate: new Date('2026-09-20'), products: [{ productId: productA, quantity: 50, rate: 7 }] },
      adminId,
    );
    editReceiptId = String((receipt as unknown as { _id: unknown })._id);

    // A fractional quantity clears the service's own checks (they only cover product existence
    // and duplicates) and blows up inside the ledger — after the reversal has already landed.
    await rejectsWith(
      receiptsService.updateStockReceipt(
        editReceiptId,
        {
          receiptDate: new Date('2026-09-20'),
          reason: 'fat finger',
          products: [{ productId: productA, quantity: 12.5, rate: 7 }],
        },
        adminId,
      ),
      /whole pieces/i,
    );
    assert.equal((await balance(mainId, productA)).sellable, 50, 'the original 50 are back');
    const after = await StockReceiptModel.findById(editReceiptId).lean();
    assert.equal(after?.products[0].quantity, 50, 'the lines are untouched');
    assert.ok(after?.lastEditFailedAt, 'the rolled-back attempt is recorded');
  });

  await test('retrying after a rolled-back edit applies once, not twice', async () => {
    // Regression: the idempotency scope is derived from the receipt's `updatedAt`. A rolled-back
    // attempt saved nothing, so the retry reused the same scope — the reversal was then seen as a
    // replay and moved no stock, while the re-apply added its pieces on top of the restored ones.
    // 50 restored + 80 applied = 130 instead of 80.
    await receiptsService.updateStockReceipt(
      editReceiptId,
      {
        receiptDate: new Date('2026-09-20'),
        reason: 'retry with a whole number',
        products: [{ productId: productA, quantity: 80, rate: 7 }],
      },
      adminId,
    );
    assert.equal((await balance(mainId, productA)).sellable, 80, 'exactly the corrected quantity');
    assert.equal((await costOf(productA)).mirror, 80, 'and the mirror agrees');
  });

  await test('a genuine replay of the SAME edit still applies only once', async () => {
    // The other side of the coin: burning the stamp on failure must not weaken replay
    // protection for a double-submitted successful edit.
    const receiptDoc = await StockReceiptModel.findById(editReceiptId).lean();
    const payload = {
      receiptDate: new Date('2026-09-20'),
      reason: 'double click',
      products: [{ productId: productA, quantity: 65, rate: 7 }],
    };
    await receiptsService.updateStockReceipt(editReceiptId, payload, adminId);
    assert.equal((await balance(mainId, productA)).sellable, 65);

    // Replay the request exactly as the first one saw the document — same pre-edit `updatedAt`,
    // so the same idempotency scope, which is what a retried HTTP request produces.
    await StockReceiptModel.updateOne(
      { _id: editReceiptId },
      { $set: { updatedAt: receiptDoc!.updatedAt } },
      { timestamps: false },
    );
    await receiptsService.updateStockReceipt(editReceiptId, payload, adminId);
    assert.equal((await balance(mainId, productA)).sellable, 65, 'a replay must not move stock again');
  });

  await test('a cancelled receipt cannot be edited', async () => {
    await resetStockState();
    const receipt = await receiptsService.createStockReceipt(
      {
        receiptDate: new Date('2026-09-05'),
        products: [{ productId: productA, quantity: 10, rate: 4 }],
      },
      adminId,
    );
    const receiptId = String((receipt as unknown as { _id: unknown })._id);
    await receiptsService.cancelStockReceipt(receiptId, 'wrong', adminId);
    await rejectsWith(
      receiptsService.updateStockReceipt(
        receiptId,
        {
          receiptDate: new Date('2026-09-05'),
          reason: 'fix it',
          products: [{ productId: productA, quantity: 12, rate: 4 }],
        },
        adminId,
      ),
      /cancelled receipt cannot be edited/i,
    );
  });

  await test('deleting a receipt reverses its stock and hides the row', async () => {
    await resetStockState();
    const receipt = await receiptsService.createStockReceipt(
      {
        receiptDate: new Date('2026-09-10'),
        products: [{ productId: productA, quantity: 60, rate: 8 }],
      },
      adminId,
    );
    const receiptId = String((receipt as unknown as { _id: unknown })._id);
    assert.equal((await balance(mainId, productA)).sellable, 60);

    await receiptsService.deleteStockReceipt(receiptId, 'Duplicate entry', adminId);

    assert.equal((await balance(mainId, productA)).sellable, 0);
    const rows = await receiptsService.findAllStockReceipts({}, { userId: adminId, role: 'admin' });
    assert.equal(
      rows.some((r) => String(r._id) === receiptId),
      false,
      'a deleted receipt is gone from the list',
    );
  });

  await test('the deleted row survives underneath, so the ledger still points somewhere', async () => {
    // A hard delete would leave every StockMovement referencing a document that no longer exists.
    const trashed = await StockReceiptModel.findOne({ isTrashed: true }).lean();
    assert.ok(trashed, 'the row is trashed, not dropped');
    assert.equal(trashed?.status, 'cancelled');
    assert.equal(trashed?.cancelReason, 'Duplicate entry');
    assert.equal(String(trashed?.trashedBy), adminId);
  });

  await test('deleting drops the receipt out of the weighted average cost', async () => {
    await resetStockState();
    await receiptsService.createStockReceipt(
      { receiptDate: new Date('2026-09-11'), products: [{ productId: productA, quantity: 10, rate: 10 }] },
      adminId,
    );
    const second = await receiptsService.createStockReceipt(
      { receiptDate: new Date('2026-09-12'), products: [{ productId: productA, quantity: 10, rate: 30 }] },
      adminId,
    );
    assert.equal((await costOf(productA)).avg, 20, '10@10 + 10@30 averages to 20');

    await receiptsService.deleteStockReceipt(
      String((second as unknown as { _id: unknown })._id),
      'keyed twice',
      adminId,
    );
    assert.equal((await costOf(productA)).avg, 10, 'only the surviving receipt weighs the average');
  });

  await test('a delete is refused once the pieces have already left the warehouse', async () => {
    await resetStockState();
    const receipt = await receiptsService.createStockReceipt(
      { receiptDate: new Date('2026-09-15'), products: [{ productId: productA, quantity: 20, rate: 6 }] },
      adminId,
    );
    const receiptId = String((receipt as unknown as { _id: unknown })._id);
    await applyStockMovements(
      [{ warehouseId: mainId, productId: productA, bucket: 'sellable', delta: -20, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminId },
    );
    await rejectsWith(
      receiptsService.deleteStockReceipt(receiptId, 'too late', adminId),
      /insufficient sellable stock/i,
    );
    const after = await StockReceiptModel.findById(receiptId).lean();
    assert.equal(after?.isTrashed ?? false, false, 'a refused delete leaves the row alone');
  });

  // -------------------------------------------------------------------------
  console.log('\nOpening stock (one-time)');
  // -------------------------------------------------------------------------
  await resetStockState();

  await test('opening stock posts sellable and damaged separately, at a rate', async () => {
    await openingService.postOpeningStock(
      {
        warehouseId: lahoreId,
        lines: [{ productId: productA, sellableQty: 60, damagedQty: 5, rate: 30 }],
      },
      adminId,
    );
    const b = await balance(lahoreId, productA);
    assert.equal(b.sellable, 60);
    assert.equal(b.damaged, 5);
  });

  await test('the opening rate seeds the average cost over BOTH buckets — it is stock you paid for', async () => {
    // 65 pieces at 30 → average 30.
    assert.equal((await costOf(productA)).avg, 30);
  });

  await test('the mirror counts only the sellable pieces', async () => {
    assert.equal((await costOf(productA)).mirror, 60);
  });

  await test('a second posting for the same warehouse+product is refused, naming the product', async () => {
    await rejectsWith(
      openingService.postOpeningStock(
        { warehouseId: lahoreId, lines: [{ productId: productA, sellableQty: 10 }] },
        adminId,
      ),
      /already been entered.*Product A/is,
    );
  });

  await test('the same product at a DIFFERENT warehouse is fine', async () => {
    await openingService.postOpeningStock(
      { warehouseId: mainId, lines: [{ productId: productA, sellableQty: 15, rate: 30 }] },
      adminId,
    );
    assert.equal((await balance(mainId, productA)).sellable, 15);
    assert.equal((await costOf(productA)).mirror, 75);
  });

  await test('the status endpoint reports the lock and which products are covered', async () => {
    const status = await openingService.getOpeningStockStatus(lahoreId);
    assert.equal(status.locked, true);
    assert.deepEqual(status.postedProductIds, [productA]);
  });

  await test('all-zero lines are refused rather than posting an empty document', async () => {
    await rejectsWith(
      openingService.postOpeningStock(
        { warehouseId: lahoreId, lines: [{ productId: productB, sellableQty: 0, damagedQty: 0 }] },
        adminId,
      ),
      /at least one product/i,
    );
  });

  await test('cancelling an opening entry reverses the stock and frees the one-time slot', async () => {
    const entry = await OpeningStockModel.findOne({ warehouseId: lahoreId, productId: productA });
    await openingService.cancelOpeningStock(String(entry!._id), 'Counted wrong', adminId);
    const b = await balance(lahoreId, productA);
    assert.equal(b.sellable, 0);
    assert.equal(b.damaged, 0);

    // The slot is free, so a corrected entry can now be posted.
    await openingService.postOpeningStock(
      { warehouseId: lahoreId, lines: [{ productId: productA, sellableQty: 42, rate: 30 }] },
      adminId,
    );
    assert.equal((await balance(lahoreId, productA)).sellable, 42);
  });

  // -------------------------------------------------------------------------
  console.log('\nThe products form can no longer touch stock');
  // -------------------------------------------------------------------------
  await test('the create schema rejects a quantity outright', () => {
    const { error, value } = createProductSchema.validate(
      { barcode: 'Z-1', name: 'Zed', categoryId: String(CATEGORY), quantity: 500 },
      { stripUnknown: true },
    );
    assert.equal(error, undefined);
    assert.equal('quantity' in value, false, 'quantity must be stripped, not accepted');
  });

  await test('createProduct ignores a quantity even when it bypasses validation', async () => {
    const created = await productsService.createProduct(
      { barcode: 'Z-2', name: 'Zed Two', categoryId: String(CATEGORY), quantity: 500 } as never,
      adminId,
    );
    assert.ok(created.quantity === undefined || created.quantity === 0);
    assert.equal(await WarehouseStockModel.countDocuments({ productId: created._id }), 0);
  });

  await test('updateProduct ignores a stale quantity — the worst old drift path', async () => {
    // The admin edit form used to re-send the quantity it read at page load, so saving an unrelated
    // field minutes later reset stock to a stale number.
    const before = (await costOf(productA)).mirror;
    await productsService.updateProduct(
      productA,
      { barcode: 'A-1', name: 'Product A', categoryId: String(CATEGORY), description: 'edited', quantity: 999 },
      adminId,
    );
    assert.equal((await costOf(productA)).mirror, before);
    assert.equal((await ProductModel.findById(productA).lean())?.description, 'edited');
  });

  await test('the update schema strips quantity and lastPurchaseRate', () => {
    const { value } = updateProductSchema.validate(
      { barcode: 'A-1', name: 'Product A', categoryId: String(CATEGORY), quantity: 1, lastPurchaseRate: 7 },
      { stripUnknown: true },
    );
    assert.equal('quantity' in value, false);
    assert.equal('lastPurchaseRate' in value, false);
  });

  // -------------------------------------------------------------------------
  console.log('\nCurrent stock report');
  // -------------------------------------------------------------------------
  await test('rows are per warehouse and per product, split by bucket', async () => {
    const rows = await stockService.getWarehouseStock({}, { userId: adminId, role: 'admin' });
    const lahoreRow = rows.find((r) => r.warehouseId === lahoreId && r.productId === productA);
    assert.ok(lahoreRow);
    assert.equal(lahoreRow!.sellable, 42);
    assert.equal(lahoreRow!.warehouseName, 'Lahore Warehouse');
  });

  await test('the low-stock flag compares the ALL-warehouse total against the product level', async () => {
    // Product A: 42 in Lahore + 15 in Main = 57, level is 20 → not low.
    const rows = await stockService.getWarehouseStock({}, { userId: adminId, role: 'admin' });
    const row = rows.find((r) => r.productId === productA)!;
    assert.equal(row.totalSellableAllWarehouses, 57);
    assert.equal(row.isLow, false);

    await ProductModel.updateOne({ _id: productA }, { $set: { survivalQuantity: 100 } });
    const after = await stockService.getWarehouseStock({}, { userId: adminId, role: 'admin' });
    assert.equal(after.find((r) => r.productId === productA)!.isLow, true);
    await ProductModel.updateOne({ _id: productA }, { $set: { survivalQuantity: 20 } });
  });

  await test('cost columns are stripped for non-admins', async () => {
    const staff = await UserModel.create({
      userID: 'WS-1', username: 'store.one', phone: '03002220002', password: 'x',
      role: 'warehouse_staff', warehouseId: lahoreId,
    });
    const rows = await stockService.getWarehouseStock(
      {},
      { userId: String(staff._id), role: 'warehouse_staff' },
    );
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.avgCost, undefined);
      assert.equal(row.stockValue, undefined);
      // Piece counts and potential sale value stay visible — they are the job.
      assert.equal(typeof row.sellable, 'number');
    }
  });

  await test('warehouse staff only see their own warehouse', async () => {
    const staff = await UserModel.findOne({ username: 'store.one' });
    const rows = await stockService.getWarehouseStock(
      {},
      { userId: String(staff!._id), role: 'warehouse_staff' },
    );
    assert.ok(rows.length > 0);
    for (const row of rows) assert.equal(row.warehouseId, lahoreId);
  });

  await test('asking for another warehouse explicitly returns nothing, it does not leak', async () => {
    const staff = await UserModel.findOne({ username: 'store.one' });
    const rows = await stockService.getWarehouseStock(
      { warehouseId: mainId },
      { userId: String(staff!._id), role: 'warehouse_staff' },
    );
    assert.deepEqual(rows, []);
  });

  await test('both integrity invariants still hold after every flow above', async () => {
    assert.deepEqual(await getIntegrityReport(), []);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} warehouse flow tests passed.`);
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
