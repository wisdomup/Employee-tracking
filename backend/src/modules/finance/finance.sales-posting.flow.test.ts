/**
 * Sales and collection auto-posting, against an in-memory MongoDB.
 *
 * The property that matters most here is not that entries appear — it is that the ledger's
 * inventory tracks the warehouse's at every step, and that a shop's receivable lands at exactly
 * the credit portion of the delivery with nothing left to reconcile.
 *
 * Run with: npm run test:finance:sales
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { FinanceSettingsModel, POSTING_EVENT_KEYS } from '../../models/finance-settings.model';
import { PostingFailureModel } from '../../models/posting-failure.model';
import { OrderModel } from '../../models/order.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { CreditRecoveryModel } from '../../models/credit-recovery.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import * as periods from './period.service';
import * as sales from './sales-posting.service';
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

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean();
  return round2(ledger?.cachedBalance ?? 0);
}

const WAREHOUSE_ID = new Types.ObjectId();
const DEALER_ID = new Types.ObjectId();
const RIDER_ID = new Types.ObjectId();
const PRODUCT_ID = new Types.ObjectId();

/** An order whose goods cost 600 and sell for 1000, with 100 of discount. */
async function makeOrder(overrides: Record<string, unknown> = {}) {
  return OrderModel.create({
    invoiceNumber: Math.floor(Math.random() * 1_000_000),
    products: [{ productId: PRODUCT_ID, quantity: 10, price: 100, unitCost: 60 }],
    totalPrice: 1000,
    discount: 100,
    grandTotal: 900,
    status: 'pending',
    dealerId: DEALER_ID,
    warehouseId: WAREHOUSE_ID,
    createdBy: RIDER_ID,
    orderDate: new Date(),
    ...overrides,
  });
}

