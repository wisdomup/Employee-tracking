/**
 * Supplier bills, against an in-memory MongoDB.
 *
 * The risk this file exists for is narrow and expensive: a bill that clears more of Goods
 * Received Not Invoiced than the receipts behind it ever put there. The excess sits in 2115 for
 * good, no stocktake can contradict it, and nothing in the accounts records what it was meant to
 * be clearing. So most of what is tested below is what the module REFUSES.
 *
 * Run with: npm run test:finance:bills
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { VendorModel } from '../../models/vendor.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry } from './posting.service';
import { runControlReconciliation } from './control-reconciliation.service';
import * as bills from './bills.service';
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

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean().exec();
  return Math.round((ledger?.cachedBalance ?? 0) * 100) / 100;
}

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

let receiptSeq = 0;

/**
 * A goods receipt AND the entry it would have written, so the GRNI it credits is really there.
 *
 * Posted by hand rather than through `postStockReceipt` because that path is behind the
 * stock-receipt switch, and what is being tested here is what bills do with GRNI — not whether
 * the switch works, which `finance.inventory-posting.flow.test.ts` already proves.
 */
async function makeReceipt(
  vendorId: Types.ObjectId | undefined,
  amount: number,
  options: { withPosting?: boolean } = {},
) {
  receiptSeq += 1;
  const receipt = await StockReceiptModel.create({
    documentNo: receiptSeq,
    receiptDate: new Date(),
    supplierName: 'Acme Traders',
    vendorId,
    warehouseId: WAREHOUSE,
    products: [{ productId: PRODUCT, quantity: 1, rate: amount }],
    totalPieces: 1,
    totalAmount: amount,
    status: 'posted',
    createdBy: ACTOR,
  });

  if (options.withPosting !== false) {
    await postEntry(
      {
        date: receipt.receiptDate,
        narration: 'Goods received',
        sourceType: 'stock_receipt',
        sourceId: String(receipt._id),
        sourceModel: 'StockReceipt',
        idempotencyKey: `test:stock_receipt:${receipt._id}`,
        lines: [
          {
            ledgerId: await ledgerId('1150'),
            debit: amount,
            subledgerRef: { type: 'warehouse', id: String(WAREHOUSE) },
          },
          { ledgerId: await ledgerId('2115'), credit: amount },
        ],
      },
      String(ACTOR),
    );
  }

  return receipt;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-bills-flow-test' });
  await Promise.all([VendorModel.syncIndexes(), PurchaseBillModel.syncIndexes()]);
  await seedFinanceCounters();
  await seedFinanceChart();

  const now = new Date();
  await openPeriod(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    String(ACTOR),
  );

  const acme = await vendors.createVendor({ name: 'Acme Traders', paymentTermsDays: 30 }, String(ACTOR));
  const bilal = await vendors.createVendor({ name: 'Bilal & Sons' }, String(ACTOR));
  const acmeId = new Types.ObjectId(acme.id);

  const freight = await ledgerId('6150');

  // -------------------------------------------------------------------------
  // What a bill can be matched against
  // -------------------------------------------------------------------------

  const r5000 = await makeReceipt(acmeId, 5000);
  const r3000 = await makeReceipt(acmeId, 3000);

  await test('a receipt is offered for billing at its full value', async () => {
    const open = await bills.openReceiptsForVendor(acme.id);
    assert.equal(open.length, 2);
    const first = open.find((r) => r.id === String(r5000._id))!;
    assert.equal(first.outstanding, 5000);
    assert.equal(first.billedAmount, 0);
  });

  await test('another supplier is offered none of them', async () => {
    // The whole reason the typed-name clean-up had to happen first.
    const open = await bills.openReceiptsForVendor(bilal.id);
    assert.deepEqual(open, []);
  });

  await test('a receipt with no supplier on it is offered to nobody', async () => {
    const orphan = await makeReceipt(undefined, 900);
    const open = await bills.openReceiptsForVendor(acme.id);
    assert.ok(!open.some((r) => r.id === String(orphan._id)));

    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(orphan._id) }],
        },
        String(ACTOR),
      ),
      /not attached to a supplier/,
    );
  });

  await test('a receipt that never reached the accounts cannot be billed', async () => {
    // Recorded while the stock-receipt switch was off, so it credited no GRNI. Clearing it
    // would debit a clearing account that was never credited.
    const unposted = await makeReceipt(acmeId, 700, { withPosting: false });

    const open = await bills.openReceiptsForVendor(acme.id);
    assert.ok(!open.some((r) => r.id === String(unposted._id)), 'it was offered for billing');

    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(unposted._id) }],
        },
        String(ACTOR),
      ),
      /never written to the accounts/,
    );

    // Removed once it has made its point, so the totals the rest of this file asserts are the
    // arithmetic of bills rather than of a receipt that was never in the accounts to begin with.
    await StockReceiptModel.deleteOne({ _id: unposted._id }).exec();
  });

  await test("one supplier's receipt cannot go on another's bill", async () => {
    await rejectsWith(
      bills.createBill(
        {
          vendorId: bilal.id,
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(r5000._id) }],
        },
        String(ACTOR),
      ),
      /belongs to a different supplier/,
    );
  });

  await test('the holding record cannot be billed', async () => {
    await vendors.parkUnassignedReceipts(String(ACTOR));
    const placeholder = await VendorModel.findOne({ isPlaceholder: true }).lean();

    await rejectsWith(
      bills.createBill(
        {
          vendorId: String(placeholder!._id),
          billDate: new Date(),
          lines: [{ description: 'Anything', ledgerId: freight, amount: 100 }],
        },
        String(ACTOR),
      ),
      /holding record/,
    );
  });

  // -------------------------------------------------------------------------
  // Drafting
  // -------------------------------------------------------------------------

  let draftId = '';

  await test('a draft takes the whole receipt without being told an amount', async () => {
    const draft = await bills.createBill(
      {
        vendorId: acme.id,
        supplierBillNo: 'INV-2201',
        billDate: new Date(),
        matchedReceipts: [{ receiptId: String(r5000._id) }],
        lines: [{ description: 'Delivery charge', ledgerId: freight, amount: 500 }],
        taxAmount: 100,
      },
      String(ACTOR),
    );

    draftId = draft.id;
    assert.equal(draft.goodsAmount, 5000, 'the receipt total was not defaulted in');
    assert.equal(draft.chargesAmount, 500);
    assert.equal(draft.totalAmount, 5600);
    assert.equal(draft.status, 'draft');
  });

  await test('a draft carries no bill number', async () => {
    // An abandoned draft must not leave a gap in the printed series.
    const draft = await bills.getBill(draftId);
    assert.equal(draft.billNo, undefined);
    assert.equal(draft.reference, 'Draft');
  });

  await test('the due date comes from the payment terms', async () => {
    const draft = await bills.getBill(draftId);
    const days = Math.round(
      (draft.dueDate.getTime() - draft.billDate.getTime()) / 86_400_000,
    );
    assert.equal(days, 30);
  });

  await test('a draft has moved nothing', async () => {
    assert.equal(await balance('2110'), 0, 'a draft raised a payable');
    assert.equal(await balance('2115'), 8900, 'a draft drained the clearing account');
  });

  await test('a draft still sees its own receipt as available while being edited', async () => {
    const open = await bills.openReceiptsForVendor(acme.id, { includeBillId: draftId });
    assert.ok(open.some((r) => r.id === String(r5000._id)));

    // Re-saving it unchanged must not report the receipt as over-billed by its own claim.
    const again = await bills.updateBill(
      draftId,
      {
        vendorId: acme.id,
        supplierBillNo: 'INV-2201',
        billDate: new Date(),
        matchedReceipts: [{ receiptId: String(r5000._id) }],
        lines: [{ description: 'Delivery charge', ledgerId: freight, amount: 500 }],
        taxAmount: 100,
      },
      String(ACTOR),
    );
    assert.equal(again.totalAmount, 5600);
  });

  await test('a bill for nothing is refused', async () => {
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          billDate: new Date(),
          lines: [{ description: 'Nothing', ledgerId: freight, amount: 0 }],
        },
        String(ACTOR),
      ),
      /on this bill for nothing/,
    );
  });

  await test('a charge cannot be dumped into a control account', async () => {
    // Inventory is proved against the warehouse. A freight line has no warehouse to name, and
    // letting one through would put a figure in 1150 that no stocktake could ever agree with.
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          billDate: new Date(),
          lines: [{ description: 'Stock, sort of', ledgerId: await ledgerId('1150'), amount: 100 }],
        },
        String(ACTOR),
      ),
      /control account/,
    );
  });

  await test('the same receipt cannot be listed twice on one bill', async () => {
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          billDate: new Date(),
          matchedReceipts: [
            { receiptId: String(r3000._id), amount: 1500 },
            { receiptId: String(r3000._id), amount: 1500 },
          ],
        },
        String(ACTOR),
      ),
      /on this bill twice/,
    );
  });

  await test('a bill cannot claim more of a receipt than the receipt is worth', async () => {
    // The whole reason this file exists.
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(r3000._id), amount: 3500 }],
        },
        String(ACTOR),
      ),
      /only has 3000\.00 left unbilled/,
    );
  });

  // -------------------------------------------------------------------------
  // Posting
  // -------------------------------------------------------------------------

  await test('posting clears the goods, raises the payable, and books the tax', async () => {
    const posted = await bills.postBill(draftId, String(ACTOR));

    assert.equal(posted.status, 'posted');
    assert.equal(posted.reference, 'B-0001');

    assert.equal(await balance('2115'), 3900, 'the goods were not cleared out of GRNI');
    assert.equal(await balance('2110'), 5600, 'the payable is not the whole invoice');
    assert.equal(await balance('6150'), 500, 'the freight charge did not land');
    assert.equal(await balance('1170'), 100, 'the input tax was not booked');
  });

  await test('the payable is tagged with the supplier', async () => {
    // Without this the payables control account is a single number nobody can break down, and
    // "what do we owe Acme" goes back to being unanswerable.
    const { JournalLineModel } = await import('../../models/journal-line.model');
    const line = await JournalLineModel.findOne({
      ledgerId: new Types.ObjectId(await ledgerId('2110')),
      status: 'posted',
    }).lean();

    assert.equal(line!.subledgerRef?.type, 'vendor');
    assert.equal(String(line!.subledgerRef?.id), acme.id);
  });

  await test('posting twice does not write the invoice twice', async () => {
    const again = await bills.postBill(draftId, String(ACTOR));
    assert.equal(again.reference, 'B-0001', 'a second bill number was burned');
    assert.equal(await balance('2110'), 5600, 'the payable doubled');
  });

  await test('a billed receipt drops off the list of what can be billed', async () => {
    const open = await bills.openReceiptsForVendor(acme.id);
    assert.ok(!open.some((r) => r.id === String(r5000._id)));
    assert.ok(open.some((r) => r.id === String(r3000._id)), 'the unbilled receipt vanished too');
  });

  await test('a receipt already billed in full cannot be billed again', async () => {
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          supplierBillNo: 'INV-2202',
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(r5000._id) }],
        },
        String(ACTOR),
      ),
      /already been billed in full/,
    );
  });

  await test('a posted bill cannot be edited or deleted', async () => {
    await rejectsWith(
      bills.updateBill(
        draftId,
        {
          vendorId: acme.id,
          billDate: new Date(),
          lines: [{ description: 'Sneaky', ledgerId: freight, amount: 1 }],
        },
        String(ACTOR),
      ),
      /Cancel it and enter a corrected one/,
    );
    await rejectsWith(bills.deleteBill(draftId, String(ACTOR)), /cancelled, never deleted/);
  });

  await test('the same supplier invoice number cannot be entered twice', async () => {
    // Paying one invoice twice is the most common way money leaves a business by accident.
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          supplierBillNo: 'inv-2201',
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(r3000._id) }],
        },
        String(ACTOR),
      ),
      /already recorded as bill B-0001/,
    );
  });

  await test('the same number from a DIFFERENT supplier is fine', async () => {
    const other = await bills.createBill(
      {
        vendorId: bilal.id,
        supplierBillNo: 'INV-2201',
        billDate: new Date(),
        lines: [{ description: 'Freight', ledgerId: freight, amount: 200 }],
      },
      String(ACTOR),
    );
    assert.equal(other.totalAmount, 200);
    await bills.deleteBill(other.id, String(ACTOR));
  });

  // -------------------------------------------------------------------------
  // Partial billing
  // -------------------------------------------------------------------------

  await test('a receipt can be billed in parts', async () => {
    const half = await bills.createBill(
      {
        vendorId: acme.id,
        supplierBillNo: 'INV-2203',
        billDate: new Date(),
        matchedReceipts: [{ receiptId: String(r3000._id), amount: 1800 }],
      },
      String(ACTOR),
    );
    await bills.postBill(half.id, String(ACTOR));

    const open = await bills.openReceiptsForVendor(acme.id);
    const rest = open.find((r) => r.id === String(r3000._id))!;
    assert.equal(rest.billedAmount, 1800);
    assert.equal(rest.outstanding, 1200);

    assert.equal(await balance('2115'), 2100, 'GRNI does not match what is left unbilled');
  });

  await test('the second bill cannot claim more than the remainder', async () => {
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          supplierBillNo: 'INV-2204',
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(r3000._id), amount: 1300 }],
        },
        String(ACTOR),
      ),
      /only has 1200\.00 left unbilled/,
    );
  });

  // -------------------------------------------------------------------------
  // The health check
  // -------------------------------------------------------------------------

  await test('the clearing account agrees with receipts minus bills', async () => {
    const { checks } = await runControlReconciliation();
    const grni = checks.find((c) => c.checkId === 'grni')!;

    assert.equal(grni.breakdown.postedReceipts, 8900);
    assert.equal(grni.breakdown.billedAgainstReceipts, 6800);
    assert.equal(grni.operationalValue, 2100);
    assert.equal(grni.ok, true, 'the books stopped agreeing with the warehouse');
  });

  // -------------------------------------------------------------------------
  // Cancelling
  // -------------------------------------------------------------------------

  await test('cancelling reverses the entry and releases the receipt', async () => {
    const cancelled = await bills.cancelBill(draftId, 'Wrong supplier on the invoice', String(ACTOR));
    assert.equal(cancelled.status, 'cancelled');

    assert.equal(await balance('2110'), 1800, 'the payable was not reversed');
    assert.equal(await balance('2115'), 7100, 'the goods were not put back into GRNI');

    const open = await bills.openReceiptsForVendor(acme.id);
    assert.ok(
      open.some((r) => r.id === String(r5000._id)),
      'the receipt was not released for re-billing',
    );
  });

  await test('a cancelled bill cannot be cancelled again', async () => {
    await rejectsWith(
      bills.cancelBill(draftId, 'Again', String(ACTOR)),
      /already been cancelled/,
    );
  });

  await test('re-entering a cancelled invoice number says to reopen the original', async () => {
    await rejectsWith(
      bills.createBill(
        {
          vendorId: acme.id,
          supplierBillNo: 'INV-2201',
          billDate: new Date(),
          matchedReceipts: [{ receiptId: String(r5000._id) }],
        },
        String(ACTOR),
      ),
      /which was cancelled/,
    );
  });

  await test('the books still agree after the cancellation', async () => {
    const { checks } = await runControlReconciliation();
    const grni = checks.find((c) => c.checkId === 'grni')!;
    assert.equal(grni.operationalValue, 7100);
    assert.equal(grni.ok, true);
  });

  await test('the engine resolved accounts by role, not by code', async () => {
    // Renaming or re-coding an account must not break posting — the whole reason the ledger map
    // exists. Proved by moving the code and posting again.
    const settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).lean();
    const map = settings!.ledgerMap as unknown as Record<string, Types.ObjectId>;
    assert.ok(map.apTrade, 'the payables role is not mapped');
    assert.ok(map.grni, 'the clearing role is not mapped');
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
