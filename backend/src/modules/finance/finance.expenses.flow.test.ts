/**
 * Expenses and their approval, against an in-memory MongoDB.
 *
 * The rule under test: nothing reaches the accounts until a second person approves it, or its
 * category says it does not need to be. Most of what follows is the ways around that rule, and
 * proof that each one is closed.
 *
 * Run with: npm run test:finance:expenses
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { VendorModel } from '../../models/vendor.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { ExpenseModel } from '../../models/expense.model';
import { ExpenseCategoryModel } from '../../models/expense-category.model';
import { SupplierPaymentModel } from '../../models/supplier-payment.model';
import { POSTING_EVENT_KEYS } from '../../models/finance-settings.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import * as expenses from './expenses.service';
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

const SUBMITTER = String(new Types.ObjectId());
const APPROVER = String(new Types.ObjectId());
const SECOND_APPROVER = String(new Types.ObjectId());
const DAY = 86_400_000;

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean().exec();
  return Math.round((ledger?.cachedBalance ?? 0) * 100) / 100;
}

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

async function categoryId(name: string): Promise<string> {
  const category = await ExpenseCategoryModel.findOne({ name }).select('_id').lean().exec();
  return String(category!._id);
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-expenses-flow-test' });
  await Promise.all([
    ExpenseModel.syncIndexes(),
    ExpenseCategoryModel.syncIndexes(),
    SupplierPaymentModel.syncIndexes(),
    VendorModel.syncIndexes(),
  ]);
  await seedFinanceCounters();
  await seedFinanceChart();

  const now = new Date();
  await openPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, APPROVER);

  const cash = await ledgerId('1110');
  const bank = await ledgerId('1120');
  const receipt = ['/api/uploads/expenses/receipt.jpg'];

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  await test('default categories are seeded once, each on an expense account', async () => {
    const first = await expenses.seedDefaultExpenseCategories();
    assert.ok(first.created.includes('Rent'));
    assert.ok(first.created.includes('Petty cash'));

    const again = await expenses.seedDefaultExpenseCategories();
    assert.deepEqual(again.created, [], 'the defaults were seeded a second time');

    const rent = (await expenses.listCategories()).find((c) => c.name === 'Rent')!;
    assert.equal(rent.ledgerCode, '6130');
    assert.equal(rent.requiresApproval, true);
  });

  await test('a category cannot post to a control account', async () => {
    await rejectsWith(
      expenses.createCategory({ name: 'Sneaky', ledgerId: await ledgerId('1140') }, APPROVER),
      /control account/,
    );
  });

  await test('a category cannot post to an account that is not an expense', async () => {
    // Spending posted to an asset would never appear on the profit and loss statement, and
    // profit would read too high by exactly that much.
    await rejectsWith(
      expenses.createCategory({ name: 'Hidden', ledgerId: cash }, APPROVER),
      /not an expense account/,
    );
  });

  await test('category names are unique whatever the casing', async () => {
    await rejectsWith(
      expenses.createCategory({ name: 'rent', ledgerId: await ledgerId('6130') }, APPROVER),
      /already exists/,
    );
  });

  // -------------------------------------------------------------------------
  // Straight through
  // -------------------------------------------------------------------------

  const warehouse = await WarehouseModel.create({
    name: 'Lahore Main',
    city: 'Lahore',
    cityKey: 'lahore',
    isMain: true,
  });

  let pettyId = '';

  await test('a draft expense posts nothing', async () => {
    const draft = await expenses.createExpense(
      {
        categoryId: await categoryId('Petty cash'),
        expenseDate: now,
        description: 'Tea and biscuits for the warehouse',
        amount: 500,
        method: 'cash',
        paidFromLedgerId: cash,
        payeeName: 'Corner shop',
        warehouseId: String(warehouse._id),
      },
      SUBMITTER,
    );
    pettyId = draft.id;

    assert.equal(draft.status, 'draft');
    assert.equal(draft.reference, 'Draft');
    assert.equal(draft.approvalNeeded, null, 'a small petty-cash expense was flagged for approval');
    assert.equal(await balance('6900'), 0);
  });

  await test('a petty-cash expense under its limit posts the moment it is submitted', async () => {
    const posted = await expenses.submitExpense(pettyId, SUBMITTER);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.reference, 'E-0001');

    assert.equal(await balance('6900'), 500);
    assert.equal(await balance('1110'), -500);
  });

  await test('the entry carries the city of the warehouse it was for', async () => {
    const entry = await JournalEntryModel.findOne({ sourceType: 'expense', sourceId: pettyId }).lean();
    assert.equal(entry!.cityKey, 'lahore');
  });

  // -------------------------------------------------------------------------
  // Waiting for approval
  // -------------------------------------------------------------------------

  let bigPettyId = '';
  let rentId = '';

  await test('a petty-cash expense above its limit waits for approval', async () => {
    const draft = await expenses.createExpense(
      {
        categoryId: await categoryId('Petty cash'),
        expenseDate: now,
        description: 'Folding tables',
        amount: 2500,
        method: 'cash',
        paidFromLedgerId: cash,
      },
      SUBMITTER,
    );
    bigPettyId = draft.id;
    assert.match(draft.approvalNeeded ?? '', /up to 2000\.00/);

    const submitted = await expenses.submitExpense(draft.id, SUBMITTER);
    assert.equal(submitted.status, 'pending_approval');
    assert.equal(await balance('6900'), 500, 'an expense waiting for approval posted');
  });

  await test('a rent expense cannot be submitted without its receipt', async () => {
    const draft = await expenses.createExpense(
      {
        categoryId: await categoryId('Rent'),
        expenseDate: now,
        description: 'Warehouse rent, this month',
        amount: 30000,
        method: 'bank_transfer',
        paidFromLedgerId: bank,
        transferReference: 'IBFT-RENT',
      },
      SUBMITTER,
    );
    rentId = draft.id;
    await rejectsWith(expenses.submitExpense(rentId, SUBMITTER), /receipt attached/);
  });

  await test('with its receipt, rent queues for approval and posts nothing', async () => {
    const withReceipt = await expenses.updateExpense(
      rentId,
      {
        categoryId: await categoryId('Rent'),
        expenseDate: now,
        description: 'Warehouse rent, this month',
        amount: 30000,
        method: 'bank_transfer',
        paidFromLedgerId: bank,
        transferReference: 'IBFT-RENT',
        attachments: receipt,
      },
      SUBMITTER,
    );
    assert.match(withReceipt.approvalNeeded ?? '', /Every "Rent" expense/);

    const submitted = await expenses.submitExpense(rentId, SUBMITTER);
    assert.equal(submitted.status, 'pending_approval');
    assert.equal(submitted.reference, 'Draft', 'a number was used before posting');
    assert.equal(await balance('6130'), 0);
  });

  await test('a waiting expense cannot be edited under the approver', async () => {
    await rejectsWith(
      expenses.updateExpense(
        rentId,
        {
          categoryId: await categoryId('Rent'),
          expenseDate: now,
          description: 'Warehouse rent, this month',
          amount: 1,
          method: 'bank_transfer',
          paidFromLedgerId: bank,
          attachments: receipt,
        },
        SUBMITTER,
      ),
      /waiting for approval/,
    );
  });

  await test('whoever submitted an expense cannot approve it', async () => {
    await rejectsWith(expenses.approveExpense(rentId, SUBMITTER), /somebody else has to approve it/);
    assert.equal(await balance('6130'), 0);
  });

  await test('approval by a second person posts it', async () => {
    const approved = await expenses.approveExpense(rentId, APPROVER);
    assert.equal(approved.status, 'posted');
    assert.equal(approved.reference, 'E-0002');
    assert.equal(approved.approvedBy, APPROVER);

    assert.equal(await balance('6130'), 30000);
    assert.equal(await balance('1120'), -30000);
  });

  await test('rejecting needs a reason', async () => {
    await rejectsWith(expenses.rejectExpense(bigPettyId, ' ', APPROVER), /Say why/);
  });

  await test('a rejected expense is corrected, resubmitted, and posts under the limit', async () => {
    const rejected = await expenses.rejectExpense(bigPettyId, 'Buy two, not three', APPROVER);
    assert.equal(rejected.status, 'rejected');
    assert.equal(await balance('6900'), 500, 'a rejected expense posted');

    const corrected = await expenses.updateExpense(
      bigPettyId,
      {
        categoryId: await categoryId('Petty cash'),
        expenseDate: now,
        description: 'Folding tables, two',
        amount: 1800,
        method: 'cash',
        paidFromLedgerId: cash,
      },
      SUBMITTER,
    );
    assert.equal(corrected.status, 'draft');
    assert.equal(corrected.rejectionReason, 'Buy two, not three', 'the reason it came back was lost');

    const posted = await expenses.submitExpense(bigPettyId, SUBMITTER);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.reference, 'E-0003');
    assert.equal(await balance('6900'), 2300);
  });

  // -------------------------------------------------------------------------
  // Money
  // -------------------------------------------------------------------------

  let utilitiesId = '';

  await test('input tax is booked apart from the expense', async () => {
    const draft = await expenses.createExpense(
      {
        categoryId: await categoryId('Utilities'),
        expenseDate: now,
        description: 'Electricity bill',
        amount: 10000,
        taxAmount: 1700,
        method: 'cash',
        paidFromLedgerId: cash,
        attachments: receipt,
      },
      SUBMITTER,
    );
    utilitiesId = draft.id;
    await expenses.submitExpense(draft.id, SUBMITTER);

    assert.equal(await balance('6140'), 10000, 'the tax was charged as an expense');
    assert.equal(await balance('1170'), 1700);
    assert.equal(await balance('1110'), -14000);
  });

  let chequeExpenseId = '';

  await test('an expense paid by cheque does not touch the bank until it clears', async () => {
    const draft = await expenses.createExpense(
      {
        categoryId: await categoryId('Warehouse & handling'),
        expenseDate: now,
        description: 'Loading labour, week one',
        amount: 4000,
        method: 'cheque',
        paidFromLedgerId: bank,
        chequeNo: '000777',
      },
      SUBMITTER,
    );
    chequeExpenseId = draft.id;
    await expenses.submitExpense(draft.id, SUBMITTER);

    assert.equal(await balance('1125'), -4000);
    assert.equal(await balance('1120'), -30000, 'the bank moved before the cheque cleared');

    await rejectsWith(
      expenses.clearExpenseCheque(chequeExpenseId, new Date(now.getTime() - 2 * DAY), APPROVER),
      /cannot clear before it was written/,
    );

    const cleared = await expenses.clearExpenseCheque(chequeExpenseId, now, APPROVER);
    assert.equal(cleared.isChequeUncleared, false);
    assert.equal(await balance('1125'), 0);
    assert.equal(await balance('1120'), -34000);
  });

  await test('a cheque leaf used on a supplier payment cannot be used on an expense', async () => {
    const acme = await vendors.createVendor({ name: 'Acme Traders' }, APPROVER);
    await payments.createPayment(
      {
        vendorId: acme.id,
        paymentDate: now,
        method: 'cheque',
        paidFromLedgerId: bank,
        chequeNo: '000888',
        amount: 100,
      },
      APPROVER,
    );

    await rejectsWith(
      expenses.createExpense(
        {
          categoryId: await categoryId('Bank charges'),
          expenseDate: now,
          description: 'Something else on the same leaf',
          amount: 50,
          method: 'cheque',
          paidFromLedgerId: bank,
          chequeNo: '000888',
        },
        SUBMITTER,
      ),
      /already recorded as a draft payment/,
    );
  });

  // -------------------------------------------------------------------------
  // After posting
  // -------------------------------------------------------------------------

  await test('a posted expense cannot be edited or deleted', async () => {
    await rejectsWith(
      expenses.updateExpense(
        utilitiesId,
        {
          categoryId: await categoryId('Utilities'),
          expenseDate: now,
          description: 'Electricity bill',
          amount: 1,
          method: 'cash',
          paidFromLedgerId: cash,
        },
        SUBMITTER,
      ),
      /cannot be edited/,
    );
    await rejectsWith(expenses.deleteExpense(utilitiesId, SUBMITTER), /cannot be deleted/);
  });

  await test('cancelling a posted expense reverses the spending and the tax', async () => {
    const cancelled = await expenses.cancelExpense(utilitiesId, 'Paid twice by mistake', APPROVER);
    assert.equal(cancelled.status, 'cancelled');

    assert.equal(await balance('6140'), 0);
    assert.equal(await balance('1170'), 0);
    assert.equal(await balance('1110'), -2300);
  });

  await test('an expense whose cheque has cleared can no longer be cancelled', async () => {
    await rejectsWith(expenses.cancelExpense(chequeExpenseId, 'Changed our mind', APPROVER), /has cleared/);
  });

  await test('a retired category cannot be used for new spending', async () => {
    await expenses.updateCategory(await categoryId('Bank charges'), { isActive: false }, APPROVER);
    await rejectsWith(
      expenses.createExpense(
        {
          categoryId: await categoryId('Bank charges'),
          expenseDate: now,
          description: 'Monthly service charge',
          amount: 250,
          method: 'bank_transfer',
          paidFromLedgerId: bank,
        },
        SUBMITTER,
      ),
      /has been retired/,
    );
  });

  await test('the summary totals posted spending by category, and nothing else', async () => {
    const summary = await expenses.expenseSummary();
    const byName = new Map(summary.rows.map((r) => [r.categoryName, r]));

    assert.equal(byName.get('Petty cash')!.amount, 2300);
    assert.equal(byName.get('Petty cash')!.count, 2);
    assert.equal(byName.get('Rent')!.amount, 30000);
    assert.equal(byName.get('Warehouse & handling')!.amount, 4000);
    assert.equal(byName.has('Utilities'), false, 'a cancelled expense was counted');
    assert.equal(summary.amount, 36300);
  });

  await test('two approvers at the same moment post it once', async () => {
    const draft = await expenses.createExpense(
      {
        categoryId: await categoryId('Rent'),
        expenseDate: now,
        description: 'Office rent',
        amount: 20000,
        method: 'bank_transfer',
        paidFromLedgerId: bank,
        attachments: receipt,
      },
      SUBMITTER,
    );
    await expenses.submitExpense(draft.id, SUBMITTER);

    await Promise.allSettled([
      expenses.approveExpense(draft.id, APPROVER),
      expenses.approveExpense(draft.id, SECOND_APPROVER),
    ]);

    assert.equal(await balance('6130'), 50000, 'the rent was spent twice');
    const entries = await JournalEntryModel.countDocuments({ sourceType: 'expense', sourceId: draft.id });
    assert.equal(entries, 1);
  });

  await test('there is no switch for expenses — approval is the gate', async () => {
    assert.equal((POSTING_EVENT_KEYS as readonly string[]).includes('expense'), false);
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
