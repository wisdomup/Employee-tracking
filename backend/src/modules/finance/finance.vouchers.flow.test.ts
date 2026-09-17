/**
 * The six manual vouchers, against an in-memory MongoDB.
 *
 * The interesting half of this file is the refusals. A voucher can be pointed at almost any account,
 * so what keeps the books trustworthy is not that it posts correctly — it is that it declines to
 * post the things another screen owns: supplier payables, stock, rider cash, staff advances, wages
 * owed, and spending that is supposed to pass an approval limit.
 *
 * The rest is the paperwork the business actually has no other home for: capital put in, a loan
 * received, the owner drawing money, cash banked, a shop paying at the office, a shop refunded, and
 * a month-end accrual.
 *
 * Run with: npm run test:finance:vouchers
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { DealerModel } from '../../models/dealer.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { VoucherModel } from '../../models/voucher.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { periodKeyFor } from './posting.service';
import { runControlReconciliation } from './control-reconciliation.service';
import * as vouchers from './vouchers.service';

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

// Two people, because an approval the maker gives themselves is not an approval.
const MAKER = String(new Types.ObjectId());
const APPROVER = String(new Types.ObjectId());

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean().exec();
  return Math.round((ledger?.cachedBalance ?? 0) * 100) / 100;
}

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

/** Raise, submit, approve and post in one go — the happy path, for the cases testing the figures. */
async function put(input: vouchers.VoucherInput): Promise<vouchers.VoucherDetail> {
  const draft = await vouchers.createVoucher(input, MAKER);
  await vouchers.submitVoucher(draft.id, MAKER);
  await vouchers.approveVoucher(draft.id, APPROVER);
  return vouchers.postVoucher(draft.id, APPROVER);
}

