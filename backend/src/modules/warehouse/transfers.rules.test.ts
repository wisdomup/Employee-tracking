/**
 * Transfers and damage / claim entries end to end.
 *
 * The cases that matter are the ones where stock could be created or destroyed: over-receipt,
 * double receipt, a shortfall, cancelling after the destination has sold the goods, and the rule
 * that a pending damage entry moves nothing at all.
 *
 * Run with: npm run test:transfers
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { StockTransferModel } from '../../models/stock-transfer.model';
import { DamageClaimModel } from '../../models/damage-claim.model';
import { UserModel } from '../../models/user.model';
import { BroadcastNotificationModel } from '../../models/broadcast-notification.model';
import '../../models/category.model';
import '../../models/dealer.model';

import * as transfers from './stock-transfers.service';
import * as damage from './damage-claims.service';
import { applyStockMovements, getIntegrityReport } from './stock-ledger.service';

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
let staffMain: { userId: string; role: string };
let staffLahore: { userId: string; role: string };
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

async function mirror(productId: string) {
  const p = await ProductModel.findById(productId).select('quantity').lean();
  return p?.quantity ?? 0;
}

async function seedStock(mainQty: number, lahoreQty = 0) {
  await WarehouseStockModel.deleteMany({});
  await StockMovementModel.deleteMany({});
  await StockTransferModel.deleteMany({});
  await DamageClaimModel.deleteMany({});

  const lines = [
    { warehouseId: mainId, productId: productA, bucket: 'sellable' as const, delta: mainQty, type: 'opening_stock' as const },
    { warehouseId: mainId, productId: productB, bucket: 'sellable' as const, delta: mainQty, type: 'opening_stock' as const },
  ];
  if (lahoreQty > 0) {
    lines.push({
      warehouseId: lahoreId, productId: productA, bucket: 'sellable', delta: lahoreQty, type: 'opening_stock',
    });
  }
  await applyStockMovements(lines, {
    refType: 'opening_stock',
    refId: String(new Types.ObjectId()),
    actorId: adminA.userId,
  });
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'transfers-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
    StockTransferModel.syncIndexes(),
    DamageClaimModel.syncIndexes(),
  ]);

  const [main0, lahore0] = await WarehouseModel.create([
    { name: 'Main Warehouse', city: 'Faisalabad', cityKey: 'faisalabad', isMain: true, isActive: true },
    { name: 'Lahore Warehouse', city: 'Lahore', cityKey: 'lahore', isActive: true },
  ]);
  mainId = String(main0._id);
  lahoreId = String(lahore0._id);

  const users = await UserModel.create([
    { userID: 'A1', username: 'admin.a', phone: '03000000001', password: 'x', role: 'admin' },
    { userID: 'A2', username: 'admin.b', phone: '03000000002', password: 'x', role: 'admin' },
    { userID: 'S1', username: 'store.main', phone: '03000000003', password: 'x', role: 'warehouse_staff', warehouseId: main0._id },
    { userID: 'S2', username: 'store.lahore', phone: '03000000004', password: 'x', role: 'warehouse_staff', warehouseId: lahore0._id },
  ]);
  adminA = { userId: String(users[0]._id), role: 'admin' };
  adminB = { userId: String(users[1]._id), role: 'admin' };
  staffMain = { userId: String(users[2]._id), role: 'warehouse_staff' };
  staffLahore = { userId: String(users[3]._id), role: 'warehouse_staff' };

  const [a, b] = await ProductModel.create([
    { barcode: 'A', name: 'Product A', categoryId: CATEGORY, createdBy: users[0]._id },
    { barcode: 'B', name: 'Product B', categoryId: CATEGORY, createdBy: users[0]._id },
  ]);
  productA = String(a._id);
  productB = String(b._id);

  // -------------------------------------------------------------------------
  console.log('Raising a transfer');
  // -------------------------------------------------------------------------
  await seedStock(100);

  await test('a staff member always sends from their own warehouse', async () => {
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 30 }] },
      staffMain,
    );
    assert.equal(String((transfer.fromWarehouseId as any)._id), mainId);
    assert.equal(transfer.status, 'pending');
  });

  await test('raising a transfer moves NO stock', async () => {
    assert.equal((await balance(mainId, productA)).sellable, 100);
    assert.equal((await balance(mainId, productA)).inTransit, 0);
  });

  await test('a transfer to the same warehouse is refused', async () => {
    await rejectsWith(
      transfers.createTransfer(
        { fromWarehouseId: mainId, toWarehouseId: mainId, products: [{ productId: productA, sentQty: 1 }] },
        adminA,
      ),
      /must be different/i,
    );
  });

  await test('sending more than the source has is refused up front', async () => {
    await rejectsWith(
      transfers.createTransfer(
        { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 500 }] },
        staffMain,
      ),
      /not enough sellable stock/i,
    );
  });

  await test('a staff member cannot send from someone else’s warehouse', async () => {
    await rejectsWith(
      transfers.createTransfer(
        { fromWarehouseId: mainId, toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 1 }] },
        staffLahore,
      ),
      /only send stock from your own warehouse/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nApproval — stock leaves the source');
  // -------------------------------------------------------------------------
  await test('approval moves sellable into in-transit at the SOURCE', async () => {
    const transfer = await StockTransferModel.findOne({ status: 'pending' });
    await transfers.approveTransfer(String(transfer!._id), adminA.userId);
    const b0 = await balance(mainId, productA);
    assert.equal(b0.sellable, 70);
    assert.equal(b0.inTransit, 30);
    assert.equal((await balance(lahoreId, productA)).sellable, 0, 'the destination gets nothing yet');
  });

  await test('the mirror drops at approval — in-transit stock is not sellable anywhere', async () => {
    assert.equal(await mirror(productA), 70);
  });

  await test('you cannot approve a transfer you raised yourself', async () => {
    const own = await transfers.createTransfer(
      { fromWarehouseId: mainId, toWarehouseId: lahoreId, products: [{ productId: productB, sentQty: 5 }] },
      adminA,
    );
    await rejectsWith(
      transfers.approveTransfer(String(own._id), adminA.userId),
      /cannot approve a transfer you created/i,
    );
    // Another admin can.
    await transfers.approveTransfer(String(own._id), adminB.userId);
    assert.equal((await balance(mainId, productB)).inTransit, 5);
  });

  await test('approving twice is refused', async () => {
    const approved = await StockTransferModel.findOne({ status: 'approved' });
    await rejectsWith(
      transfers.approveTransfer(String(approved!._id), adminB.userId),
      /cannot approve a transfer that is "approved"/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nReceiving');
  // -------------------------------------------------------------------------
  await test('receiving exactly what was sent completes the transfer', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 40 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    const result = await transfers.receiveTransfer(
      String(transfer._id),
      [{ productId: productA, receivedQty: 40 }],
      staffLahore,
    );
    assert.equal(result.status, 'completed');
    assert.equal((await balance(mainId, productA)).inTransit, 0);
    assert.equal((await balance(lahoreId, productA)).sellable, 40);
    // Nothing was created or destroyed overall.
    assert.equal(await mirror(productA), 100);
  });

  await test('receiving MORE than was sent is refused — it would invent stock', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 10 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await rejectsWith(
      transfers.receiveTransfer(
        String(transfer._id),
        [{ productId: productA, receivedQty: 12 }],
        staffLahore,
      ),
      /cannot exceed the quantity sent/i,
    );
    assert.equal((await balance(lahoreId, productA)).sellable, 0);
  });

  await test('a line for a product that was never sent is refused', async () => {
    const transfer = await StockTransferModel.findOne({ status: 'approved' });
    await rejectsWith(
      transfers.receiveTransfer(
        String(transfer!._id),
        [{ productId: productB, receivedQty: 1 }],
        staffLahore,
      ),
      /not on this transfer/i,
    );
  });

  await test('receiving short credits ONLY what arrived and parks the rest in transit', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 20 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    const result = await transfers.receiveTransfer(
      String(transfer._id),
      [{ productId: productA, receivedQty: 15, receiveNote: '5 cartons damaged in transit' }],
      staffLahore,
    );
    assert.equal(result.status, 'mismatch');
    assert.equal((await balance(lahoreId, productA)).sellable, 15, 'only the received qty');
    assert.equal((await balance(mainId, productA)).inTransit, 5, 'the shortfall stays visible');
    assert.equal((await balance(mainId, productA)).sellable, 80);
  });

  await test('receiving twice is refused', async () => {
    const transfer = await StockTransferModel.findOne({ status: 'mismatch' });
    await rejectsWith(
      transfers.receiveTransfer(
        String(transfer!._id),
        [{ productId: productA, receivedQty: 15 }],
        staffLahore,
      ),
      /cannot receive a transfer that is "mismatch"/i,
    );
  });

  await test('a staff member at the SOURCE cannot confirm receipt', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 5 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await rejectsWith(
      transfers.receiveTransfer(
        String(transfer._id),
        [{ productId: productA, receivedQty: 5 }],
        staffMain,
      ),
      /do not have access/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nResolving a shortfall');
  // -------------------------------------------------------------------------
  await test('write_off clears the in-transit shortfall and the stock is gone for good', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 20 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await transfers.receiveTransfer(
      String(transfer._id),
      [{ productId: productA, receivedQty: 14 }],
      staffLahore,
    );
    const result = await transfers.resolveTransferMismatch(
      String(transfer._id),
      'write_off',
      'Confirmed lost by the carrier',
      adminA.userId,
    );
    assert.equal(result.status, 'completed');
    assert.equal((await balance(mainId, productA)).inTransit, 0);
    assert.equal(await mirror(productA), 94, '6 pieces written off from 100');
  });

  await test('return_to_source puts the shortfall back on the source shelf', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 20 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await transfers.receiveTransfer(
      String(transfer._id),
      [{ productId: productA, receivedQty: 14 }],
      staffLahore,
    );
    await transfers.resolveTransferMismatch(
      String(transfer._id),
      'return_to_source',
      'Found on the loading bay',
      adminA.userId,
    );
    assert.equal((await balance(mainId, productA)).inTransit, 0);
    assert.equal((await balance(mainId, productA)).sellable, 86);
    assert.equal(await mirror(productA), 100, 'nothing lost overall');
  });

  // -------------------------------------------------------------------------
  console.log('\nCancelling');
  // -------------------------------------------------------------------------
  await test('cancelling a pending transfer moves nothing', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 10 }] },
      staffMain,
    );
    await transfers.cancelTransfer(String(transfer._id), 'Not needed after all', adminA.userId);
    assert.equal((await balance(mainId, productA)).sellable, 100);
  });

  await test('cancelling an approved transfer puts the stock back on the source shelf', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 25 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await transfers.cancelTransfer(String(transfer._id), 'Truck broke down', adminA.userId);
    const b0 = await balance(mainId, productA);
    assert.equal(b0.sellable, 100);
    assert.equal(b0.inTransit, 0);
  });

  await test('cancelling a completed transfer is refused once the destination has sold the goods', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 30 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await transfers.receiveTransfer(
      String(transfer._id),
      [{ productId: productA, receivedQty: 30 }],
      staffLahore,
    );
    // Lahore sells everything it received.
    await applyStockMovements(
      [{ warehouseId: lahoreId, productId: productA, bucket: 'sellable', delta: -30, type: 'sale_out' }],
      { refType: 'order', refId: String(new Types.ObjectId()), actorId: adminA.userId },
    );
    await rejectsWith(
      transfers.cancelTransfer(String(transfer._id), 'raised in error', adminA.userId),
      /insufficient sellable stock/i,
    );
    const still = await StockTransferModel.findById(transfer._id).lean();
    assert.equal(still?.status, 'completed', 'a refused cancel must not change the status');
  });

  await test('cancelling a completed transfer works while the goods are still there', async () => {
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 30 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await transfers.receiveTransfer(
      String(transfer._id),
      [{ productId: productA, receivedQty: 30 }],
      staffLahore,
    );
    await transfers.cancelTransfer(String(transfer._id), 'Wrong destination', adminA.userId);
    assert.equal((await balance(lahoreId, productA)).sellable, 0);
    assert.equal((await balance(mainId, productA)).sellable, 100);
  });

  await test('no transfer operation ever changes the product cost', async () => {
    await ProductModel.updateOne({ _id: productA }, { $set: { purchasePrice: 12.5 } });
    await seedStock(100);
    const transfer = await transfers.createTransfer(
      { toWarehouseId: lahoreId, products: [{ productId: productA, sentQty: 10 }] },
      staffMain,
    );
    await transfers.approveTransfer(String(transfer._id), adminA.userId);
    await transfers.receiveTransfer(
      String(transfer._id),
      [{ productId: productA, receivedQty: 8 }],
      staffLahore,
    );
    await transfers.resolveTransferMismatch(
      String(transfer._id),
      'write_off',
      'lost',
      adminA.userId,
    );
    const p = await ProductModel.findById(productA).select('purchasePrice').lean();
    assert.equal(p?.purchasePrice, 12.5);
  });

  // -------------------------------------------------------------------------
  console.log('\nDamage / claim entries');
  // -------------------------------------------------------------------------
  await test('a client claim without a client name is refused', async () => {
    await seedStock(100);
    await rejectsWith(
      damage.createDamageClaim(
        {
          source: 'client_claim',
          reason: 'Faulty on arrival',
          products: [{ productId: productA, quantity: 5 }],
        },
        staffMain,
      ),
      /needs the client name/i,
    );
  });

  await test('raising an entry moves NO stock — it waits for approval', async () => {
    const claim = await damage.createDamageClaim(
      {
        source: 'internal_damage',
        reason: 'Crushed by a forklift',
        products: [{ productId: productA, quantity: 12 }],
      },
      staffMain,
    );
    assert.equal(claim.status, 'pending');
    const b0 = await balance(mainId, productA);
    assert.equal(b0.sellable, 100);
    assert.equal(b0.damaged, 0);
  });

  await test('approval moves pieces from Sellable to Damaged, conserving the total', async () => {
    const claim = await DamageClaimModel.findOne({ status: 'pending' });
    await damage.approveDamageClaim(String(claim!._id), adminA.userId);
    const b0 = await balance(mainId, productA);
    assert.equal(b0.sellable, 88);
    assert.equal(b0.damaged, 12);
    assert.equal(b0.sellable + b0.damaged, 100);
    // The mirror only counts sellable, so damaged stock drops out of it — as it should.
    assert.equal(await mirror(productA), 88);
  });

  await test('you cannot approve an entry you raised yourself', async () => {
    const claim = await damage.createDamageClaim(
      {
        warehouseId: mainId,
        source: 'internal_damage',
        reason: 'Water damage',
        products: [{ productId: productA, quantity: 3 }],
      },
      adminA,
    );
    await rejectsWith(
      damage.approveDamageClaim(String(claim._id), adminA.userId),
      /cannot approve an entry you created/i,
    );
    await damage.approveDamageClaim(String(claim._id), adminB.userId);
    assert.equal((await balance(mainId, productA)).damaged, 15);
  });

  await test('rejection changes nothing at all', async () => {
    const before = await balance(mainId, productA);
    const claim = await damage.createDamageClaim(
      {
        source: 'client_claim',
        clientName: 'Al-Karam Store',
        reason: 'Client says the seal was broken',
        products: [{ productId: productA, quantity: 7 }],
      },
      staffMain,
    );
    await damage.rejectDamageClaim(String(claim._id), 'Client accepted a replacement', adminA.userId);
    const after = await balance(mainId, productA);
    assert.deepEqual(after, before);
    const saved = await DamageClaimModel.findById(claim._id).lean();
    assert.equal(saved?.status, 'rejected');
    assert.equal(saved?.clientName, 'Al-Karam Store');
  });

  await test('approving more than is available fails and leaves the entry pending', async () => {
    const claim = await damage.createDamageClaim(
      {
        source: 'internal_damage',
        reason: 'Whole pallet crushed',
        products: [{ productId: productA, quantity: 9999 }],
      },
      staffMain,
    );
    await rejectsWith(
      damage.approveDamageClaim(String(claim._id), adminA.userId),
      /insufficient sellable stock/i,
    );
    const saved = await DamageClaimModel.findById(claim._id).lean();
    assert.equal(saved?.status, 'pending', 'so it can be approved once stock is there');
  });

  await test('cancelling an approved entry puts the pieces back in Sellable', async () => {
    await seedStock(100);
    const claim = await damage.createDamageClaim(
      {
        source: 'internal_damage',
        reason: 'Looked damaged',
        products: [{ productId: productA, quantity: 10 }],
      },
      staffMain,
    );
    await damage.approveDamageClaim(String(claim._id), adminA.userId);
    assert.equal((await balance(mainId, productA)).damaged, 10);

    await damage.cancelDamageClaim(String(claim._id), 'Turned out to be fine', adminA.userId);
    const b0 = await balance(mainId, productA);
    assert.equal(b0.sellable, 100);
    assert.equal(b0.damaged, 0);
  });

  await test('staff only see their own warehouse’s entries', async () => {
    await damage.createDamageClaim(
      {
        warehouseId: lahoreId,
        source: 'internal_damage',
        reason: 'Lahore breakage',
        products: [{ productId: productA, quantity: 1 }],
      },
      adminA,
    );
    const mainRows = await damage.findAllDamageClaims({}, staffMain);
    assert.ok(mainRows.length > 0);
    for (const row of mainRows) {
      assert.equal(String((row.warehouseId as any)._id), mainId);
    }
  });

  // -------------------------------------------------------------------------
  console.log('\nNotifications and integrity');
  // -------------------------------------------------------------------------
  await test('system notifications are raised for approvals and mismatches', async () => {
    // The emitters are fire-and-forget via setImmediate, so let the queue drain.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const notifications = await BroadcastNotificationModel.find({ source: 'system' }).lean();
    assert.ok(notifications.length > 0, 'expected at least one system notification');
    for (const n of notifications) {
      assert.equal(n.audienceType, 'specific_users');
      assert.ok((n.targetUserIds ?? []).length > 0);
      assert.ok(n.link, 'a system notification should deep-link to the document');
    }
  });

  await test('both ledger invariants still hold after every flow above', async () => {
    assert.deepEqual(await getIntegrityReport(), []);
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} transfer and damage tests passed.`);
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
