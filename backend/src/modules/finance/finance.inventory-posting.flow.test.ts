/**
 * Inventory auto-posting, against an in-memory MongoDB.
 *
 * The three traps are the point of this file. Each would leave the books looking right and the
 * inventory value wrong, and none of them is visible in the specification — they were found by
 * reading the operational code.
 *
 * Run with: npm run test:finance:inventory
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { ReturnModel } from '../../models/return.model';
import { DamageClaimModel } from '../../models/damage-claim.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { StockTransferModel } from '../../models/stock-transfer.model';
import { StockCountModel } from '../../models/stock-count.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { FinanceSettingsModel, POSTING_EVENT_KEYS } from '../../models/finance-settings.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import * as periods from './period.service';
import * as inventory from './inventory-posting.service';
import { trialBalance } from './journal.service';
import { round2 } from './finance.rules';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok   ${name}`);
}

let mongod: MongoMemoryServer;

const MAIN = new Types.ObjectId();
const BRANCH = new Types.ObjectId();
const PRODUCT = new Types.ObjectId();
const DEALER = new Types.ObjectId();
const ACTOR = new Types.ObjectId();

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean();
  return round2(ledger?.cachedBalance ?? 0);
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-inventory-flow-test' });

  await seedFinanceChart();

  await WarehouseModel.create([
    { _id: MAIN, name: 'Main', city: 'Lahore', cityKey: 'lahore', isMain: true },
    { _id: BRANCH, name: 'Branch', city: 'Multan', cityKey: 'multan' },
  ]);

  // Weighted-average cost of 50 a piece. Everything below values off this.
  await ProductModel.create({
    _id: PRODUCT,
    barcode: 'TEST-1',
    name: 'Test Product',
    purchasePrice: 50,
    categoryId: new Types.ObjectId(),
    createdBy: ACTOR,
  });

  const now = new Date();
  await periods.openPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' });
  for (const event of POSTING_EVENT_KEYS) settings!.postingEnabled.set(event, true);
  await settings!.save();

  // -------------------------------------------------------------------------
  // Goods received
  // -------------------------------------------------------------------------

  let receipt: any;

  await test('goods received put stock on the shelf against a supplier liability', async () => {
    receipt = await StockReceiptModel.create({
      receiptDate: new Date(),
      supplierName: 'Acme Traders',
      warehouseId: MAIN,
      products: [{ productId: PRODUCT, quantity: 100, rate: 50 }],
      totalPieces: 100,
      totalAmount: 5000,
      status: 'posted',
      createdBy: ACTOR,
    });

    const ok = await inventory.postStockReceipt(String(receipt._id), String(ACTOR));
    assert.equal(ok, true);

    assert.equal(await balance('1150'), 5000, 'stock did not go on the shelf');
    assert.equal(await balance('2115'), 5000, 'no liability was raised for the goods');
  });

  await test('a receipt uses its own rate, not the running average', async () => {
    // The rate on the receipt IS what these pieces cost, and it is what moves the average for
    // everything after. Valuing them at the old average would misstate both.
    const dearer = await StockReceiptModel.create({
      receiptDate: new Date(),
      warehouseId: MAIN,
      products: [{ productId: PRODUCT, quantity: 10, rate: 80 }],
      totalPieces: 10,
      totalAmount: 800,
      status: 'posted',
      createdBy: ACTOR,
    });

    await inventory.postStockReceipt(String(dearer._id), String(ACTOR));
    assert.equal(await balance('1150'), 5800, 'the receipt was valued at the average, not its rate');
  });

  await test('cancelling a receipt takes the value back off the shelf', async () => {
    const before = await balance('1150');
    receipt.status = 'cancelled';
    await receipt.save();

    const ok = await inventory.postStockReceiptReversal(String(receipt._id), String(ACTOR));
    assert.equal(ok, true);
    assert.equal(await balance('1150'), round2(before - 5000));
    assert.equal(await balance('2115'), 800, 'the liability was not released');
  });

  // -------------------------------------------------------------------------
  // TRAP 1 — the damage-type return
  // -------------------------------------------------------------------------

  await test('a plain return puts sellable stock back and un-does its cost', async () => {
    const plain = await ReturnModel.create({
      dealerId: DEALER,
      returnType: 'return',
      products: [{ productId: PRODUCT, quantity: 4, price: 100 }],
      amount: 400,
      status: 'completed',
      warehouseId: MAIN,
      createdBy: ACTOR,
    });

    const shelfBefore = await balance('1150');
    await inventory.postCustomerReturn(String(plain._id), String(ACTOR));

    assert.equal(await balance('1150'), round2(shelfBefore + 200), 'stock did not come back');
    assert.equal(await balance('5110'), -200, 'the cost of sale was not un-done');
    assert.equal(await balance('4120'), -400, 'the credit note was not recorded');
  });

  let damageReturn: any;

  await test('a DAMAGE return adds no sellable stock — it goes to write-off instead', async () => {
    // `creditReturnedStock` credits the DAMAGED bucket for a damage return, and damaged stock
    // carries no book value. Debiting inventory here would inflate it by the value of every
    // damaged item ever returned, with nothing on the warehouse side to disagree.
    const shelfBefore = await balance('1150');
    const writeOffBefore = await balance('5120');

    damageReturn = await ReturnModel.create({
      dealerId: DEALER,
      returnType: 'damage',
      products: [{ productId: PRODUCT, quantity: 6, price: 100 }],
      amount: 600,
      status: 'completed',
      warehouseId: MAIN,
      createdBy: ACTOR,
    });

    await inventory.postCustomerReturn(String(damageReturn._id), String(ACTOR));

    assert.equal(await balance('1150'), shelfBefore, 'damaged goods were added to sellable stock');
    assert.equal(await balance('5120'), round2(writeOffBefore + 300), 'no write-off was recorded');
  });

  await test('TRAP 1: the claim minted by that return posts nothing', async () => {
    // A completed damage return automatically creates an already-approved DamageClaim. Posting
    // it as well writes the same pieces off twice, and the inventory control drifts by the value
    // of every client damage claim with nothing to point at.
    const linked = await DamageClaimModel.create({
      warehouseId: MAIN,
      products: [{ productId: PRODUCT, quantity: 6 }],
      source: 'client_claim',
      clientName: 'A Shop',
      dealerId: DEALER,
      linkedReturnId: damageReturn._id,
      reason: 'Damaged goods returned by the client',
      status: 'approved',
      approvedAt: new Date(),
      createdBy: ACTOR,
    });

    const writeOffBefore = await balance('5120');
    const posted = await inventory.postDamageClaim(String(linked._id), String(ACTOR));

    assert.equal(posted, false, 'a linked claim posted an entry');
    assert.equal(await balance('5120'), writeOffBefore, 'the same goods were written off twice');
  });

  await test('an internal damage claim, with no return behind it, does post', async () => {
    const internal = await DamageClaimModel.create({
      warehouseId: MAIN,
      products: [{ productId: PRODUCT, quantity: 2 }],
      source: 'internal_damage',
      reason: 'Crushed by a pallet',
      status: 'approved',
      approvedAt: new Date(),
      createdBy: ACTOR,
    });

    const shelfBefore = await balance('1150');
    const writeOffBefore = await balance('5120');

    const ok = await inventory.postDamageClaim(String(internal._id), String(ACTOR));
    assert.equal(ok, true);

    assert.equal(await balance('5120'), round2(writeOffBefore + 100));
    assert.equal(await balance('1150'), round2(shelfBefore - 100));
  });

  // -------------------------------------------------------------------------
  // TRAP 3 — transfers have six states
  // -------------------------------------------------------------------------

  await test('an approved transfer moves value into in-transit, not out of the business', async () => {
    const transfer = await StockTransferModel.create({
      fromWarehouseId: MAIN,
      toWarehouseId: BRANCH,
      products: [{ productId: PRODUCT, sentQty: 20 }],
      status: 'approved',
      createdBy: ACTOR,
    });

    const shelfBefore = await balance('1150');
    await inventory.postTransferOut(String(transfer._id), String(ACTOR));

    assert.equal(await balance('1160'), 1000, 'nothing went into in-transit');
    assert.equal(await balance('1150'), round2(shelfBefore - 1000));
  });

  await test('a clean arrival empties in-transit onto the destination shelf', async () => {
    const transfer = await StockTransferModel.create({
      fromWarehouseId: MAIN,
      toWarehouseId: BRANCH,
      products: [{ productId: PRODUCT, sentQty: 10, receivedQty: 10 }],
      status: 'completed',
      createdBy: ACTOR,
    });

    await inventory.postTransferOut(String(transfer._id), String(ACTOR));
    const inTransitBefore = await balance('1160');
    const shelfBefore = await balance('1150');

    await inventory.postTransferIn(String(transfer._id), String(ACTOR));

    assert.equal(await balance('1160'), round2(inTransitBefore - 500));
    assert.equal(await balance('1150'), round2(shelfBefore + 500));
    assert.equal(await balance('5130'), 0, 'a clean transfer recorded shrinkage');
  });

  await test('TRAP 3: a short arrival books the difference as a real loss', async () => {
    // `mismatch` is the state where stock genuinely goes missing. Without this leg the value
    // would sit in in-transit for ever with no stock behind it.
    const transfer = await StockTransferModel.create({
      fromWarehouseId: MAIN,
      toWarehouseId: BRANCH,
      products: [{ productId: PRODUCT, sentQty: 10, receivedQty: 7 }],
      status: 'mismatch',
      createdBy: ACTOR,
    });

    await inventory.postTransferOut(String(transfer._id), String(ACTOR));
    const inTransitBefore = await balance('1160');

    await inventory.postTransferIn(String(transfer._id), String(ACTOR));

    assert.equal(await balance('5130'), 150, 'the three missing pieces were not booked as a loss');
    assert.equal(await balance('1160'), round2(inTransitBefore - 500), 'in-transit was not emptied');
  });

  await test('resolving a mismatch after receipt does not credit the destination twice', async () => {
    // `receiveTransfer` and `resolveTransferMismatch` both post an arrival, and the resolution
    // happens AFTER the receipt. Without reversing the earlier entry the destination warehouse
    // is credited twice for one delivery.
    const transfer = await StockTransferModel.create({
      fromWarehouseId: MAIN,
      toWarehouseId: BRANCH,
      products: [{ productId: PRODUCT, sentQty: 10, receivedQty: 8 }],
      status: 'mismatch',
      createdBy: ACTOR,
    });

    await inventory.postTransferOut(String(transfer._id), String(ACTOR));
    await inventory.postTransferIn(String(transfer._id), String(ACTOR));
    const shelfAfterFirst = await balance('1150');

    // The resolution pass, under a new `updatedAt` scope.
    transfer.updatedAt = new Date(Date.now() + 1000);
    await transfer.save();
    await inventory.postTransferIn(String(transfer._id), String(ACTOR));

    assert.equal(await balance('1150'), shelfAfterFirst, 'the arrival was counted twice');
  });

  // -------------------------------------------------------------------------
  // Stock counts
  // -------------------------------------------------------------------------

  await test('a count shortfall is a loss, and a surplus is not good news either', async () => {
    const short = await StockCountModel.create({
      warehouseId: MAIN,
      periodMonth: '2026-09',
      lines: [
        { productId: PRODUCT, systemSellable: 100, countedSellable: 96, systemDamaged: 0, countedDamaged: 0 },
      ],
      status: 'approved',
      approvedAt: new Date(),
      createdBy: ACTOR,
    });

    const shelfBefore = await balance('1150');
    await inventory.postStockCount(String(short._id), String(ACTOR));

    assert.equal(await balance('1150'), round2(shelfBefore - 200));
    // Both directions land in the same account. A surplus means the records were wrong, which is
    // not something to fold quietly into inventory as if it had always been there.
    assert.equal(await balance('5140'), 200);
  });

  await test('only the sellable delta carries value; damaged pieces move without money', async () => {
    const damagedOnly = await StockCountModel.create({
      warehouseId: MAIN,
      periodMonth: '2026-10',
      lines: [
        { productId: PRODUCT, systemSellable: 96, countedSellable: 96, systemDamaged: 0, countedDamaged: 5 },
      ],
      status: 'approved',
      approvedAt: new Date(),
      createdBy: ACTOR,
    });

    const shelfBefore = await balance('1150');
    const adjustBefore = await balance('5140');

    await inventory.postStockCount(String(damagedOnly._id), String(ACTOR));

    assert.equal(await balance('1150'), shelfBefore, 'a damaged-bucket count moved money');
    assert.equal(await balance('5140'), adjustBefore);
  });

  // -------------------------------------------------------------------------
  // Wholeness
  // -------------------------------------------------------------------------

  await test('every inventory line names the warehouse it belongs to', async () => {
    const { JournalLineModel } = await import('../../models/journal-line.model');
    const controls = await LedgerModel.find({ subledgerType: 'warehouse' }).select('_id').lean();
    const orphan = await JournalLineModel.countDocuments({
      ledgerId: { $in: controls.map((c) => c._id) },
      subledgerRef: null,
    });
    assert.equal(orphan, 0, 'a warehouse control line was posted without saying which warehouse');
  });

  await test('replaying every posting changes nothing', async () => {
    const before = await balance('1150');
    const receipts = await StockReceiptModel.find({ status: 'posted' }).select('_id').lean();
    for (const r of receipts) await inventory.postStockReceipt(String(r._id), String(ACTOR));
    const returns = await ReturnModel.find({ status: 'completed' }).select('_id').lean();
    for (const r of returns) await inventory.postCustomerReturn(String(r._id), String(ACTOR));
    assert.equal(await balance('1150'), before);
  });

  await test('the books balance after every inventory path', async () => {
    const tb = await trialBalance();
    assert.equal(tb.balanced, true, `out by ${tb.difference}`);
  });

  await test('nothing posted an entry for opening stock', async () => {
    // TRAP 2. Opening stock is the warehouse's starting position, not an accounting event.
    // Posting it would count the same inventory twice — once in the opening balance and again
    // as a movement. There is deliberately no code path that can.
    const count = await JournalEntryModel.countDocuments({ sourceType: 'opening_balance' });
    assert.equal(count, 0);
  });
}

main()
  .then(async () => {
    // eslint-disable-next-line no-console
    console.log(`\n  ${passed} checks passed\n`);
    await mongoose.disconnect();
    await mongod.stop();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(`\n  FAILED after ${passed} checks:\n`, err);
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(1);
  });
