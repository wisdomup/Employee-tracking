/**
 * The supplier master and the reconciliation of free-text names, against an in-memory MongoDB.
 *
 * The risk here is not a crash. It is a confident wrong merge: two suppliers combined into one
 * silently attributes one company's goods to another, and nothing downstream would complain.
 * So the tests care most about what the clean-up REFUSES to decide on its own.
 *
 * Run with: npm run test:finance:vendors
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { VendorModel } from '../../models/vendor.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { seedFinanceCounters } from './finance-counters';
import * as vendors from './vendors.service';

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
const ACTOR = new Types.ObjectId();

let receiptSeq = 0;
async function makeReceipt(supplierName: string | undefined, amount: number) {
  receiptSeq += 1;
  return StockReceiptModel.create({
    documentNo: receiptSeq,
    receiptDate: new Date(),
    supplierName,
    warehouseId: WAREHOUSE,
    products: [{ productId: PRODUCT, quantity: 1, rate: amount }],
    totalPieces: 1,
    totalAmount: amount,
    status: 'posted',
    createdBy: ACTOR,
  });
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-vendors-flow-test' });
  await VendorModel.syncIndexes();
  await seedFinanceCounters();

  // The mess as it exists today: one supplier, four spellings, plus two others and a blank.
  await makeReceipt('Acme Traders', 5000);
  await makeReceipt('ACME TRADERS', 3000);
  await makeReceipt('Acme Traders Pvt Ltd', 2000);
  await makeReceipt('acme  traders', 1000);
  await makeReceipt('Bilal & Sons', 4000);
  await makeReceipt('Zenith Supplies', 800);
  await makeReceipt(undefined, 600);

  // -------------------------------------------------------------------------
  // Creating suppliers
  // -------------------------------------------------------------------------

  await test('a supplier gets a readable reference', async () => {
    const created = await vendors.createVendor({ name: 'Bilal & Sons' }, String(ACTOR));
    assert.match(created.reference, /^V-\d{4}$/);
    assert.equal(created.isActive, true);
    assert.equal(created.receiptCount, 0, 'nothing is linked until names are assigned');
  });

  await test('the same name in different casing is refused', async () => {
    // The entire problem this list solves is one supplier under several spellings. Allowing
    // "acme" beside "Acme" would recreate it on day one.
    await vendors.createVendor({ name: 'Acme Traders' }, String(ACTOR));
    await rejectsWith(
      vendors.createVendor({ name: 'ACME TRADERS' }, String(ACTOR)),
      /already exists/,
    );
  });

  await test('a control account cannot be a supplier default', async () => {
    const { LedgerModel } = await import('../../models/ledger.model');
    const { AccountGroupModel } = await import('../../models/account-group.model');
    const group = await AccountGroupModel.create({
      name: 'Current Assets',
      code: '1100',
      accountType: 'asset',
      depth: 1,
      sortOrder: 1,
    });
    const control = await LedgerModel.create({
      name: 'Receivables',
      code: '1140',
      groupId: group._id,
      openingBalance: { amount: 0, asOf: null },
      cachedBalance: 0,
      cachedDebitTotal: 0,
      cachedCreditTotal: 0,
      isControl: true,
      subledgerType: 'dealer',
    });

    await rejectsWith(
      vendors.createVendor(
        { name: 'Bad Default', defaultExpenseLedgerId: String(control._id) },
        String(ACTOR),
      ),
      /control account cannot be a supplier default/,
    );
  });

  // -------------------------------------------------------------------------
  // The clean-up
  // -------------------------------------------------------------------------

  await test('every typed name is listed, worth most first', async () => {
    const { candidates, unnamedReceipts } = await vendors.extractSuppliersFromReceipts();

    const names = candidates.map((c) => c.typedName);
    assert.ok(names.includes('Acme Traders'));
    assert.ok(names.includes('ACME TRADERS'));
    assert.ok(names.includes('Bilal & Sons'));

    // Ordered by value: getting a merge wrong costs most where the money is.
    const values = candidates.map((c) => c.totalValue);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));

    // The blank-supplier receipt is counted, not silently dropped — it still holds value.
    assert.equal(unnamedReceipts, 1);
  });

  await test('spelling variants are SUGGESTED, never merged automatically', async () => {
    // A confident wrong merge attributes one supplier's goods to another and nothing downstream
    // would notice. The system proposes; a person decides.
    const { candidates } = await vendors.extractSuppliersFromReceipts();
    const variant = candidates.find((c) => c.typedName === 'Acme Traders Pvt Ltd')!;

    assert.ok(
      variant.suggestions.some((s) => s.name === 'Acme Traders'),
      'the obvious match was not suggested',
    );
    assert.equal(variant.resolvedTo, undefined, 'a variant was merged without being asked');
  });

  await test('an unrelated supplier is not suggested as a match', async () => {
    const { candidates } = await vendors.extractSuppliersFromReceipts();
    const zenith = candidates.find((c) => c.typedName === 'Zenith Supplies')!;
    assert.deepEqual(zenith.suggestions, [], 'an unrelated name was proposed as a merge');
  });

  await test('assigning names links every matching receipt, whatever the casing', async () => {
    const acme = await VendorModel.findOne({ name: 'Acme Traders' }).lean();

    const result = await vendors.assignSupplierNames(
      {
        vendorId: String(acme!._id),
        typedNames: ['Acme Traders', 'ACME TRADERS', 'Acme Traders Pvt Ltd', 'acme  traders'],
      },
      String(ACTOR),
    );

    assert.equal(result.receiptsLinked, 4, 'not every spelling was linked');
    assert.equal(result.vendor.receiptCount, 4);
    assert.equal(result.vendor.receiptValue, 11000);
  });

  await test('the receipts keep the name that was actually typed', async () => {
    // Overwriting it would rewrite a historical document and leave nothing to check a wrong
    // mapping against.
    const receipts = await StockReceiptModel.find({ supplierName: /acme/i }).lean();
    const typed = receipts.map((r) => r.supplierName).sort();
    assert.deepEqual(typed, ['ACME TRADERS', 'Acme Traders', 'Acme Traders Pvt Ltd', 'acme  traders']);
  });

  await test('what was merged stays visible on the supplier', async () => {
    const acme = await VendorModel.findOne({ name: 'Acme Traders' }).lean();
    assert.equal(acme!.mergedFromNames.length, 4);
    assert.ok(acme!.mergedFromNames.includes('Acme Traders Pvt Ltd'));
  });

  await test('an assigned name now reports which supplier it resolved to', async () => {
    const { candidates } = await vendors.extractSuppliersFromReceipts();
    const variant = candidates.find((c) => c.typedName === 'ACME TRADERS')!;
    assert.equal(variant.resolvedTo?.name, 'Acme Traders');
  });

  await test('assigning can create the supplier in the same step', async () => {
    const result = await vendors.assignSupplierNames(
      { newVendorName: 'Zenith Supplies Co', typedNames: ['Zenith Supplies'] },
      String(ACTOR),
    );
    assert.equal(result.receiptsLinked, 1);
    assert.equal(result.vendor.name, 'Zenith Supplies Co');
  });

  await test('naming both an existing supplier and a new one is refused', async () => {
    const acme = await VendorModel.findOne({ name: 'Acme Traders' }).lean();
    // Guarded in the schema too; this proves the service does not quietly pick one.
    await rejectsWith(
      vendors.assignSupplierNames(
        { vendorId: String(acme!._id), newVendorName: 'Something Else', typedNames: ['x'] },
        String(ACTOR),
      ),
      /not both/,
    );
  });

  // -------------------------------------------------------------------------
  // The placeholder
  // -------------------------------------------------------------------------

  await test('unfinished clean-up is reported honestly', async () => {
    const before = await vendors.migrationProgress();
    assert.equal(before.complete, false);
    assert.ok(before.unlinkedReceipts > 0, 'nothing was left unlinked to report');
  });

  await test('parking the rest makes the total provable', async () => {
    // Leaving them unlinked makes goods received unprovable BY SUPPLIER, which is worse than a
    // named bucket somebody can work through.
    const result = await vendors.parkUnassignedReceipts(String(ACTOR));
    assert.ok(result.receiptsLinked >= 2, 'Bilal and the blank receipt should have been parked');
    assert.equal(result.vendor.isPlaceholder, true);

    const after = await vendors.migrationProgress();
    assert.equal(after.complete, true, 'some receipt is still attached to nothing');
    assert.equal(after.unlinkedReceipts, 0);
    assert.ok(after.onPlaceholder > 0);
  });

  await test('the placeholder is obvious, not quietly plausible', async () => {
    const placeholder = await VendorModel.findOne({ isPlaceholder: true }).lean();
    assert.match(placeholder!.name, /Unidentified/);
    assert.match(placeholder!.notes ?? '', /meant to empty/);
  });

  await test('the placeholder cannot be deleted', async () => {
    const placeholder = await VendorModel.findOne({ isPlaceholder: true }).lean();
    await rejectsWith(
      vendors.deleteVendor(String(placeholder!._id), String(ACTOR)),
      /Reassign those receipts first/,
    );
  });

  // -------------------------------------------------------------------------
  // Protecting history
  // -------------------------------------------------------------------------

  await test('a supplier with receipts against it cannot be deleted', async () => {
    const acme = await VendorModel.findOne({ name: 'Acme Traders' }).lean();
    await rejectsWith(
      vendors.deleteVendor(String(acme!._id), String(ACTOR)),
      /goods receipts? name this supplier/i,
    );
  });

  await test('a supplier nothing has been received from can be deleted', async () => {
    const spare = await vendors.createVendor({ name: 'Never Used Supplies' }, String(ACTOR));
    const result = await vendors.deleteVendor(spare.id, String(ACTOR));
    assert.match(result.message, /deleted/);
  });

  await test('a supplier can be retired instead, and drops out of the default list', async () => {
    const acme = await VendorModel.findOne({ name: 'Acme Traders' }).lean();
    await vendors.updateVendor(String(acme!._id), { isActive: false }, String(ACTOR));

    const active = await vendors.listVendors({});
    assert.ok(!active.some((v) => v.name === 'Acme Traders'));

    const all = await vendors.listVendors({ status: 'all' });
    assert.ok(all.some((v) => v.name === 'Acme Traders'));
  });

  await test('searching finds a supplier by a name it was merged from', async () => {
    // Somebody looking for the spelling on an old paper receipt should still land on the right
    // supplier, not on nothing.
    const found = await vendors.listVendors({ search: 'Pvt Ltd', status: 'all' });
    assert.ok(found.some((v) => v.name === 'Acme Traders'));
  });

  await test('a search term is escaped rather than treated as a pattern', async () => {
    const results = await vendors.listVendors({ search: '.*', status: 'all' });
    assert.equal(results.length, 0, 'a regex metacharacter matched everything');
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