/** The receivables check, which has to count what vouchers took from shops. */
async function receivablesCheck() {
  const report = await runControlReconciliation();
  const check = report.checks.find((c) => c.checkId === 'ar-trade');
  assert.ok(check, 'the receivables check did not run');
  return check!;
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-vouchers-flow-test' });
  await seedFinanceCounters();
  await seedFinanceChart();

  for (const period of ['2025-07', periodKeyFor(new Date())]) {
    try {
      await openPeriod(period, MAKER);
    } catch {
      // Already open.
    }
  }

  const DATE = '2025-07-10';

  const cash = await ledgerId('1110');
  const bank = await ledgerId('1120');
  const capital = await ledgerId('3110');
  const drawings = await ledgerId('3120');
  const loan = await ledgerId('2210');
  const rent = await ledgerId('6130');
  const accrued = await ledgerId('2140');
  const otherIncome = await ledgerId('4900');
  const receivable = await ledgerId('1140');
  const payable = await ledgerId('2110');
  const staffAdvances = await ledgerId('1180');
  const riderCash = await ledgerId('1130');
  const salaryPayable = await ledgerId('2130');
  const outputTax = await ledgerId('2120');

  // A second bank account, so the contra rules have two of the same kind to move between.
  const secondBank = String(
    (
      await LedgerModel.create({
        name: 'Bank — Savings',
        code: '1121',
        groupId: (await LedgerModel.findOne({ code: '1120' }).lean())!.groupId,
        isCashEquivalent: true,
        openingBalance: { amount: 0, asOf: null },
        cachedBalance: 0,
        cachedDebitTotal: 0,
        cachedCreditTotal: 0,
      })
    )._id,
  );

  const shop = await DealerModel.create({
    name: 'Ali',
    shopName: 'Ali General Store',
    phone: '03000000001',
  });
  const shopId = String(shop._id);

  // -------------------------------------------------------------------------
  // The work vouchers exist to do
  // -------------------------------------------------------------------------

  await test('capital put into the business is a cash receipt', async () => {
    const posted = await put({
      category: 'CRV',
      voucherDate: DATE,
      narration: 'Capital introduced by owner',
      cashBankLedgerId: cash,
      counterLedgerId: capital,
      amount: 200000,
    });

    assert.equal(posted.status, 'posted');
    assert.equal(posted.reference, 'CRV-0001');
    assert.equal(posted.categoryLabel.length > 0, true);
    assert.equal(await balance('1110'), 200000);
    assert.equal(await balance('3110'), 200000);

    // The approver sees the entry itself, not a promise of one.
    assert.deepEqual(
      posted.lines.map((l) => [l.ledgerCode, l.debit, l.credit]),
      [['1110', 200000, 0], ['3110', 0, 200000]],
    );
  });

  await test('a loan received goes into the bank and is owed back', async () => {
    const posted = await put({
      category: 'BRV',
      voucherDate: DATE,
      narration: 'Loan from Habib Bank',
      cashBankLedgerId: bank,
      counterLedgerId: loan,
      amount: 300000,
    });

    assert.equal(posted.reference, 'BRV-0001', 'each category has its own numbers');
    assert.equal(await balance('1120'), 300000);
    assert.equal(await balance('2210'), 300000);
  });

  await test('the owner taking money out is a bank payment, not an expense', async () => {
    await put({
      category: 'BPV',
      voucherDate: DATE,
      narration: 'Owner drawings for the month',
      cashBankLedgerId: bank,
      counterLedgerId: drawings,
      amount: 50000,
    });

    assert.equal(await balance('1120'), 250000);
    assert.equal(await balance('3120'), -50000, 'drawings sit against capital, not against profit');
  });

  await test('a tax bill is paid from the bank and the liability goes', async () => {
    await put({
      category: 'BPV',
      voucherDate: DATE,
      narration: 'Sales tax paid to FBR',
      reference: 'PSID-99881',
      cashBankLedgerId: bank,
      counterLedgerId: outputTax,
      amount: 10000,
    });

    assert.equal(await balance('1120'), 240000);
    assert.equal(await balance('2120'), -10000, 'paid before it was charged, which is the test, not the book');
  });

  // -------------------------------------------------------------------------
  // A shop paying at the office — the one control account a voucher may reach
  // -------------------------------------------------------------------------

  await test('a shop paying at the office reduces what it owes', async () => {
    const posted = await put({
      category: 'CRV',
      voucherDate: DATE,
      narration: 'Received at office from Ali General Store',
      cashBankLedgerId: cash,
      partyType: 'dealer',
      partyId: shopId,
      amount: 12000,
    });

    assert.equal(posted.partyName, 'Ali General Store');
    assert.equal(await balance('1110'), 212000);
    assert.equal(await balance('1140'), -12000, 'the shop had nothing owing, so it is now in credit');
    assert.equal(posted.lines[1].partyName, 'Ali General Store', 'the line carries the shop');
  });

  await test('the receivables check counts what vouchers took from shops', async () => {
    const check = await receivablesCheck();
    assert.equal(check.breakdown.receivedByVoucher, 12000);
    assert.equal(check.ok, true, `the receivables check drifted by ${check.drift}`);
  });

  await test('refunding a shop puts it back on their account', async () => {
    const posted = await put({
      category: 'CPV',
      voucherDate: DATE,
      narration: 'Refund of overpayment to Ali General Store',
      cashBankLedgerId: cash,
      partyType: 'dealer',
      partyId: shopId,
      amount: 2000,
    });

    assert.equal(posted.lines[0].debit, 2000, 'a refund is debited to the shop');
    assert.equal(await balance('1110'), 210000);
    assert.equal(await balance('1140'), -10000);

    const check = await receivablesCheck();
    assert.equal(check.breakdown.receivedByVoucher, 10000, 'the refund nets off what was received');
    assert.equal(check.ok, true);
  });

  await test('a shop and an account cannot both be the other side', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'CRV',
        voucherDate: DATE,
        narration: 'Both sides named',
        cashBankLedgerId: cash,
        counterLedgerId: otherIncome,
        partyType: 'dealer',
        partyId: shopId,
        amount: 500,
      }, MAKER),
      /not both/,
    );
  });

  // -------------------------------------------------------------------------
  // Accounts another screen owns
  // -------------------------------------------------------------------------

  await test('spending against an expense account belongs on the Expenses screen', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'CPV',
        voucherDate: DATE,
        narration: 'Office rent paid in cash',
        cashBankLedgerId: cash,
        counterLedgerId: rent,
        amount: 25000,
      }, MAKER),
      /Expenses screen/,
    );
  });

  await test('what we owe suppliers is settled on Supplier Payments', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'BPV',
        voucherDate: DATE,
        narration: 'Paying a supplier the quick way',
        cashBankLedgerId: bank,
        counterLedgerId: payable,
        amount: 5000,
      }, MAKER),
      /Supplier Payments/,
    );
  });

  await test('rider cash, staff advances and wages owed are refused by name', async () => {
    const cases: [string, RegExp][] = [
      [riderCash, /Collections/],
      [staffAdvances, /Payroll/],
      [salaryPayable, /Payroll/],
    ];

    for (const [account, screen] of cases) {
      await rejectsWith(
        vouchers.createVoucher({
          category: 'CPV',
          voucherDate: DATE,
          narration: 'Going around the module that owns this',
          cashBankLedgerId: cash,
          counterLedgerId: account,
          amount: 1000,
        }, MAKER),
        screen,
      );
    }
  });

  await test('money to or from a supplier cannot be put on a voucher as a party', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'BPV',
        voucherDate: DATE,
        narration: 'Supplier as a party',
        cashBankLedgerId: bank,
        partyType: 'vendor' as never,
        partyId: shopId,
        amount: 1000,
      }, MAKER),
      /Supplier Payments screen/,
    );
  });

  await test('a cash voucher will not take money out of the bank', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'CRV',
        voucherDate: DATE,
        narration: 'Cash receipt, into the bank',
        cashBankLedgerId: bank,
        counterLedgerId: otherIncome,
        amount: 1000,
      }, MAKER),
      /Bank Receipt \(BRV\)/,
    );
  });

  await test('moving money between our own accounts is a contra, not a receipt', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'CRV',
        voucherDate: DATE,
        narration: 'Cash from the bank',
        cashBankLedgerId: cash,
        counterLedgerId: bank,
        amount: 1000,
      }, MAKER),
      /Contra voucher \(CV\)/,
    );
  });

  // -------------------------------------------------------------------------
  // Contra: our own money, moving between our own accounts
  // -------------------------------------------------------------------------

  await test('cash banked is a contra and changes nothing but where the money sits', async () => {
    const posted = await put({
      category: 'CV',
      subtype: 'bank_deposit',
      voucherDate: DATE,
      narration: 'Day cash deposited into the operating account',
      fromLedgerId: cash,
      toLedgerId: bank,
      amount: 100000,
    });

    assert.equal(posted.reference, 'CV-0001');
    assert.equal(await balance('1110'), 110000);
    assert.equal(await balance('1120'), 340000);
  });

  await test('cash drawn from the bank is the same move the other way', async () => {
    await put({
      category: 'CV',
      subtype: 'cash_withdrawal',
      voucherDate: DATE,
      narration: 'Cash drawn for the office float',
      fromLedgerId: bank,
      toLedgerId: cash,
      amount: 20000,
    });

    assert.equal(await balance('1110'), 130000);
    assert.equal(await balance('1120'), 320000);
  });

  await test('money between two bank accounts is a contra too', async () => {
    await put({
      category: 'CV',
      subtype: 'bank_to_bank',
      voucherDate: DATE,
      narration: 'Surplus moved to the savings account',
      fromLedgerId: bank,
      toLedgerId: secondBank,
      amount: 60000,
    });

    assert.equal(await balance('1120'), 260000);
    assert.equal(await balance('1121'), 60000);
  });

  await test('a contra that contradicts itself is refused', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'CV',
        subtype: 'bank_deposit',
        voucherDate: DATE,
        narration: 'A deposit, out of the bank',
        fromLedgerId: bank,
        toLedgerId: secondBank,
        amount: 1000,
      }, MAKER),
      /bank deposit moves cash into a bank account/,
    );

    await rejectsWith(
      vouchers.createVoucher({
        category: 'CV',
        subtype: 'cash_to_cash',
        voucherDate: DATE,
        narration: 'Cash to cash, via the bank',
        fromLedgerId: cash,
        toLedgerId: bank,
        amount: 1000,
      }, MAKER),
      /one of these is the bank/,
    );
  });

  await test('a contra needs two different accounts, both of them ours', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'CV',
        subtype: 'cash_to_cash',
        voucherDate: DATE,
        narration: 'Cash to itself',
        fromLedgerId: cash,
        toLedgerId: cash,
        amount: 1000,
      }, MAKER),
      /same account/,
    );

    await rejectsWith(
      vouchers.createVoucher({
        category: 'CV',
        subtype: 'bank_deposit',
        voucherDate: DATE,
        narration: 'Depositing into an income account',
        fromLedgerId: cash,
        toLedgerId: otherIncome,
        amount: 1000,
      }, MAKER),
      /not one of our cash or bank accounts/,
    );
  });

  // -------------------------------------------------------------------------
  // Journal: the adjustments, and what a journal may not touch
  // -------------------------------------------------------------------------

  await test("a month's rent accrued is what a journal voucher is for", async () => {
    const posted = await put({
      category: 'JV',
      voucherDate: DATE,
      narration: 'July rent accrued, invoice not yet received',
      lines: [
        { ledgerId: rent, debit: 25000, narration: 'July rent' },
        { ledgerId: accrued, credit: 25000 },
      ],
    });

    assert.equal(posted.reference, 'JV-0001');
    assert.equal(posted.amount, 25000);
    assert.equal(await balance('6130'), 25000);
    assert.equal(await balance('2140'), 25000);
  });

  await test('a journal that does not balance is refused, with both totals', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'JV',
        voucherDate: DATE,
        narration: 'Lopsided',
        lines: [
          { ledgerId: rent, debit: 1000 },
          { ledgerId: accrued, credit: 900 },
        ],
      }, MAKER),
      /1000\.00 debited against 900\.00 credited/,
    );
  });

  await test('a journal moves no money and adjusts no control account by hand', async () => {
    await rejectsWith(
      vouchers.createVoucher({
        category: 'JV',
        voucherDate: DATE,
        narration: 'Journalling cash',
        lines: [
          { ledgerId: cash, debit: 1000 },
          { ledgerId: otherIncome, credit: 1000 },
        ],
      }, MAKER),
      /journal voucher moves no money/,
    );

    await rejectsWith(
      vouchers.createVoucher({
        category: 'JV',
        voucherDate: DATE,
        narration: 'Writing off a shop by hand',
        lines: [
          { ledgerId: rent, debit: 1000 },
          { ledgerId: receivable, credit: 1000 },
        ],
      }, MAKER),
      /control account/,
    );
  });

  // -------------------------------------------------------------------------
  // Maker, approver, and the road between them
  // -------------------------------------------------------------------------

  let workflowId = '';

  await test('a draft posts nothing and carries no number', async () => {
    const before = await balance('1110');
    const draft = await vouchers.createVoucher({
      category: 'CRV',
      voucherDate: DATE,
      narration: 'Scrap sold to the kabaria',
      cashBankLedgerId: cash,
      counterLedgerId: otherIncome,
      amount: 5000,
    }, MAKER);
    workflowId = draft.id;

    assert.equal(draft.status, 'draft');
    assert.equal(draft.reference, 'Draft', 'a number is allocated at posting, so drafts leave no gaps');
    assert.equal(await balance('1110'), before, 'a draft moved money');
    assert.equal(draft.lines.length, 2, 'the entry is composed at save, for the approver to read');
  });

  await test('an unapproved voucher cannot be posted', async () => {
    await rejectsWith(vouchers.postVoucher(workflowId, APPROVER), /Only an approved voucher/);
    await vouchers.submitVoucher(workflowId, MAKER);
    await rejectsWith(vouchers.postVoucher(workflowId, APPROVER), /Only an approved voucher/);
  });

  await test('a voucher under the approver cannot be edited beneath them', async () => {
    await rejectsWith(
      vouchers.updateVoucher(workflowId, {
        category: 'CRV',
        voucherDate: DATE,
        narration: 'Quietly changed while it was being read',
        cashBankLedgerId: cash,
        counterLedgerId: otherIncome,
        amount: 500000,
      }, MAKER),
      /waiting for approval/,
    );
  });

  await test('whoever raised it cannot approve it', async () => {
    await rejectsWith(vouchers.approveVoucher(workflowId, MAKER), /somebody else has to approve it/);
  });

  await test('sending it back says why, and the maker can then correct it', async () => {
    const sentBack = await vouchers.rejectVoucher(
      workflowId,
      'Wrong account - this is scrap, not sales',
      APPROVER,
    );
    assert.equal(sentBack.status, 'rejected');
    assert.match(sentBack.rejectionReason ?? '', /scrap/);

    const corrected = await vouchers.updateVoucher(workflowId, {
      category: 'CRV',
      voucherDate: DATE,
      narration: 'Scrap sold to the kabaria',
      cashBankLedgerId: cash,
      counterLedgerId: otherIncome,
      amount: 4500,
    }, MAKER);

    assert.equal(corrected.status, 'draft', 'a corrected voucher goes back to the start');
    assert.equal(corrected.amount, 4500);
    assert.match(corrected.rejectionReason ?? '', /scrap/, 'the reason it came back was lost');
  });

  await test('a reason is required to send one back', async () => {
    await rejectsWith(vouchers.rejectVoucher(workflowId, '  ', APPROVER), /Say what needs fixing/);
  });

  await test('approved by a second person, then posted', async () => {
    await vouchers.submitVoucher(workflowId, MAKER);
    const approved = await vouchers.approveVoucher(workflowId, APPROVER);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.reference, 'Draft', 'approving is not posting');
    assert.equal(await balance('1110'), 130000, 'approval moved money');

    const posted = await vouchers.postVoucher(workflowId, APPROVER);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.reference, 'CRV-0003');
    assert.equal(await balance('1110'), 134500);
  });

  await test('posting twice writes one entry, not two', async () => {
    const again = await vouchers.postVoucher(workflowId, APPROVER);
    const entries = await JournalEntryModel.countDocuments({
      sourceType: 'voucher',
      sourceId: new Types.ObjectId(workflowId),
    }).exec();

    assert.equal(entries, 1);
    assert.equal(again.reference, 'CRV-0003', 'a second post took another number');
    assert.equal(await balance('1110'), 134500);
  });

  await test('a posted voucher is cancelled, never deleted', async () => {
    await rejectsWith(vouchers.deleteVoucher(workflowId, MAKER), /cancelled, never deleted/);
  });

  await test('cancelling a posted voucher reverses it and leaves both on the record', async () => {
    const cancelled = await vouchers.cancelVoucher(workflowId, 'Duplicate of the cash sheet', APPROVER);

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.reference, 'CRV-0003', 'a cancelled voucher keeps its number');
    assert.equal(await balance('1110'), 130000, 'the money did not come back');

    const entry = await JournalEntryModel.findById(cancelled.journalEntryId)
      .select('status')
      .lean()
      .exec();
    assert.equal(entry!.status, 'reversed', 'the original entry is still there, marked');
  });

  await test('a draft can be deleted outright', async () => {
    const draft = await vouchers.createVoucher({
      category: 'CPV',
      voucherDate: DATE,
      narration: 'Raised by mistake',
      cashBankLedgerId: cash,
      counterLedgerId: loan,
      amount: 100,
    }, MAKER);

    await vouchers.deleteVoucher(draft.id, MAKER);
    assert.equal(await VoucherModel.countDocuments({ _id: draft.id }).exec(), 0);
  });

  await test('a month that was never opened refuses the posting, not the paperwork', async () => {
    const draft = await vouchers.createVoucher({
      category: 'CRV',
      voucherDate: '2025-01-15',
      narration: 'Receipt dated in a month nobody opened',
      cashBankLedgerId: cash,
      counterLedgerId: otherIncome,
      amount: 900,
    }, MAKER);

    await vouchers.submitVoucher(draft.id, MAKER);
    await vouchers.approveVoucher(draft.id, APPROVER);
    await rejectsWith(vouchers.postVoucher(draft.id, APPROVER), /has not been opened for posting/);

    const still = await vouchers.getVoucher(draft.id);
    assert.equal(still.status, 'approved', 'a refused posting left the voucher half-done');
  });

  await test('each category counts on its own, and the list can be filtered', async () => {
    const contras = await vouchers.listVouchers({ category: 'CV', status: 'posted' });
    assert.equal(contras.length, 3);
    assert.deepEqual(contras.map((v) => v.reference).sort(), ['CV-0001', 'CV-0002', 'CV-0003']);

    const forShop = await vouchers.listVouchers({ partyId: shopId });
    assert.equal(forShop.length, 2, 'the receipt and the refund for that shop');

    const bySearch = await vouchers.listVouchers({ search: 'kabaria' });
    assert.equal(bySearch.length, 1);
  });

  await test('the receivables check is still provable at the end of all of it', async () => {
    const check = await receivablesCheck();
    assert.equal(check.ok, true, `the receivables check drifted by ${check.drift}`);
    assert.equal(check.breakdown.receivedByVoucher, 10000);
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