async function makeCollection(
  orderId: Types.ObjectId,
  split: { cash: number; online: number; credit: number },
) {
  return DeliveryCollectionModel.create({
    orderId,
    dealerId: DEALER_ID,
    riderId: RIDER_ID,
    city: 'Lahore',
    cityKey: 'lahore',
    dealerCityKey: 'lahore',
    orderAmount: 900,
    ...split,
    deliveredAt: new Date(),
    createdBy: RIDER_ID,
  });
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-sales-flow-test' });

  await seedFinanceChart();
  await WarehouseModel.create({
    _id: WAREHOUSE_ID,
    name: 'Main',
    city: 'Lahore',
    cityKey: 'lahore',
    isMain: true,
  });

  const now = new Date();
  await periods.openPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  // -------------------------------------------------------------------------
  // The switches
  // -------------------------------------------------------------------------

  await test('every posting event is off until somebody turns it on', async () => {
    for (const event of POSTING_EVENT_KEYS) {
      assert.equal(await sales.postingEnabled(event), false, `${event} defaulted to on`);
    }
  });

  await test('with posting off, an order and a delivery write nothing to the ledger', async () => {
    // This is what lets the whole module be deployed long before it touches a real ledger.
    const order = await makeOrder();
    await sales.postOrderStockOut(String(order._id));
    const collection = await makeCollection(order._id, { cash: 900, online: 0, credit: 0 });
    await sales.postDelivery(String(collection._id));

    assert.equal(await JournalEntryModel.countDocuments(), 0);
    assert.equal(await balance('1150'), 0);
  });

  // Turn everything on for the rest of the run.
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' });
  for (const event of POSTING_EVENT_KEYS) settings!.postingEnabled.set(event, true);
  await settings!.save();

  // -------------------------------------------------------------------------
  // Stock out, then delivery
  // -------------------------------------------------------------------------

  let order: any;
  let collection: any;

  await test('creating an order moves the cost out of stock and into out-for-delivery', async () => {
    // The correction this module is built around: stock leaves at ORDER CREATE in this
    // platform, so the value has to leave with it. Posting cost only at delivery would leave
    // the ledger showing stock the warehouse had already given away.
    order = await makeOrder();
    const ok = await sales.postOrderStockOut(String(order._id));
    assert.equal(ok, true);

    assert.equal(await balance('1150'), -600, 'stock on hand did not fall');
    assert.equal(await balance('1165'), 600, 'out-for-delivery did not rise');
  });

  await test('delivering records the sale, the discount and the money', async () => {
    collection = await makeCollection(order._id, { cash: 500, online: 100, credit: 300 });
    const ok = await sales.postDelivery(String(collection._id));
    assert.equal(ok, true);

    // Sale: receivable 900, gross sales 1000, discount 100.
    assert.equal(await balance('4110'), 1000, 'sales was not booked at the gross figure');

    // Discounts is a CONTRA income account, so it carries a debit balance and therefore reads
    // NEGATIVE in its own credit direction. That is the point: it subtracts from income.
    // Gross 1000 less 100 of discount is the 900 the shop was actually billed.
    assert.equal(await balance('4130'), -100, 'the discount was lost, as it is in the old reports');
    assert.equal(
      round2((await balance('4110')) + (await balance('4130'))),
      900,
      'net income does not equal what the shop was billed',
    );

    // Money: cash and online with the rider.
    assert.equal(await balance('1130'), 500);
    assert.equal(await balance('1135'), 100);
  });

  await test("the shop's receivable equals the credit portion exactly", async () => {
    // The whole point. `validateCollectionSplit` already forces cash + online + credit to equal
    // the order total, so the sale and the receipt net to precisely the credit — no rounding
    // step, no reconciling item.
    assert.equal(await balance('1140'), 300);
  });

  await test('cost becomes an expense on delivery, and out-for-delivery empties', async () => {
    assert.equal(await balance('5110'), 600);
    assert.equal(await balance('1165'), 0, 'out-for-delivery still holds value after delivery');
  });

  await test('the books balance after a full delivery', async () => {
    const tb = await trialBalance();
    assert.equal(tb.balanced, true, `out by ${tb.difference}`);
  });

  await test('replaying the delivery posts nothing twice', async () => {
    const before = await balance('4110');
    await sales.postDelivery(String(collection._id));
    assert.equal(await balance('4110'), before);
  });

  // -------------------------------------------------------------------------
  // Corrections and voids
  // -------------------------------------------------------------------------

  await test('correcting the split moves the money without touching the sale', async () => {
    const salesBefore = await balance('4110');

    collection.cash = 200;
    collection.online = 100;
    collection.credit = 600;
    collection.lastCorrectedAt = new Date();
    await collection.save();

    const ok = await sales.postCollectionCorrection(String(collection._id));
    assert.equal(ok, true);

    assert.equal(await balance('4110'), salesBefore, 'the sale moved during a split correction');
    assert.equal(await balance('1130'), 200, 'rider cash was not re-stated');
    assert.equal(await balance('1140'), 600, 'the receivable does not match the new credit');
  });

  await test('voiding the collection leaves the sale and the cost standing', async () => {
    // This platform's void keeps the order delivered and returns no stock — so the goods are
    // with the shop and the shop still owes for them. Reversing the sale too would erase a sale
    // that really happened and orphan the inventory reduction.
    const salesBefore = await balance('4110');
    const cogsBefore = await balance('5110');

    collection.voidedAt = new Date();
    await collection.save();
    const ok = await sales.postCollectionVoid(String(collection._id));
    assert.equal(ok, true);

    assert.equal(await balance('4110'), salesBefore);
    assert.equal(await balance('5110'), cogsBefore);
    assert.equal(await balance('1130'), 0, 'the rider still holds voided cash');
    assert.equal(await balance('1140'), 900, 'the shop should now owe the whole order');
  });

  await test('the books still balance after a correction and a void', async () => {
    const tb = await trialBalance();
    assert.equal(tb.balanced, true, `out by ${tb.difference}`);
  });

  // -------------------------------------------------------------------------
  // Cancellation before delivery
  // -------------------------------------------------------------------------

  await test('cancelling before delivery puts the value back on the shelf', async () => {
    const cancelled = await makeOrder();
    await sales.postOrderStockOut(String(cancelled._id));

    const shelfAfterOut = await balance('1150');
    const holdingAfterOut = await balance('1165');

    await sales.postOrderStockReturned(String(cancelled._id));

    assert.equal(await balance('1150'), round2(shelfAfterOut + 600));
    assert.equal(await balance('1165'), round2(holdingAfterOut - 600));
  });

  // -------------------------------------------------------------------------
  // Credit recovery
  // -------------------------------------------------------------------------

  await test('recovering old credit moves money in and the receivable down', async () => {
    const arBefore = await balance('1140');
    const cashBefore = await balance('1130');

    const recovery = await CreditRecoveryModel.create({
      dealerId: DEALER_ID,
      riderId: RIDER_ID,
      city: 'Lahore',
      cityKey: 'lahore',
      amount: 250,
      mode: 'cash',
      collectedAt: new Date(),
      createdBy: RIDER_ID,
    });

    const ok = await sales.postCreditRecovery(String(recovery._id));
    assert.equal(ok, true);

    assert.equal(await balance('1130'), round2(cashBefore + 250));
    assert.equal(await balance('1140'), round2(arBefore - 250));
  });

  await test('no sale and no stock move on a recovery', async () => {
    // It is not a sale — the model header says so, and the ledger has to agree.
    const entries = await JournalEntryModel.find({ sourceType: 'credit_recovery' }).lean();
    assert.ok(entries.length > 0);
    const salesEntries = await JournalEntryModel.countDocuments({
      sourceType: 'order_delivery',
      narration: /recover/i,
    });
    assert.equal(salesEntries, 0);
  });

  // -------------------------------------------------------------------------
  // Failure handling
  // -------------------------------------------------------------------------

  await test('a broken ledger map records the failure instead of breaking the delivery', async () => {
    // A rider in a shop must not be refused because head office mis-mapped an account.
    const broken = await FinanceSettingsModel.findOne({ key: 'singleton' });
    const savedCogs = broken!.ledgerMap.get('cogs');
    broken!.ledgerMap.delete('cogs');
    await broken!.save();

    const failOrder = await makeOrder();
    const failCollection = await makeCollection(failOrder._id, { cash: 900, online: 0, credit: 0 });

    // Must resolve, not throw.
    const ok = await sales.postDelivery(String(failCollection._id));
    assert.equal(ok, false, 'a failed posting should report failure, not success');

    const failures = await PostingFailureModel.find({ resolvedAt: { $exists: false } }).lean();
    assert.ok(failures.length > 0, 'the failure was swallowed with no record');
    assert.match(failures.map((f) => f.lastError).join(' '), /cogs/);

    // Put it back and retry — postings are idempotent, so a retry either writes or finds it done.
    broken!.ledgerMap.set('cogs', savedCogs!);
    await broken!.save();

    const result = await sales.retryFailedPostings();
    assert.ok(result.recovered >= 1, 'the retry recovered nothing');

    const stillFailing = await PostingFailureModel.countDocuments({
      resolvedAt: { $exists: false },
      event: 'delivery.cogs',
    });
    assert.equal(stillFailing, 0);
  });

  await test('the books balance at the end of every path taken here', async () => {
    const tb = await trialBalance();
    assert.equal(tb.balanced, true, `out by ${tb.difference}`);
  });

  await test('switching posting on mid-flight does not strand value in the holding account', async () => {
    // The realistic switch-on: an order was created while posting was off, so its stock left the
    // warehouse unrecorded, and it is delivered after posting is enabled. Crediting the holding
    // account would drive it negative and leave the books showing stock out for delivery that is
    // not. The cost must come straight off the shelf instead.
    const holdingBefore = await balance('1165');
    const shelfBefore = await balance('1150');

    const lateOrder = await makeOrder();
    // Deliberately NO postOrderStockOut — that is what "created while posting was off" means.
    const lateCollection = await makeCollection(lateOrder._id, { cash: 900, online: 0, credit: 0 });
    await sales.postDelivery(String(lateCollection._id));

    assert.equal(await balance('1165'), holdingBefore, 'the holding account absorbed a stray cost');
    assert.equal(
      await balance('1150'),
      round2(shelfBefore - 600),
      'the cost did not come off the shelf',
    );
  });

  await test('nothing is left stranded in out-for-delivery', async () => {
    // Every order that had a stock-out posted has since been delivered or cancelled, so the
    // holding account must be empty. A residue here means value has gone missing between the
    // warehouse and the books.
    assert.equal(await balance('1165'), 0, 'value is stranded in out-for-delivery');
  });

  await test('what left the shelf equals what became cost of sales', async () => {
    const shelf = await balance('1150');
    const cogs = await balance('5110');
    assert.equal(round2(-shelf), cogs, 'the ledger lost track of inventory somewhere');
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
