/**
 * Behavioural checks for the posting engine, against an in-memory MongoDB.
 *
 * These prove the properties the whole module rests on, and that only a database can show:
 * replaying a post moves nothing twice, a posted entry has no way back, a reversal restores the
 * balance exactly, and a closed month refuses new work.
 *
 * Run with: npm run test:finance:posting
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { FinancialPeriodModel } from '../../models/financial-period.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import * as posting from './posting.service';
import * as journal from './journal.service';
import * as periods from './period.service';
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

/** Codes resolved once, so the tests read as accounting rather than as ids. */
const ids: Record<string, string> = {};

async function balanceOf(code: string): Promise<number> {
  const ledger = await LedgerModel.findOne({ code }).select('cachedBalance').lean();
  return round2(ledger?.cachedBalance ?? 0);
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-posting-flow-test' });

  await seedFinanceChart();
  for (const code of ['1110', '1120', '4110', '6130', '6120', '1140', '5110']) {
    const ledger = await LedgerModel.findOne({ code }).select('_id').lean();
    ids[code] = String(ledger!._id);
  }

  const THIS_MONTH = new Date();
  await periods.openPeriod(
    `${THIS_MONTH.getFullYear()}-${String(THIS_MONTH.getMonth() + 1).padStart(2, '0')}`,
  );

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  await test('an unbalanced entry is refused, and the message says by how much', async () => {
    await rejectsWith(
      posting.postEntry({
        date: new Date(),
        narration: 'Wrong',
        lines: [
          { ledgerId: ids['1110'], debit: 1000 },
          { ledgerId: ids['4110'], credit: 900 },
        ],
      }),
      /Credit 100 more to balance/,
    );
  });

  await test('a single-line entry is refused', async () => {
    await rejectsWith(
      posting.postEntry({
        date: new Date(),
        lines: [{ ledgerId: ids['1110'], debit: 100 }],
      }),
      /at least two lines/,
    );
  });

  await test('a line cannot be both debited and credited', async () => {
    await rejectsWith(
      posting.postEntry({
        date: new Date(),
        lines: [
          { ledgerId: ids['1110'], debit: 100, credit: 50 },
          { ledgerId: ids['4110'], credit: 50 },
        ],
      }),
      /either debited or credited, never both/,
    );
  });

  await test('a zero-amount line is refused rather than silently dropped', async () => {
    await rejectsWith(
      posting.postEntry({
        date: new Date(),
        lines: [
          { ledgerId: ids['1110'], debit: 100 },
          { ledgerId: ids['4110'], credit: 100 },
          { ledgerId: ids['6130'], debit: 0, credit: 0 },
        ],
      }),
      /enter an amount, or remove the line/i,
    );
  });

  await test('a manual entry cannot post to a control account', async () => {
    // The rule that keeps receivables agreeing with the collections module. A hand adjustment
    // here has no source document, so the drift it causes can never be traced.
    await rejectsWith(
      posting.postEntry({
        date: new Date(),
        lines: [
          { ledgerId: ids['1140'], debit: 500 },
          { ledgerId: ids['4110'], credit: 500 },
        ],
      }),
      /control account/,
    );
  });

  await test('a deactivated account cannot be posted to', async () => {
    const petty = await LedgerModel.create({
      name: 'Retired Account',
      code: '1901',
      groupId: (await LedgerModel.findOne({ code: '1110' }).lean())!.groupId,
      openingBalance: { amount: 0, asOf: null },
      cachedBalance: 0,
      cachedDebitTotal: 0,
      cachedCreditTotal: 0,
      isActive: false,
    });

    await rejectsWith(
      posting.postEntry({
        date: new Date(),
        lines: [
          { ledgerId: String(petty._id), debit: 10 },
          { ledgerId: ids['4110'], credit: 10 },
        ],
      }),
      /deactivated/,
    );
  });

  // -------------------------------------------------------------------------
  // Posting
  // -------------------------------------------------------------------------

  let firstEntryId = '';

  await test('a balanced entry posts and moves both balances the right way', async () => {
    const entry = await posting.postEntry({
      date: new Date(),
      narration: 'Cash sale',
      lines: [
        { ledgerId: ids['1110'], debit: 5000 },
        { ledgerId: ids['4110'], credit: 5000 },
      ],
    });

    firstEntryId = String(entry._id);
    assert.equal(entry.status, 'posted');
    assert.ok(entry.entryNo && entry.entryNo > 0, 'a posted entry gets a number');

    // Cash is debit-natured, sales is credit-natured. Both read POSITIVE, because a natural
    // balance is expressed in the account's own direction.
    assert.equal(await balanceOf('1110'), 5000);
    assert.equal(await balanceOf('4110'), 5000);
  });

  await test('a draft carries no number and moves nothing', async () => {
    const draft = await journal.createDraft({
      date: new Date(),
      narration: 'Rent for the month',
      lines: [
        { ledgerId: ids['6130'], debit: 30000 },
        { ledgerId: ids['1120'], credit: 30000 },
      ],
    });

    assert.equal(draft.status, 'draft');
    assert.equal(draft.entryNo, undefined);
    assert.equal(await balanceOf('6130'), 0, 'a draft moved a balance');

    const posted = await posting.postDraft(String(draft._id));
    assert.equal(posted.status, 'posted');
    assert.ok(posted.entryNo);
    assert.equal(await balanceOf('6130'), 30000);
    assert.equal(await balanceOf('1120'), -30000, 'the bank is now overdrawn on the books');
  });

  await test('posting a draft twice does nothing the second time', async () => {
    const draft = await journal.createDraft({
      date: new Date(),
      narration: 'Fuel',
      lines: [
        { ledgerId: ids['6120'], debit: 2500 },
        { ledgerId: ids['1110'], credit: 2500 },
      ],
    });

    await posting.postDraft(String(draft._id));
    const before = await balanceOf('6120');
    await posting.postDraft(String(draft._id));
    assert.equal(await balanceOf('6120'), before, 'the second post moved the balance again');
  });

  await test('replaying a keyed posting produces no second entry and no second increment', async () => {
    // The property the whole transaction-free design rests on. A retry, a double-clicked
    // button and a redelivered webhook all look exactly like this.
    const key = 'test:replay:1';
    const input = {
      date: new Date(),
      narration: 'Keyed posting',
      idempotencyKey: key,
      lines: [
        { ledgerId: ids['1110'], debit: 700 },
        { ledgerId: ids['4110'], credit: 700 },
      ],
    };

    const before = await balanceOf('1110');
    const first = await posting.postEntry(input);
    const mid = await balanceOf('1110');
    const second = await posting.postEntry(input);
    const after = await balanceOf('1110');

    assert.equal(String(first._id), String(second._id), 'a second entry was created');
    assert.equal(round2(mid - before), 700);
    assert.equal(after, mid, 'the replay incremented the balance again');

    const count = await JournalEntryModel.countDocuments({ idempotencyKey: key });
    assert.equal(count, 1);
  });

  await test('concurrent identical postings settle on one entry', async () => {
    const key = 'test:race:1';
    const input = {
      date: new Date(),
      narration: 'Raced posting',
      idempotencyKey: key,
      lines: [
        { ledgerId: ids['1110'], debit: 300 },
        { ledgerId: ids['4110'], credit: 300 },
      ],
    };

    const before = await balanceOf('1110');
    await Promise.allSettled([posting.postEntry(input), posting.postEntry(input)]);
    const after = await balanceOf('1110');

    // Exactly one increment, whichever request won the unique index.
    assert.equal(round2(after - before), 300);
    const lines = await JournalLineModel.countDocuments({
      idempotencyKey: { $in: [`${key}:0`, `${key}:1`] },
    });
    assert.equal(lines, 2, 'expected exactly the two lines of one entry');
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  await test('a posted entry cannot be edited', async () => {
    await rejectsWith(
      journal.updateDraft(firstEntryId, { narration: 'Rewritten' }),
      /never edited/,
    );
  });

  await test('a posted entry cannot be deleted', async () => {
    await rejectsWith(journal.deleteDraft(firstEntryId), /Reverse it instead/);
  });

  // -------------------------------------------------------------------------
  // Reversal
  // -------------------------------------------------------------------------

  await test('a reversal restores the balance exactly and links both ways', async () => {
    const before = await balanceOf('1110');
    const salesBefore = await balanceOf('4110');

    const { original, reversal } = await posting.reverseEntry(firstEntryId, {
      reason: 'Posted to the wrong account',
    });

    assert.equal(original.status, 'reversed');
    assert.equal(String(original.reversedByEntryId), String(reversal._id));
    assert.equal(String(reversal.reversalOf), String(original._id));
    assert.match(reversal.narration ?? '', /Reversal of/);

    assert.equal(await balanceOf('1110'), round2(before - 5000));
    assert.equal(await balanceOf('4110'), round2(salesBefore - 5000));
  });

  await test('an entry cannot be reversed twice', async () => {
    await rejectsWith(
      posting.reverseEntry(firstEntryId, { reason: 'Again' }),
      /already been reversed/,
    );
  });

  await test('a reversal requires a reason', async () => {
    const entry = await posting.postEntry({
      date: new Date(),
      narration: 'To be reversed',
      lines: [
        { ledgerId: ids['1110'], debit: 100 },
        { ledgerId: ids['4110'], credit: 100 },
      ],
    });
    await rejectsWith(
      posting.reverseEntry(String(entry._id), { reason: '  ' }),
      /Say why/,
    );
  });

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  await test('a month that was never opened refuses postings', async () => {
    // Failing shut. A mistyped year is refused rather than quietly landing somewhere nobody
    // looks at again.
    await rejectsWith(
      posting.postEntry({
        date: new Date('2019-03-15'),
        narration: 'Mistyped year',
        lines: [
          { ledgerId: ids['1110'], debit: 10 },
          { ledgerId: ids['4110'], credit: 10 },
        ],
      }),
      /has not been opened for posting/,
    );
  });

  await test('a closed month refuses new entries but still accepts a reversal', async () => {
    await periods.openPeriod('2026-01');
    const entry = await posting.postEntry({
      date: new Date('2026-01-15T09:00:00Z'),
      narration: 'January entry',
      lines: [
        { ledgerId: ids['1110'], debit: 250 },
        { ledgerId: ids['4110'], credit: 250 },
      ],
    });

    await periods.closePeriod('2026-01');

    await rejectsWith(
      posting.postEntry({
        date: new Date('2026-01-20T09:00:00Z'),
        narration: 'Too late',
        lines: [
          { ledgerId: ids['1110'], debit: 10 },
          { ledgerId: ids['4110'], credit: 10 },
        ],
      }),
      /is closed/,
    );

    // The correction path stays open, because the alternative is reopening the whole month to
    // fix one entry — a bigger hole than the one being patched.
    const { reversal } = await posting.reverseEntry(String(entry._id), {
      reason: 'Correction after close',
      date: new Date('2026-01-25T09:00:00Z'),
    });
    assert.equal(reversal.postingPeriod, '2026-01');
  });

  await test('a locked month refuses everything, reversals included', async () => {
    await periods.openPeriod('2025-12');
    const entry = await posting.postEntry({
      date: new Date('2025-12-10T09:00:00Z'),
      narration: 'December entry',
      lines: [
        { ledgerId: ids['1110'], debit: 40 },
        { ledgerId: ids['4110'], credit: 40 },
      ],
    });

    await periods.lockThrough('2025-12');

    await rejectsWith(
      posting.reverseEntry(String(entry._id), {
        reason: 'Should not work',
        date: new Date('2025-12-20T09:00:00Z'),
      }),
      /locked/,
    );
  });

  await test('a month with an unposted draft cannot close, and the reason says so', async () => {
    await periods.openPeriod('2026-02');
    await journal.createDraft({
      date: new Date('2026-02-10T09:00:00Z'),
      narration: 'Left unposted',
      lines: [
        { ledgerId: ids['1110'], debit: 60 },
        { ledgerId: ids['4110'], credit: 60 },
      ],
    });

    await rejectsWith(periods.closePeriod('2026-02'), /draft entr/);

    const checks = await periods.closeChecks('2026-02');
    assert.equal(checks.find((c) => c.name === 'No unposted drafts')?.ok, false);
  });

  await test('reopening a closed month demands a reason and records it', async () => {
    await rejectsWith(periods.reopenPeriod('2026-01', ''), /Say why/);
    const reopened = await periods.reopenPeriod('2026-01', 'Auditor asked for a correction');
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.reopenReason, 'Auditor asked for a correction');
  });

  await test('closing stores a snapshot, so a later change is provable', async () => {
    const doc = await FinancialPeriodModel.findOne({ period: '2025-12' }).lean();
    // 2025-12 was locked rather than closed, so use a month that went through close.
    assert.ok(doc);
    const closed = await FinancialPeriodModel.findOne({ period: '2026-01' }).lean();
    assert.ok(closed!.snapshot, 'no snapshot was stored at close');
    assert.ok(closed!.snapshot!.ledgerBalances.length > 0);
  });

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  await test('the trial balance agrees to the paisa', async () => {
    const tb = await journal.trialBalance();
    assert.equal(
      tb.balanced,
      true,
      `debits ${tb.totalDebit} vs credits ${tb.totalCredit}, difference ${tb.difference}`,
    );
    assert.ok(tb.rows.length > 0);
  });

  await test('an account the wrong way round reports in the opposite column', async () => {
    // The bank was credited more than it was debited above. It must show as a CREDIT balance,
    // not as a negative debit — that is what keeps the two totals equal.
    const tb = await journal.trialBalance();
    const bank = tb.rows.find((r) => r.code === '1120');
    assert.ok(bank);
    assert.equal(bank!.closingDebit, 0);
    assert.ok(bank!.closingCredit > 0);
  });

  await test('the ledger statement carries a running balance that ends at the closing figure', async () => {
    const statement = await journal.ledgerStatement(ids['1110']);
    assert.ok(statement.rows.length > 0);
    assert.equal(statement.closing, statement.rows[statement.rows.length - 1].runningBalance);
    assert.equal(statement.closing, await balanceOf('1110'));
  });

  await test('the day book returns entries with their lines', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const book = await journal.dayBook(today);
    assert.ok(book.entries.length > 0);
    assert.ok(book.entries.every((e) => e.lines.length >= 2));
  });

  // -------------------------------------------------------------------------
  // Reconciliation
  // -------------------------------------------------------------------------

  await test('a hand-corrupted balance is detected, named, and repairable', async () => {
    const before = await balanceOf('1110');
    await LedgerModel.updateOne({ code: '1110' }, { $inc: { cachedBalance: 999 } });

    const found = await posting.reconcileLedgerBalances();
    assert.ok(
      found.drifted.some((d) => d.code === '1110'),
      'the reconciler missed a deliberately corrupted balance',
    );

    const repaired = await posting.reconcileLedgerBalances({ repair: true });
    assert.equal(repaired.drifted.length >= 1, true);
    assert.equal(await balanceOf('1110'), before, 'repair did not restore the true balance');

    const clean = await posting.reconcileLedgerBalances();
    assert.deepEqual(clean.drifted, []);
  });

  await test('an interrupted posting is completed rather than left invisible', async () => {
    // Simulate a process that died between writing the lines and stamping the header. The
    // balances are already right; the entry would just be missing from the day book.
    const entry = await posting.postEntry({
      date: new Date(),
      narration: 'Interrupted',
      lines: [
        { ledgerId: ids['1110'], debit: 15 },
        { ledgerId: ids['4110'], credit: 15 },
      ],
    });
    await JournalEntryModel.updateOne(
      { _id: entry._id },
      { $set: { status: 'draft' }, $unset: { entryNo: '' } },
    );

    const swept = await posting.completeInterruptedPostings();
    assert.ok(swept.completed >= 1);

    const after = await JournalEntryModel.findById(entry._id).lean();
    assert.equal(after!.status, 'posted');
    assert.ok(after!.entryNo);
  });

  await test('every posted line carries the period and status its reports filter on', async () => {
    const lines = await JournalLineModel.find({ status: 'posted' }).limit(50).lean();
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.match(line.postingPeriod, /^\d{4}-\d{2}$/);
      assert.equal(round2(line.debit - line.credit), line.signedAmount);
    }
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
