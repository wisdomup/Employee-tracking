/**
 * Control reconciliation, against an in-memory MongoDB.
 *
 * The proposition: the ledger agrees with the records behind it, and when it stops agreeing the
 * month cannot be closed. That blocking behaviour is the reason the module is worth building —
 * everything else is bookkeeping.
 *
 * Run with: npm run test:finance:reconcile
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { ProductModel } from '../../models/product.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { OrderModel } from '../../models/order.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { ReturnModel } from '../../models/return.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { ControlReconciliationModel } from '../../models/control-reconciliation.model';
import { FinanceSettingsModel, POSTING_EVENT_KEYS } from '../../models/finance-settings.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import * as periods from './period.service';
import * as sales from './sales-posting.service';
import * as controls from './control-reconciliation.service';
import * as inventoryPosting from './inventory-posting.service';
import { round2 } from './finance.rules';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok   ${name}`);
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

const WAREHOUSE = new Types.ObjectId();
const PRODUCT = new Types.ObjectId();
const DEALER = new Types.ObjectId();
const RIDER = new Types.ObjectId();

function checkById(result: controls.ReconciliationResult, id: string) {
  const check = result.checks.find((c) => c.checkId === id);
  assert.ok(check, `no ${id} check was produced`);
  return check!;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-reconcile-flow-test' });

  await seedFinanceChart();
  await WarehouseModel.create({
    _id: WAREHOUSE,
    name: 'Main',
    city: 'Lahore',
    cityKey: 'lahore',
    isMain: true,
  });
  await ProductModel.create({
    _id: PRODUCT,
    barcode: 'REC-1',
    name: 'Recon Product',
    purchasePrice: 40,
    categoryId: new Types.ObjectId(),
    createdBy: RIDER,
  });

  const now = new Date();
  await periods.openPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' });
  for (const event of POSTING_EVENT_KEYS) settings!.postingEnabled.set(event, true);
  await settings!.save();

  // -------------------------------------------------------------------------
  // A clean start
  // -------------------------------------------------------------------------

  await test('an empty system reconciles, because zero equals zero', async () => {
    const result = await controls.runControlReconciliation();
    assert.equal(result.ok, true, `failing: ${result.checks.filter((c) => !c.ok).map((c) => c.checkId)}`);
    assert.ok(result.checks.length >= 7, 'not every control account was checked');
  });

  await test('every check reports the arithmetic it used, not just a verdict', async () => {
    // A drift with no breakdown is a dead end — whoever is looking has to re-derive the figure
    // by hand before they can start.
    const result = await controls.runControlReconciliation();
    for (const check of result.checks) {
      assert.ok(check.ledgerCode, `${check.checkId} does not say which account it checked`);
      assert.equal(typeof check.operationalValue, 'number');
      assert.ok(
        Object.keys(check.breakdown).length > 0,
        `${check.checkId} reports a verdict with no working`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Real activity
  // -------------------------------------------------------------------------

  await test('goods received put the shelf and the ledger in step', async () => {
    // Everything below builds on a shelf the ledger has actually seen filled. Creating warehouse
    // balances directly without a receipt is what an opening balance is for, and it would make
    // every check after this fail for a reason that has nothing to do with what is being tested.
    const receipt = await StockReceiptModel.create({
      receiptDate: new Date(),
      supplierName: 'Recon Supplies',
      warehouseId: WAREHOUSE,
      products: [{ productId: PRODUCT, quantity: 25, rate: 40 }],
      totalPieces: 25,
      totalAmount: 1000,
      status: 'posted',
      createdBy: RIDER,
    });
    await inventoryPosting.postStockReceipt(String(receipt._id));

    await WarehouseStockModel.create({
      warehouseId: WAREHOUSE,
      productId: PRODUCT,
      sellable: 25,
      damaged: 0,
      inTransit: 0,
    });

    const result = await controls.runControlReconciliation();
    const inventory = checkById(result, 'inventory-sellable');

    assert.equal(inventory.ledgerBalance, 1000);
    assert.equal(inventory.operationalValue, 1000);
    assert.equal(inventory.ok, true, 'the shelf and the ledger disagree straight after a receipt');
  });

  await test('a delivery leaves receivables, rider cash and stock all agreeing', async () => {
    const order = await OrderModel.create({
      invoiceNumber: 9001,
      products: [{ productId: PRODUCT, quantity: 10, price: 100, unitCost: 40 }],
      totalPrice: 1000,
      grandTotal: 1000,
      status: 'delivered',
      dealerId: DEALER,
      warehouseId: WAREHOUSE,
      createdBy: RIDER,
      orderDate: new Date(),
    });
    await sales.postOrderStockOut(String(order._id));

    const collection = await DeliveryCollectionModel.create({
      orderId: order._id,
      dealerId: DEALER,
      riderId: RIDER,
      city: 'Lahore',
      cityKey: 'lahore',
      dealerCityKey: 'lahore',
      orderAmount: 1000,
      cash: 600,
      online: 0,
      credit: 400,
      deliveredAt: new Date(),
      createdBy: RIDER,
    });
    await sales.postDelivery(String(collection._id));

    // Ten pieces left the shelf with the order.
    await WarehouseStockModel.updateOne(
      { warehouseId: WAREHOUSE, productId: PRODUCT },
      { $inc: { sellable: -10 } },
    );

    const result = await controls.runControlReconciliation();

    assert.equal(checkById(result, 'ar-trade').ok, true, 'receivables disagree after a delivery');
    assert.equal(checkById(result, 'rider-cash').ok, true, 'rider cash disagrees after a delivery');
    assert.equal(
      checkById(result, 'inventory-sellable').ok,
      true,
      'the shelf disagrees after a delivery',
    );

    // The shop owes exactly the credit portion, and the rider is holding exactly the cash.
    assert.equal(checkById(result, 'ar-trade').ledgerBalance, 400);
    assert.equal(checkById(result, 'rider-cash').ledgerBalance, 600);
    // 15 pieces left at 40.
    assert.equal(checkById(result, 'inventory-sellable').ledgerBalance, 600);
  });

  // -------------------------------------------------------------------------
  // The gap this module surfaced
  // -------------------------------------------------------------------------

  await test('a return exposes that the rider-facing figure does not subtract returns', async () => {
    // `getDealerOutstanding` is credit less recoveries. It never subtracts returns, so a shop
    // that sent goods back still shows the full amount owing on the rider's screen. The ledger
    // does subtract them, so the check reports both figures and names the gap.
    const returned = await ReturnModel.create({
      dealerId: DEALER,
      returnType: 'return',
      products: [{ productId: PRODUCT, quantity: 1, price: 100 }],
      amount: 100,
      status: 'completed',
      warehouseId: WAREHOUSE,
      createdBy: RIDER,
    });
    await inventoryPosting.postCustomerReturn(String(returned._id));

    // The piece came back to the shelf.
    await WarehouseStockModel.updateOne(
      { warehouseId: WAREHOUSE, productId: PRODUCT },
      { $inc: { sellable: 1 } },
    );

    const result = await controls.runControlReconciliation();
    const ar = checkById(result, 'ar-trade');

    assert.equal(ar.breakdown.returnsCredited, 100);
    assert.equal(ar.breakdown.figureShownToRiders, 400, 'the operational figure was not reported');
    assert.equal(ar.operationalValue, 300, 'the ledger comparison did not subtract the return');
    assert.match(ar.note ?? '', /does not subtract returns/);
  });

  // -------------------------------------------------------------------------
  // Blocking the close
  // -------------------------------------------------------------------------

  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await test('everything agrees before anything is deliberately broken', async () => {
    const result = await controls.runControlReconciliation();
    assert.equal(
      result.ok,
      true,
      `expected a clean slate, failing: ${result.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.checkId} by ${c.drift}`)
        .join(', ')}`,
    );
  });

  await test('a failing control blocks the month from closing', async () => {
    // The whole reason the module exists. A warning at close is a warning that gets clicked past
    // every month until the difference is a year old.
    //
    // Five pieces appear on the shelf that the ledger never saw arrive — a stock adjustment made
    // outside the system, which is exactly the kind of thing that used to surface at year end.
    await WarehouseStockModel.updateOne(
      { warehouseId: WAREHOUSE, productId: PRODUCT },
      { $inc: { sellable: 5 } },
    );

    const checks = await periods.closeChecks(thisMonth);
    const control = checks.find((c) => c.name.startsWith('Control accounts'));

    assert.ok(control, 'the close checklist has no control check');
    assert.equal(control!.ok, false, 'a known-bad control did not block the close');
    assert.match(control!.detail, /out by/);

    await rejectsWith(periods.closePeriod(thisMonth), /cannot be closed/);
  });

  await test('the close reason names the account and the amount', async () => {
    // "Cannot close" with no figure is the kind of message people work around.
    const checks = await periods.closeChecks(thisMonth);
    const control = checks.find((c) => c.name.startsWith('Control accounts'))!;
    assert.match(control.detail, /account 1150/);
    assert.match(control.detail, /out by 200/);
  });

  await test('fixing the drift lets the month close', async () => {
    // Remove the five pieces the ledger never saw arrive, and the two sides agree again.
    await WarehouseStockModel.updateOne(
      { warehouseId: WAREHOUSE, productId: PRODUCT },
      { $inc: { sellable: -5 } },
    );

    const control = (await periods.closeChecks(thisMonth)).find((c) =>
      c.name.startsWith('Control accounts'),
    )!;
    assert.equal(control.ok, true, `still failing: ${control.detail}`);

    const closed = await periods.closePeriod(thisMonth);
    assert.equal(closed.status, 'closed');
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  await test('results are recorded per day, so drift has a first-seen date', async () => {
    const rows = await ControlReconciliationModel.find({ checkId: 'ar-trade' }).lean();
    assert.ok(rows.length > 0, 'nothing was recorded');
    assert.match(rows[0].day, /^\d{4}-\d{2}-\d{2}$/);

    const history = await controls.driftHistory('ar-trade', 30);
    assert.ok(history.length > 0);
  });

  await test('re-running the same day replaces its row rather than piling up', async () => {
    await controls.runControlReconciliation();
    await controls.runControlReconciliation();
    const rows = await ControlReconciliationModel.countDocuments({ checkId: 'ar-trade' });
    assert.equal(rows, 1);
  });

  await test('the cached view does not re-run the checks', async () => {
    const cached = await controls.latestControlChecks();
    assert.ok(cached.checks.length > 0);
    assert.match(cached.day, /^\d{4}-\d{2}-\d{2}$/);
  });

  // -------------------------------------------------------------------------
  // Switches and failures
  // -------------------------------------------------------------------------

  await test('the switches are listed in plain words, not field names', async () => {
    const switches = await sales.listPostingSwitches();
    assert.equal(switches.length, POSTING_EVENT_KEYS.length);
    for (const s of switches) {
      assert.ok(s.label.length > s.event.length, `${s.event} has no readable label`);
    }
  });

  await test('an unknown switch is refused rather than silently created', async () => {
    await rejectsWith(
      sales.togglePostingSwitch('notAThing', true),
      /not something this system posts/,
    );
  });

  await test('a switch can be turned off and back on', async () => {
    await sales.togglePostingSwitch('collection', false);
    assert.equal(await sales.postingEnabled('collection'), false);
    await sales.togglePostingSwitch('collection', true);
    assert.equal(await sales.postingEnabled('collection'), true);
  });

  await test('nothing repaired anything', async () => {
    // These checks read. A drift is a symptom, and silently correcting the ledger to match would
    // destroy the evidence of whatever caused it.
    const ar = await LedgerModel.findOne({ code: '1140' }).select('cachedBalance').lean();
    assert.equal(round2(ar!.cachedBalance), 300, 'the reconciler altered a balance');
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
