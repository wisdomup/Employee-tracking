/**
 * The registers of reversals and rider write-offs, against an in-memory MongoDB.
 *
 * The properties that matter, each silent if broken:
 *  - a reversal is listed once, as the entry that was undone, with who, when and why;
 *  - the window is on when it was undone, not on the original's date;
 *  - a write-off appears whether or not the books recorded it — they have not, so far — and the
 *    ones with no entry are counted, not hidden;
 *  - a voided write-off is listed and left out of the total;
 *  - the reversal of a write-off's posting is not mistaken for the live posting.
 *
 * Run with: npm run test:finance:registers
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { UserModel } from '../../models/user.model';
import { SettlementModel } from '../../models/settlement.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry, reverseEntry, periodKeyFor } from './posting.service';
import { listReversals, listWriteOffs } from './registers.service';

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

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

function on(day: string): Date {
  return new Date(`${day}T08:00:00Z`);
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-registers-flow-test' });
  await seedFinanceCounters();
  await seedFinanceChart();
  for (const period of ['2026-07', '2026-08', periodKeyFor(new Date())]) {
    await openPeriod(period, String(new Types.ObjectId()));
  }

  const manager = await UserModel.create({
    userID: 'FM-1',
    username: 'sana',
    fullName: 'Sana Tariq',
    phone: '03000000001',
    password: 'x',
    role: 'finance_manager',
  });
  const rider = await UserModel.create({
    userID: 'R-1',
    username: 'bilal',
    fullName: 'Bilal Ahmed',
    phone: '03000000002',
    password: 'x',
    role: 'delivery_man',
  });
  const ACTOR = String(manager._id);

  const post = async (day: string, amount: number, extra: Record<string, unknown> = {}) =>
    postEntry(
      {
        date: on(day),
        narration: `Rent ${amount}`,
        lines: [
          { ledgerId: await ledgerId('6130'), debit: amount },
          { ledgerId: await ledgerId('1110'), credit: amount },
        ],
        ...extra,
      },
      ACTOR,
    );

  const kept = await post('2026-07-10', 1000);
  const undone = await post('2026-07-12', 2500);
  await reverseEntry(String(undone._id), { reason: 'Paid twice', date: on('2026-08-03') }, ACTOR);

  // ---------------------------------------------------------------------------
  // Reversals
  // ---------------------------------------------------------------------------

  await test('a reversal is listed once, as what was undone, with who and why', async () => {
    const register = await listReversals();
    assert.equal(register.count, 1, 'the reversing entry must not appear as a second row');
    const row = register.rows[0];
    assert.equal(row.entryId, String(undone._id));
    assert.equal(row.reason, 'Paid twice');
    assert.equal(row.reversedBy, 'Sana Tariq', 'a name, not an id');
    assert.equal(row.amount, 2500);
    assert.ok(row.reversalEntryNo, 'the entry that undid it must be named');
    assert.equal(register.total, 2500);
  });

  await test('an entry that stands is not in the register', async () => {
    const register = await listReversals();
    assert.ok(!register.rows.some((r) => r.entryId === String(kept._id)));
  });

  await test('the window is on when it was undone, not the original date', async () => {
    // Reversed "today" (reverseEntry stamps reversedAt now), originally dated in July. The window
    // is a day either side so a run near midnight cannot land the stamp outside it.
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const july = await listReversals({ from: '2026-07-01', to: '2026-07-31' });
    assert.equal(july.count, 0, 'the July date is the original entry, not when it was undone');
    const now = await listReversals({ from: day(-1), to: day(1) });
    assert.equal(now.count, 1);
  });

  await test('a malformed or backwards window is refused', async () => {
    await rejectsWith(listReversals({ from: '03/08/2026' }), /not a date/);
    await rejectsWith(listReversals({ from: '2026-09-02', to: '2026-09-01' }), /after the end/);
  });

  // ---------------------------------------------------------------------------
  // Write-offs
  // ---------------------------------------------------------------------------

  const settlement = (amount: number, extra: Record<string, unknown> = {}) =>
    SettlementModel.create({
      riderId: rider._id,
      city: 'Lahore',
      cityKey: 'lahore',
      mode: 'cash',
      kind: 'writeoff',
      writeoffReason: 'Lost on the route',
      amount,
      status: 'received',
      receivedBy: manager._id,
      receivedAt: on('2026-08-10'),
      submittedAt: on('2026-08-10'),
      ...extra,
    });

  const unposted = await settlement(700);
  const voided = await settlement(300, { voidedAt: on('2026-08-11'), voidReason: 'Rider paid it after all' });
  const posted = await settlement(400);
  await SettlementModel.create({
    riderId: rider._id,
    city: 'Lahore',
    cityKey: 'lahore',
    mode: 'cash',
    kind: 'handover',
    amount: 9999,
    status: 'received',
    submittedAt: on('2026-08-10'),
  });

  // The posting a switched-on settlement would have made, then reversed once and re-posted —
  // the case where a naive lookup would find the reversal and call it live.
  const variance = async () =>
    postEntry(
      {
        date: on('2026-08-10'),
        narration: 'Rider cash shortfall written off',
        sourceType: 'settlement_variance',
        sourceId: String(posted._id),
        sourceModel: 'Settlement',
        idempotencyKey: `registers-test-${String(posted._id)}-${Math.random()}`,
        lines: [
          { ledgerId: await ledgerId('6130'), debit: 400 },
          { ledgerId: await ledgerId('1110'), credit: 400 },
        ],
      },
      ACTOR,
    );
  const firstPosting = await variance();
  await reverseEntry(String(firstPosting._id), { reason: 'Amount corrected' }, ACTOR);
  const livePosting = await variance();

  await test('a write-off appears whether or not the books recorded it', async () => {
    const register = await listWriteOffs();
    assert.equal(register.count, 3, 'three write-offs, and the handover is not one of them');
    const row = register.rows.find((r) => r.settlementId === String(unposted._id))!;
    assert.equal(row.entryId, null);
    assert.equal(row.rider, 'Bilal Ahmed');
    assert.equal(row.by, 'Sana Tariq');
    assert.equal(row.reason, 'Lost on the route');
  });

  await test('the ones with no entry in the books are counted, not hidden', async () => {
    const register = await listWriteOffs();
    assert.equal(register.unposted, 1, 'only the standing, unposted one — the voided one is not owed');
  });

  await test('a voided write-off is listed and left out of the total', async () => {
    const register = await listWriteOffs();
    const row = register.rows.find((r) => r.settlementId === String(voided._id))!;
    assert.equal(row.voided, true);
    assert.equal(row.voidReason, 'Rider paid it after all');
    assert.equal(register.total, 1100, '700 + 400 stand; the voided 300 does not');
  });

  await test('the live posting is attached, never its reversal', async () => {
    const register = await listWriteOffs();
    const row = register.rows.find((r) => r.settlementId === String(posted._id))!;
    assert.equal(row.entryId, String(livePosting._id));
    assert.equal(row.entryNo, livePosting.entryNo);
  });

  await test('the write-off window is on the day it was written off', async () => {
    const august = await listWriteOffs({ from: '2026-08-01', to: '2026-08-31' });
    assert.equal(august.count, 3);
    const july = await listWriteOffs({ from: '2026-07-01', to: '2026-07-31' });
    assert.equal(july.count, 0);
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
