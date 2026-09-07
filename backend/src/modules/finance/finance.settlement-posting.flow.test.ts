/**
 * Rider float and settlements, against an in-memory MongoDB.
 *
 * The property under test: money held by a rider is money the company owns, and the ledger must
 * say so from the moment it is collected until the moment it comes back — never before, never
 * after, and never quietly absorbed when it comes back short.
 *
 * Run with: npm run test:finance:settlements
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { SettlementModel } from '../../models/settlement.model';
import { FinanceSettingsModel, POSTING_EVENT_KEYS } from '../../models/finance-settings.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import * as periods from './period.service';
import * as settlementPosting from './settlement-posting.service';
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

const RIDER_A = new Types.ObjectId();
const RIDER_B = new Types.ObjectId();
const ADMIN = new Types.ObjectId();

async function balance(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean();
  return round2(ledger?.cachedBalance ?? 0);
}

async function makeSettlement(overrides: Record<string, unknown>) {
  const now = new Date();
  return SettlementModel.create({
    riderId: RIDER_A,
    city: 'Lahore',
    cityKey: 'lahore',
    mode: 'cash',
    amount: 5000,
    status: 'pending',
    submittedAt: now,
    ...overrides,
  });
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-settlement-flow-test' });

  await seedFinanceChart();
  const now = new Date();
  await periods.openPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' });
  for (const event of POSTING_EVENT_KEYS) settings!.postingEnabled.set(event, true);
  await settings!.save();

  // -------------------------------------------------------------------------
  // The one rule
  // -------------------------------------------------------------------------

  await test('a pending cash settlement posts nothing', async () => {
    // The money is still in the rider's pocket. Posting on submission would move cash into an
    // office that has not touched it.
    const pending = await makeSettlement({ status: 'pending' });
    const posted = await settlementPosting.postSettlement(String(pending._id), String(ADMIN));

    assert.equal(posted, false);
    assert.equal(await balance('1110'), 0, 'office cash moved before the money arrived');
    assert.equal(await balance('1130'), 0);
  });

  let cashSettlement: any;

  await test('confirming receipt moves the cash off the rider and into the office', async () => {
    cashSettlement = await makeSettlement({
      status: 'received',
      receivedAt: new Date(),
      receivedBy: ADMIN,
      amount: 5000,
    });

    const ok = await settlementPosting.postSettlement(String(cashSettlement._id), String(ADMIN));
    assert.equal(ok, true);

    assert.equal(await balance('1110'), 5000, 'office cash did not rise');
    // The rider account is credited, so its natural (debit) balance falls. It goes negative here
    // only because this test posts a handover without the delivery that funded it.
    assert.equal(await balance('1130'), -5000);
  });

  await test('an online settlement is born received and lands in the bank, not the office', async () => {
    const online = await makeSettlement({
      mode: 'online',
      amount: 2000,
      status: 'received',
      autoReceived: true,
      receivedAt: new Date(),
    });

    await settlementPosting.postSettlement(String(online._id), String(ADMIN));

    assert.equal(await balance('1120'), 2000, 'the bank did not receive the transfer');
    assert.equal(await balance('1135'), -2000, 'online-in-transit was not relieved');
    assert.equal(await balance('1110'), 5000, 'an online transfer touched office cash');
  });

  await test('posting the same settlement twice changes nothing', async () => {
    const before = await balance('1110');
    await settlementPosting.postSettlement(String(cashSettlement._id), String(ADMIN));
    assert.equal(await balance('1110'), before);
  });

  // -------------------------------------------------------------------------
  // Corrections and voids
  // -------------------------------------------------------------------------

  await test('correcting the amount downwards restates the entry and leaves the rider short', async () => {
    // The difference does NOT disappear. The rider is still carrying it as far as the books are
    // concerned, which is the whole point — a shortfall has to be somebody's decision.
    cashSettlement.amount = 4000;
    cashSettlement.lastCorrectedAt = new Date();
    await cashSettlement.save();

    const ok = await settlementPosting.postSettlement(String(cashSettlement._id), String(ADMIN));
    assert.equal(ok, true);

    assert.equal(await balance('1110'), 4000, 'the office is still holding the old figure');
    assert.equal(await balance('1130'), -4000, 'the rider was relieved of more than they handed over');
  });

  await test('voiding a settlement puts the money back on the rider', async () => {
    const voided = await makeSettlement({
      riderId: RIDER_B,
      status: 'received',
      receivedAt: new Date(),
      amount: 1500,
    });
    await settlementPosting.postSettlement(String(voided._id), String(ADMIN));
    const officeAfterPost = await balance('1110');

    voided.voidedAt = new Date();
    await voided.save();
    const ok = await settlementPosting.postSettlementVoid(String(voided._id), String(ADMIN));

    assert.equal(ok, true);
    assert.equal(await balance('1110'), round2(officeAfterPost - 1500));
  });

  // -------------------------------------------------------------------------
  // Write-offs
  // -------------------------------------------------------------------------

  await test('a write-off goes to Cash Difference, never to the office', async () => {
    // The distinction that matters: a handover is money arriving, a write-off is money accepted
    // as gone. Booking a write-off to office cash would show cash in a drawer that is empty.
    const officeBefore = await balance('1110');

    const writeOff = await makeSettlement({
      kind: 'writeoff',
      writeoffReason: 'Rider reported the cash stolen; police report filed',
      amount: 750,
      status: 'received',
      receivedAt: new Date(),
      receivedBy: ADMIN,
    });

    const ok = await settlementPosting.postSettlement(String(writeOff._id), String(ADMIN));
    assert.equal(ok, true);

    assert.equal(await balance('1110'), officeBefore, 'a write-off reached office cash');
    assert.equal(await balance('9110'), 750, 'the loss was not recorded as a cash difference');
  });

  await test('a write-off still relieves the rider, because they no longer owe it', async () => {
    // This is why it is recorded as a settlement: the operational balance maths already reduces
    // a rider's cash by every received settlement, and a write-off genuinely does reduce what
    // they owe. Nothing about `getRiderBalance` had to change.
    const riderCash = await balance('1130');
    assert.equal(riderCash, -4750, 'the write-off did not come off the rider');
  });

  await test('the write-off entry carries its reason into the narration', async () => {
    const { JournalEntryModel } = await import('../../models/journal-entry.model');
    const entry = await JournalEntryModel.findOne({ sourceType: 'settlement_variance' }).lean();
    assert.ok(entry, 'no variance entry was written');
    assert.match(entry!.narration ?? '', /police report/);
  });

  // -------------------------------------------------------------------------
  // Wholeness
  // -------------------------------------------------------------------------

  await test('the books balance after every settlement path', async () => {
    const tb = await trialBalance();
    assert.equal(tb.balanced, true, `out by ${tb.difference}`);
  });

  await test('the ledger can report what each rider is holding, per rider', async () => {
    // The figure the control check in a later step compares against `getRiderBalance`.
    const held = await settlementPosting.riderBalancesFromLedger();

    assert.ok(held.has(String(RIDER_A)), 'rider A is missing from the ledger view');
    assert.equal(held.get(String(RIDER_A))!.cash, -4750);
    assert.equal(held.get(String(RIDER_A))!.online, -2000);

    // Rider B's settlement was voided, so their balance nets back to nothing.
    assert.equal(round2(held.get(String(RIDER_B))?.cash ?? 0), 0);
  });

  await test('every rider line carries a subledger, or the control check is meaningless', async () => {
    const { JournalLineModel } = await import('../../models/journal-line.model');
    const riderLedgers = await LedgerModel.find({ subledgerType: 'rider' }).select('_id').lean();
    const ids = riderLedgers.map((l) => l._id);

    const orphan = await JournalLineModel.countDocuments({
      ledgerId: { $in: ids },
      subledgerRef: null,
    });
    assert.equal(orphan, 0, 'a rider control line was posted without saying which rider');
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
