/**
 * Supplier payments, against an in-memory MongoDB.
 *
 * Two failures this file exists for. A bill shown as paid when it was not — which gets a supplier
 * skipped on the next payment run while they are still owed. And one invoice settled by two
 * payments at once — which is money out of the door twice.
 *
 * Run with: npm run test:finance:payments
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { VendorModel } from '../../models/vendor.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { SupplierPaymentModel } from '../../models/supplier-payment.model';
import { FinanceLockModel } from '../../models/finance-lock.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry } from './posting.service';
import { runControlReconciliation } from './control-reconciliation.service';
import { withFinanceLocks } from './finance-locks';
import * as bills from './bills.service';
import * as payments from './payments.service';
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
const ACTOR = String(new Types.ObjectId());
const DAY = 86_400_000;

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean().exec();
  return Math.round((ledger?.cachedBalance ?? 0) * 100) / 100;
}

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

let receiptSeq = 0;

/** A goods receipt and the GRNI entry it would have written. See the bills test for why by hand. */
async function makeReceipt(vendorId: Types.ObjectId | undefined, amount: number, posted = true) {
  receiptSeq += 1;
  const receipt = await StockReceiptModel.create({
    documentNo: receiptSeq,
    receiptDate: new Date(),
    supplierName: 'Typed Name',
    vendorId,
    warehouseId: WAREHOUSE,
    products: [{ productId: PRODUCT, quantity: 1, rate: amount }],
    totalPieces: 1,
    totalAmount: amount,
    status: 'posted',
    createdBy: new Types.ObjectId(ACTOR),
  });

  if (posted) {
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
      ACTOR,
    );
  }
  return receipt;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-payments-flow-test' });
  await Promise.all([
    VendorModel.syncIndexes(),
    PurchaseBillModel.syncIndexes(),
    SupplierPaymentModel.syncIndexes(),
    FinanceLockModel.syncIndexes(),
  ]);
  await seedFinanceCounters();
  await seedFinanceChart();

  const now = new Date();
  await openPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, ACTOR);

  const acme = await vendors.createVendor({ name: 'Acme Traders', paymentTermsDays: 30 }, ACTOR);
  const bilal = await vendors.createVendor({ name: 'Bilal & Sons' }, ACTOR);
  const acmeId = new Types.ObjectId(acme.id);

  const bank = await ledgerId('1120');
  const freight = await ledgerId('6150');

  // Three posted bills: two for Acme with different due dates, one for Bilal.
  const goods = await makeReceipt(acmeId, 5000);
  const b1 = await bills.createBill(
    {
      vendorId: acme.id,
      supplierBillNo: 'A-1',
      billDate: now,
      matchedReceipts: [{ receiptId: String(goods._id) }],
    },
    ACTOR,
  );
  await bills.postBill(b1.id, ACTOR);

  const b2 = await bills.createBill(
    {
      vendorId: acme.id,
      supplierBillNo: 'A-2',
      billDate: now,
      dueDate: new Date(now.getTime() + 45 * DAY),
      lines: [{ description: 'Handling', ledgerId: freight, amount: 2000 }],
    },
    ACTOR,
  );
  await bills.postBill(b2.id, ACTOR);

  const b3 = await bills.createBill(
    {
      vendorId: bilal.id,
      supplierBillNo: 'Z-1',
      billDate: now,
      lines: [{ description: 'Freight', ledgerId: freight, amount: 800 }],
    },
    ACTOR,
  );
  await bills.postBill(b3.id, ACTOR);

  // -------------------------------------------------------------------------
  // What can be paid
  // -------------------------------------------------------------------------

  await test('unpaid bills are offered oldest due date first', async () => {
    const open = await payments.openBillsForVendor(acme.id);
    assert.deepEqual(open.map((b) => b.id), [b1.id, b2.id]);
    assert.equal(open[0].outstanding, 5000);
    assert.equal(open[1].outstanding, 2000);
  });

  await test('the books start out owing every bill in full', async () => {
    assert.equal(await balance('2110'), 7800);
  });

  // -------------------------------------------------------------------------
  // Drafting, and what is refused
  // -------------------------------------------------------------------------

  let bankPaymentId = '';

  await test('a draft payment moves nothing and uses no number', async () => {
    const draft = await payments.createPayment(
      {
        vendorId: acme.id,
        paymentDate: now,
        method: 'bank_transfer',
        paidFromLedgerId: bank,
        transferReference: 'IBFT-7781',
        amount: 3000,
        allocations: [{ billId: b1.id }],
      },
      ACTOR,
    );
    bankPaymentId = draft.id;

    assert.equal(draft.reference, 'Draft');
    // Defaulted to the smaller of what the bill is owed and what the payment is for.
    assert.equal(draft.allocations[0].amount, 3000);
    assert.equal(await balance('2110'), 7800, 'a draft reduced what is owed');
    assert.equal(await balance('1120'), 0, 'a draft took money out of the bank');
  });

  await test('a payment cannot come out of an account that holds no money', async () => {
    await rejectsWith(
      payments.createPayment(
        {
          vendorId: acme.id,
          paymentDate: now,
          method: 'cash',
          paidFromLedgerId: freight,
          amount: 100,
        },
        ACTOR,
      ),
      /not a cash or bank account/,
    );
  });

  await test('a payment cannot come out of an account another module owns', async () => {
    // Paying a supplier out of rider cash or receivables would make a rider look short, or a
    // shop look like it paid, with nothing in either module to explain it.
    await rejectsWith(
      payments.createPayment(
        {
          vendorId: acme.id,
          paymentDate: now,
          method: 'cash',
          paidFromLedgerId: await ledgerId('1140'),
          amount: 100,
        },
        ACTOR,
      ),
      /belongs to its own module/,
    );
  });

  await test("another supplier's bill cannot be paid", async () => {
    await rejectsWith(
      payments.createPayment(
        {
          vendorId: bilal.id,
          paymentDate: now,
          method: 'bank_transfer',
          paidFromLedgerId: bank,
          amount: 1000,
          allocations: [{ billId: b1.id }],
        },
        ACTOR,
      ),
      /from a different supplier/,
    );
  });

  await test('a bill cannot be settled past what it is for', async () => {
    await rejectsWith(
      payments.createPayment(
        {
          vendorId: acme.id,
          paymentDate: now,
          method: 'bank_transfer',
          paidFromLedgerId: bank,
          amount: 6000,
          allocations: [{ billId: b1.id, amount: 5500 }],
        },
        ACTOR,
      ),
      /only has 5000\.00 left to pay/,
    );
  });

  await test('the bills on a payment cannot add up to more than the payment', async () => {
    await rejectsWith(
      payments.createPayment(
        {
          vendorId: acme.id,
          paymentDate: now,
          method: 'bank_transfer',
          paidFromLedgerId: bank,
          amount: 1000,
          allocations: [
            { billId: b1.id, amount: 800 },
            { billId: b2.id, amount: 800 },
          ],
        },
        ACTOR,
      ),
      /add up to more than the payment/,
    );
  });

  await test('a cheque needs its number', async () => {
    await rejectsWith(
      payments.createPayment(
        {
          vendorId: acme.id,
          paymentDate: now,
          method: 'cheque',
          paidFromLedgerId: bank,
          amount: 100,
        },
        ACTOR,
      ),
      /cheque needs its cheque number/,
    );
  });

  await test('the holding record cannot be paid', async () => {
    await makeReceipt(undefined, 50, false);
    await vendors.parkUnassignedReceipts(ACTOR);
    const placeholder = await VendorModel.findOne({ isPlaceholder: true }).lean();

    await rejectsWith(
      payments.createPayment(
        {
          vendorId: String(placeholder!._id),
          paymentDate: now,
          method: 'cash',
          paidFromLedgerId: await ledgerId('1110'),
          amount: 50,
        },
        ACTOR,
      ),
      /holding record/,
    );
  });

  // -------------------------------------------------------------------------
  // Posting
  // -------------------------------------------------------------------------

  await test('posting takes the money out and reduces what is owed', async () => {
    const posted = await payments.postPayment(bankPaymentId, ACTOR);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.reference, 'P-0001');

    assert.equal(await balance('2110'), 4800, 'what is owed did not fall');
    assert.equal(await balance('1120'), -3000, 'the money did not leave the bank');
  });

  await test('the payable is reduced against the right supplier', async () => {
    const line = await JournalLineModel.findOne({
      ledgerId: new Types.ObjectId(await ledgerId('2110')),
      debit: 3000,
    }).lean();
    assert.equal(line!.subledgerRef?.type, 'vendor');
    assert.equal(String(line!.subledgerRef?.id), acme.id);
  });

  await test('posting twice does not pay twice', async () => {
    const again = await payments.postPayment(bankPaymentId, ACTOR);
    assert.equal(again.reference, 'P-0001', 'a second payment number was used');
    assert.equal(await balance('2110'), 4800, 'the supplier was paid twice');
  });

  await test('the bill shows what has been paid and what is left', async () => {
    const bill = await bills.getBill(b1.id);
    assert.equal(bill.paidAmount, 3000);
    assert.equal(bill.outstanding, 2000);
    assert.equal(bill.paymentStatus, 'part_paid');
    assert.equal(bill.payments.length, 1);
    assert.equal(bill.payments[0].reference, 'P-0001');
  });

  let chequePaymentId = '';

  await test('a cheque does not touch the bank until it clears', async () => {
    const draft = await payments.createPayment(
      {
        vendorId: acme.id,
        paymentDate: now,
        method: 'cheque',
        paidFromLedgerId: bank,
        chequeNo: '000123',
        amount: 2500,
        allocations: [{ billId: b1.id }],
      },
      ACTOR,
    );
    chequePaymentId = draft.id;
    await payments.postPayment(draft.id, ACTOR);

    assert.equal(await balance('1120'), -3000, 'the bank moved for a cheque that has not cleared');
    assert.equal(await balance('1125'), -2500, 'the cheque was not held as uncleared');
    assert.equal(await balance('2110'), 2300);
  });

  await test('a bill paid in full drops off the list of what can be paid', async () => {
    const bill = await bills.getBill(b1.id);
    assert.equal(bill.paymentStatus, 'paid');
    assert.equal(bill.outstanding, 0);

    const open = await payments.openBillsForVendor(acme.id);
    assert.deepEqual(open.map((b) => b.id), [b2.id]);
  });

  await test('money paid beyond the bills stays on account against the supplier', async () => {
    const cheque = await payments.getPayment(chequePaymentId);
    assert.equal(cheque.allocatedAmount, 2000);
    assert.equal(cheque.unallocatedAmount, 500);

    // What the supplier is owed comes from the ledger, so the 500 on account already counts.
    const listed = await vendors.listVendors({});
    assert.equal(listed.find((v) => v.id === acme.id)!.payableBalance, 1500);
    assert.equal(listed.find((v) => v.id === bilal.id)!.payableBalance, 800);
  });

  await test('one cheque leaf cannot be entered twice', async () => {
    await rejectsWith(
      payments.createPayment(
        {
          vendorId: acme.id,
          paymentDate: now,
          method: 'cheque',
          paidFromLedgerId: bank,
          chequeNo: '000123',
          amount: 100,
        },
        ACTOR,
      ),
      /Cheque 000123 from this account is already recorded as payment P-0002/,
    );
  });

  await test('a bill that has been paid cannot be cancelled', async () => {
    // Cancelling it would reverse the debt while leaving the payments standing against nothing.
    await rejectsWith(bills.cancelBill(b1.id, 'Wrong supplier', ACTOR), /paid against this bill/);
  });

  await test('what we owe suppliers agrees with bills minus payments', async () => {
    const { checks } = await runControlReconciliation();
    const ap = checks.find((c) => c.checkId === 'ap-trade')!;
    assert.equal(ap.breakdown.postedBills, 7800);
    assert.equal(ap.breakdown.postedPayments, 5500);
    assert.equal(ap.operationalValue, 2300);
    assert.equal(ap.ok, true, 'the payables account disagrees with the bills and payments');
  });

  // -------------------------------------------------------------------------
  // Cancelling
  // -------------------------------------------------------------------------

  await test('cancelling a payment reverses it and puts the bill back to unpaid', async () => {
    const cancelled = await payments.cancelPayment(bankPaymentId, 'Transfer bounced', ACTOR);
    assert.equal(cancelled.status, 'cancelled');

    assert.equal(await balance('2110'), 5300, 'the supplier is not owed the money again');
    assert.equal(await balance('1120'), 0, 'the money did not come back to the bank');

    const bill = await bills.getBill(b1.id);
    assert.equal(bill.paidAmount, 2000);
    assert.equal(bill.outstanding, 3000);
    assert.equal(bill.paymentStatus, 'part_paid');
  });

  await test('a cancelled payment cannot be edited, posted, or cancelled again', async () => {
    await rejectsWith(
      payments.updatePayment(
        bankPaymentId,
        {
          vendorId: acme.id,
          paymentDate: now,
          method: 'cash',
          paidFromLedgerId: bank,
          amount: 1,
        },
        ACTOR,
      ),
      /cannot be edited/,
    );
    await rejectsWith(payments.postPayment(bankPaymentId, ACTOR), /cannot be posted/);
    await rejectsWith(payments.cancelPayment(bankPaymentId, 'Again', ACTOR), /already been cancelled/);
  });

  await test('the books still agree after the cancellation', async () => {
    const { checks } = await runControlReconciliation();
    const ap = checks.find((c) => c.checkId === 'ap-trade')!;
    assert.equal(ap.operationalValue, 5300);
    assert.equal(ap.ok, true);
  });

  // -------------------------------------------------------------------------
  // Cheques clearing
  // -------------------------------------------------------------------------

  await test('uncleared cheques can be listed on their own', async () => {
    const uncleared = await payments.listPayments({ unclearedCheques: true });
    assert.deepEqual(uncleared.map((p) => p.id), [chequePaymentId]);
    assert.equal(uncleared[0].isChequeUncleared, true);
  });

  await test('only a cheque clears', async () => {
    await rejectsWith(payments.clearCheque(bankPaymentId, now, ACTOR), /Only a cheque clears/);
  });

  await test('a cheque cannot clear before it was written', async () => {
    await rejectsWith(
      payments.clearCheque(chequePaymentId, new Date(now.getTime() - 2 * DAY), ACTOR),
      /cannot clear before it was written/,
    );
  });

  await test('clearing a cheque moves it out of uncleared and into the bank', async () => {
    const cleared = await payments.clearCheque(chequePaymentId, now, ACTOR);
    assert.ok(cleared.chequeClearedAt, 'the clearing date was not recorded');
    assert.equal(cleared.isChequeUncleared, false);

    assert.equal(await balance('1125'), 0, 'the cheque is still held as uncleared');
    assert.equal(await balance('1120'), -2500, 'the money did not leave the bank when it cleared');
    assert.equal(await balance('2110'), 5300, 'clearing a cheque changed what the supplier is owed');

    assert.equal((await payments.listPayments({ unclearedCheques: true })).length, 0);
  });

  await test('a cheque cannot clear twice', async () => {
    await rejectsWith(payments.clearCheque(chequePaymentId, now, ACTOR), /already marked cleared/);
  });

  await test('a cheque that has cleared can no longer be cancelled', async () => {
    // The money has left the bank. Reversing the payment would put it back in the books while
    // the bank statement says it is gone.
    await rejectsWith(
      payments.cancelPayment(chequePaymentId, 'Changed our mind', ACTOR),
      /has cleared/,
    );
  });

  // -------------------------------------------------------------------------
  // Two payments at once
  // -------------------------------------------------------------------------

  await test('two payments posted at the same moment cannot both settle one bill', async () => {
    const drafts = await Promise.all(
      ['IBFT-1', 'IBFT-2'].map((ref) =>
        payments.createPayment(
          {
            vendorId: acme.id,
            paymentDate: now,
            method: 'bank_transfer',
            paidFromLedgerId: bank,
            transferReference: ref,
            amount: 2000,
            allocations: [{ billId: b2.id, amount: 2000 }],
          },
          ACTOR,
        ),
      ),
    );

    const results = await Promise.allSettled(
      drafts.map((d) => payments.postPayment(d.id, ACTOR)),
    );
    assert.equal(
      results.filter((r) => r.status === 'fulfilled').length,
      1,
      'the same invoice was paid twice',
    );

    const bill = await bills.getBill(b2.id);
    assert.equal(bill.paidAmount, 2000);

    const { checks } = await runControlReconciliation();
    assert.equal(checks.find((c) => c.checkId === 'ap-trade')!.ok, true);
  });

  // -------------------------------------------------------------------------
  // The lock itself
  // -------------------------------------------------------------------------

  await test('a lock refuses a second holder, and is released afterwards', async () => {
    await withFinanceLocks(['test:held'], async () => {
      await rejectsWith(
        withFinanceLocks(['test:held'], async () => 'should not run'),
        /working on this right now/,
      );
    });
    assert.equal(await FinanceLockModel.countDocuments({ _id: 'test:held' }), 0);
  });

  await test('a lease left behind by a crash is taken over once it expires', async () => {
    await FinanceLockModel.create({
      _id: 'test:stale',
      holder: 'a process that died',
      expiresAt: new Date(Date.now() - 1000),
    });
    assert.equal(await withFinanceLocks(['test:stale'], async () => 'ran'), 'ran');

    await FinanceLockModel.create({
      _id: 'test:live',
      holder: 'somebody still working',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await rejectsWith(
      withFinanceLocks(['test:live'], async () => 'should not run'),
      /working on this right now/,
    );
  });

  await test('a lock is released even when the work inside it fails', async () => {
    await rejectsWith(
      withFinanceLocks(['test:boom'], async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(await FinanceLockModel.countDocuments({ _id: 'test:boom' }), 0);
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
