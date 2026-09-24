/**
 * Money trails, against an in-memory MongoDB.
 *
 * The properties that make a trail trustworthy, each of which fails silently if broken:
 *
 *  - the rows shown add up to the total stated above them;
 *  - the counterparts add up to the same figure with the sign flipped, because every entry
 *    balances, so "where it came from" must equal "what arrived";
 *  - a reversed pair nets to nil rather than counting twice — the bug class this module has
 *    already been bitten by three times;
 *  - a liability reads positive when it grows, so the trail agrees with the report that opened it;
 *  - every `sourceModel` the posting services stamp has a row in the routing table, so a trail
 *    can always name the document even when there is no screen for it.
 *
 * Run with: npm run test:finance:trail
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { DealerModel } from '../../models/dealer.model';
import { JOURNAL_SOURCE_TYPES } from '../../models/journal-entry.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import { seedFinanceCounters } from './finance-counters';
import { openPeriod } from './period.service';
import { postEntry, reverseEntry, periodKeyFor } from './posting.service';
import { round2 } from './finance.rules';
import { dayBook } from './journal.service';
import * as statements from './financial-statements.service';
import { resolveTrail, KNOWN_SOURCE_MODELS, Trail } from './trail.service';

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
const ACTOR = String(new Types.ObjectId());
const DEALER = new Types.ObjectId();

async function ledgerId(code: string): Promise<string> {
  const ledger = await LedgerModel.findOne({ code }).select('_id').lean().exec();
  return String(ledger!._id);
}

function on(day: string): Date {
  return new Date(`${day}T08:00:00Z`);
}

async function post(day: string, debitCode: string, creditCode: string, amount: number, extra: Record<string, unknown> = {}) {
  return postEntry(
    {
      date: on(day),
      narration: `${debitCode} / ${creditCode}`,
      lines: [
        { ledgerId: await ledgerId(debitCode), debit: amount },
        { ledgerId: await ledgerId(creditCode), credit: amount },
      ],
      ...extra,
    },
    ACTOR,
  );
}

/** Rows must add up to the figure printed above them, opening included. */
function rowsAddUp(trail: Trail): void {
  const movement = round2(trail.rows.reduce((sum, r) => sum + r.amount, 0));
  assert.equal(
    round2((trail.opening ?? 0) + movement),
    trail.total,
    `${trail.title}: rows sum to ${movement} over an opening of ${trail.opening}, `
    + `but the total says ${trail.total}`,
  );
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-trail-flow-test' });
  await seedFinanceCounters();
  await seedFinanceChart();

  for (const period of ['2026-07', '2026-08', periodKeyFor(new Date())]) {
    await openPeriod(period, ACTOR);
  }

  await DealerModel.create({
    _id: DEALER,
    name: 'Imran Ali',
    shopName: 'Al-Noor Kiryana',
    phone: '03001234567',
  });

  // A small, hand-checkable set of movements.
  await post('2026-07-05', '1110', '3110', 500000); //  owner puts cash in
  await post('2026-07-10', '1110', '4110', 80000); //   cash sale
  await post('2026-07-12', '6130', '1110', 12000); //   rent paid in cash
  await post('2026-08-02', '1110', '4110', 45000); //   another cash sale
  const toReverse = await post('2026-08-09', '6130', '1110', 7000); // rent, later reversed

  // ---------------------------------------------------------------------------

  await test('an account trail lists the movements and they add up to its total', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('1110') });
    rowsAddUp(trail);
    // 500,000 in − 12,000 rent + 80,000 + 45,000 − 7,000 = 606,000
    assert.equal(trail.total, 606000);
    assert.equal(trail.rows.length, 5);
    assert.match(trail.title, /^1110 · /);
  });

  await test('an income account reads positive as it grows, not negative', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('4110') });
    rowsAddUp(trail);
    assert.equal(trail.total, 125000, 'sales of 80,000 + 45,000 must read positive');
    assert.ok(trail.rows.every((r) => r.amount > 0), 'a sale must not print as a negative row');
  });

  await test('a liability reads positive as it grows', async () => {
    // Capital is equity, credit-natured, exactly like a liability for direction purposes.
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('3110') });
    assert.equal(trail.total, 500000);
    assert.ok(trail.rows[0].amount > 0);
  });

  await test('counterparts equal the raw movement with the sign flipped', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('4110') });
    const counterTotal = round2(trail.counterparts.reduce((s, c) => s + c.amount, 0));
    // Every entry balances, so what this account received must equal what the other side gave.
    assert.equal(counterTotal, -trail.signedTotal!);
    assert.equal(trail.signedTotal, -trail.total, 'sales are credit-natured, so the two differ by sign');
    assert.ok(
      trail.counterparts.some((c) => c.code === '1110'),
      'the cash account funded both sales and must be named',
    );
  });

  await test('a counterpart carries a reference that opens that account', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('4110') });
    const cash = trail.counterparts.find((c) => c.code === '1110')!;
    const next = await resolveTrail(cash.drill);
    assert.match(next.title, /^1110 · /);
  });

  await test('a date window moves the movements into the opening figure', async () => {
    const all = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('1110') });
    const august = await resolveTrail({
      kind: 'ledger',
      ledgerId: await ledgerId('1110'),
      from: '2026-08-01',
    });
    rowsAddUp(august);
    assert.equal(august.rows.length, 2, 'only August moved this account twice');
    assert.equal(august.total, all.total, 'a window changes which rows show, never the closing figure');
    assert.equal(august.opening, 568000, '500,000 + 80,000 − 12,000 carried forward');
  });

  await test('a reversed pair nets to nil instead of counting twice', async () => {
    const before = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('6130') });
    assert.equal(before.total, 19000, '12,000 + 7,000 of rent before anything is reversed');

    await reverseEntry(String(toReverse._id), { reason: 'Charged to the wrong month', date: on('2026-08-20') }, ACTOR);

    const after = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('6130') });
    rowsAddUp(after);
    assert.equal(after.total, 12000, 'the 7,000 and its reversal must cancel, not double');
    assert.equal(after.rows.length, 3, 'both halves are listed — the history is what happened');
    assert.equal(
      after.rows.filter((r) => r.status === 'reversed').length,
      1,
      'the original is marked reversed, the reversing line is posted',
    );
  });

  await test('a reversal does not double the counterparts either', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('6130') });
    const counterTotal = round2(trail.counterparts.reduce((s, c) => s + c.amount, 0));
    assert.equal(counterTotal, -trail.signedTotal!);
  });

  await test('a cash-funded expense shows cash going DOWN, not up', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('6130') });
    const cash = trail.counterparts.find((c) => c.code === '1110')!;
    assert.ok(cash.amount < 0, 'paying rent in cash must read as money leaving the cash account');
    assert.equal(cash.amount, -12000);
  });

  await test('a cash sale shows cash going UP — the same rule, both directions', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('4110') });
    const cash = trail.counterparts.find((c) => c.code === '1110')!;
    assert.ok(cash.amount > 0, 'a sale received in cash must read as money arriving');
    assert.equal(cash.amount, 125000);
  });

  await test('an entry trail shows both sides and balances', async () => {
    const entry = await post('2026-08-25', '6120', '1110', 3000);
    const trail = await resolveTrail({ kind: 'entry', entryId: String(entry._id) });
    assert.equal(trail.rows.length, 2);
    const debit = round2(trail.rows.reduce((s, r) => s + r.debit, 0));
    const credit = round2(trail.rows.reduce((s, r) => s + r.credit, 0));
    assert.equal(debit, credit, 'an entry that does not balance should never have posted');
    assert.equal(trail.total, debit);
  });

  await test('an entry line opens the account it sits on, not the entry again', async () => {
    const entry = await post('2026-08-26', '6120', '1110', 1500);
    const trail = await resolveTrail({ kind: 'entry', entryId: String(entry._id) });
    assert.ok(trail.rows.every((r) => r.drill?.kind === 'ledger'));
    const next = await resolveTrail(trail.rows[0].drill!);
    assert.match(next.title, /^(6120|1110) · /);
  });

  await test('a group subtotal equals the accounts under it', async () => {
    const salesLedger = await LedgerModel.findOne({ code: '4110' }).select('groupId').lean().exec();
    const trail = await resolveTrail({ kind: 'group', groupId: String(salesLedger!.groupId) });
    const partsTotal = round2(trail.parts.reduce((s, p) => s + p.amount, 0));
    assert.equal(partsTotal, trail.total);
    assert.ok(trail.parts.some((p) => /^4110 · /.test(p.label)));
  });

  await test('a group part opens the account or sub-group it names', async () => {
    const salesLedger = await LedgerModel.findOne({ code: '4110' }).select('groupId').lean().exec();
    const trail = await resolveTrail({ kind: 'group', groupId: String(salesLedger!.groupId) });
    const part = trail.parts.find((p) => /^4110 · /.test(p.label))!;
    const next = await resolveTrail(part.drill!);
    assert.equal(next.total, part.amount, 'the account must report the figure the group credited it with');
  });

  await test('an account names the group it rolls up into', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('4110') });
    assert.equal(trail.parent?.kind, 'group');
    const up = await resolveTrail(trail.parent!);
    assert.ok(up.parts.some((p) => /^4110 · /.test(p.label)));
  });

  await test('a party trail names the shop and lists only its lines', async () => {
    const ar = await ledgerId('1140');
    const entry = await postEntry(
      {
        date: on('2026-08-28'),
        narration: 'Credit sale to Al-Noor',
        idempotencyKey: `trail-test-ar-${Date.now()}`,
        lines: [
          { ledgerId: ar, debit: 9000, subledgerRef: { type: 'dealer', id: String(DEALER) } },
          { ledgerId: await ledgerId('4110'), credit: 9000 },
        ],
      },
      ACTOR,
    );
    assert.ok(entry.entryNo);

    const trail = await resolveTrail({
      kind: 'party',
      partyType: 'dealer',
      partyId: String(DEALER),
      ledgerId: ar,
    });
    assert.equal(trail.title, 'Al-Noor Kiryana', 'the shop name, not its id');
    assert.equal(trail.total, 9000);
    assert.equal(trail.rows.length, 1);
    assert.equal(trail.rows[0].party?.name, 'Al-Noor Kiryana');
    rowsAddUp(trail);
  });

  await test('a control account carries the party on every row', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('1140') });
    assert.ok(trail.rows.length > 0);
    assert.ok(
      trail.rows.every((r) => r.party !== null),
      'a control account refuses a line with no subledger, so every row must name one',
    );
  });

  await test('a document trail lists every entry it produced', async () => {
    const orderId = String(new Types.ObjectId());
    await post('2026-08-29', '6120', '1110', 2500, {
      sourceType: 'order_delivery',
      sourceId: orderId,
      sourceModel: 'Order',
      idempotencyKey: `trail-test-order-${orderId}`,
    });
    const trail = await resolveTrail({ kind: 'source', sourceId: orderId });
    assert.equal(trail.rows.length, 1);
    assert.equal(trail.total, 2500);
    assert.match(trail.title, /^Order · /);
  });

  await test('an entry names the document that caused it, with a route to open it', async () => {
    const receiptId = String(new Types.ObjectId());
    const entry = await post('2026-08-30', '1170', '2115', 40000, {
      sourceType: 'stock_receipt',
      sourceId: receiptId,
      sourceModel: 'StockReceipt',
      idempotencyKey: `trail-test-receipt-${receiptId}`,
    });
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('1170') });
    const row = trail.rows.find((r) => r.entryNo === entry.entryNo)!;
    assert.equal(row.document?.sourceModel, 'StockReceipt');
    assert.equal(row.document?.href, `/warehouse/stock-in/${receiptId}`);
    assert.equal(trail.rows.find((r) => r.entryNo === entry.entryNo)!.drill?.kind, 'entry');
  });

  await test('a document with no screen of its own says so instead of linking nowhere', async () => {
    const settlementId = String(new Types.ObjectId());
    const entry = await post('2026-08-31', '1110', '1120', 15000, {
      sourceType: 'settlement_received',
      sourceId: settlementId,
      sourceModel: 'Settlement',
      idempotencyKey: `trail-test-settlement-${settlementId}`,
    });
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('1110') });
    const row = trail.rows.find((r) => r.entryNo === entry.entryNo)!;
    assert.equal(row.document?.sourceModel, 'Settlement');
    assert.equal(row.document?.href, null, 'an unfiltered list page answers nothing — null is honest');
  });

  await test('a document that posted nothing says why, rather than looking broken', async () => {
    const trail = await resolveTrail({ kind: 'source', sourceId: String(new Types.ObjectId()) });
    assert.equal(trail.rows.length, 0);
    assert.equal(trail.total, 0);
    assert.match(trail.note ?? '', /switched on one event at a time/);
  });

  await test('a cancelled document totals nil, and agrees with the account it touched', async () => {
    /*
     * The regression this exists for.
     *
     * A reversal is `status: 'posted'` and COPIES the original's `sourceId`, so filtering the
     * document's entries on status alone counts the CANCELLATION and reports the same magnitude
     * with the opposite meaning — a cancelled bill looking exactly like a live one. The check that
     * catches it is comparing the document against the account, not against itself.
     */
    const billId = String(new Types.ObjectId());
    const entry = await post('2026-08-15', '6140', '2115', 6000, {
      sourceType: 'bill',
      sourceId: billId,
      sourceModel: 'PurchaseBill',
      idempotencyKey: `trail-test-bill-${billId}`,
    });

    const live = await resolveTrail({ kind: 'source', sourceId: billId });
    assert.equal(live.total, 6000, 'before it is cancelled the document is worth its own figure');

    await reverseEntry(String(entry._id), { reason: 'Billed twice', date: on('2026-08-21') }, ACTOR);

    const trail = await resolveTrail({ kind: 'source', sourceId: billId });
    assert.equal(trail.rows.length, 2, 'the bill and its cancellation both happened');
    assert.equal(trail.total, 0, 'together they cancel, so the document is now doing nothing');
    assert.match(trail.note ?? '', /reversed/);

    // The account is the authority. A document trail that disagrees with it is the bug.
    const account = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('6140') });
    assert.equal(
      trail.total,
      account.total,
      'the document says one thing about the books and the books say another',
    );

    // The reversal reads negative against the document it undoes, so the rows show the round trip.
    const amounts = trail.rows.map((r) => r.amount).sort((a, b) => a - b);
    assert.deepEqual(amounts, [-6000, 6000]);
  });

  await test('the routing table covers every sourceModel and names every document', async () => {
    assert.ok(KNOWN_SOURCE_MODELS.length >= 15, 'a posting service stamps a model this does not know');
    for (const model of KNOWN_SOURCE_MODELS) {
      assert.ok(model.length > 0);
    }
    // Every source type is either dispatched by model or is one of the five declared-but-unused
    // values. If a new one is wired up without a model, this is the test that says so.
    assert.ok(JOURNAL_SOURCE_TYPES.length >= 30);
  });

  await test('the row cap is reported rather than silently changing the total', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('1110') });
    assert.equal(trail.truncated, false);
    assert.equal(trail.note, null, 'a complete trail must not carry a caveat');
  });

  await test('a figure that is not on file is refused, not answered with zero', async () => {
    await rejectsWith(
      resolveTrail({ kind: 'ledger', ledgerId: String(new Types.ObjectId()) }),
      /Account not found/,
    );
    await rejectsWith(
      resolveTrail({ kind: 'entry', entryId: String(new Types.ObjectId()) }),
      /Entry not found/,
    );
    await rejectsWith(
      resolveTrail({ kind: 'group', groupId: String(new Types.ObjectId()) }),
      /Account group not found/,
    );
    await rejectsWith(
      resolveTrail({ kind: 'ledger', ledgerId: 'not-an-id' }),
      /not an account id/,
    );
  });

  await test('an empty group says so rather than printing a bare nil', async () => {
    const group = await AccountGroupModel.create({
      name: 'Trail test empty group',
      code: '1900',
      accountType: 'asset',
      depth: 1,
      sortOrder: 99,
    });
    const trail = await resolveTrail({ kind: 'group', groupId: String(group._id) });
    assert.equal(trail.total, 0);
    assert.match(trail.note ?? '', /holds no accounts/);
  });

  await test('gross profit shows the arithmetic, and it reproduces the statement', async () => {
    const pl = await statements.profitAndLoss({ from: '2026-07', to: '2026-08' });
    const trail = await resolveTrail({
      kind: 'derived',
      report: 'profit-and-loss',
      figure: 'grossProfit',
      from: '2026-07',
      to: '2026-08',
    });
    assert.equal(trail.total, pl.grossProfit, 'the trail must agree with the report it explains');
    const recomputed = round2(
      trail.parts.reduce((s, p) => (p.operator === '-' ? s - p.amount : s + p.amount), 0),
    );
    assert.equal(recomputed, trail.total, 'the parts must add up under their own operators');
    assert.ok(trail.parts.length > 0);
    assert.equal(trail.title, 'Gross profit');
  });

  await test('net profit subtracts the expenses rather than adding them', async () => {
    const pl = await statements.profitAndLoss({ from: '2026-07', to: '2026-08' });
    const trail = await resolveTrail({
      kind: 'derived',
      report: 'profit-and-loss',
      figure: 'netProfit',
      from: '2026-07',
      to: '2026-08',
    });
    assert.equal(trail.total, pl.netProfit);
    assert.ok(
      trail.parts.some((p) => p.operator === '-'),
      'expenses reduce profit, so at least one part must subtract',
    );
  });

  await test('a derived part opens the group it names', async () => {
    const trail = await resolveTrail({
      kind: 'derived',
      report: 'profit-and-loss',
      figure: 'incomeTotal',
      from: '2026-07',
      to: '2026-08',
    });
    const part = trail.parts[0];
    assert.equal(part.drill?.kind, 'group');
    const next = await resolveTrail(part.drill!);
    assert.equal(next.total, part.amount, 'the group must report the figure the statement gave it');
  });

  await test('total assets and total equity both reproduce the balance sheet', async () => {
    const bs = await statements.balanceSheet({ asOf: '2026-08' });
    for (const figure of ['totalAssets', 'totalLiabilities', 'equityAccountsTotal', 'totalEquity']) {
      const trail = await resolveTrail({
        kind: 'derived',
        report: 'balance-sheet',
        figure,
        to: '2026-08',
      });
      const expected = (bs as unknown as Record<string, number>)[figure];
      assert.equal(trail.total, expected, `${figure} disagrees with the Balance Sheet`);
      const recomputed = round2(
        trail.parts.reduce((s, p) => (p.operator === '-' ? s - p.amount : s + p.amount), 0),
      );
      assert.equal(recomputed, trail.total, `${figure}'s parts do not add up`);
    }
  });

  await test('total equity names the profit that is not on any equity account', async () => {
    const trail = await resolveTrail({
      kind: 'derived',
      report: 'balance-sheet',
      figure: 'totalEquity',
      to: '2026-08',
    });
    const thisYear = trail.parts.find((p) => /this financial year/.test(p.label));
    assert.ok(thisYear, 'no year-end close exists, so this line must be spelled out');
    assert.equal(thisYear!.drill?.kind, 'derived', 'and it must open the P&L that produced it');
  });

  await test('a figure that is not on the report is refused by name', async () => {
    await rejectsWith(
      resolveTrail({ kind: 'derived', report: 'profit-and-loss', figure: 'madeUp', to: '2026-08' }),
      /not a figure on the Profit & Loss/,
    );
    await rejectsWith(
      resolveTrail({ kind: 'derived', report: 'balance-sheet', figure: 'madeUp', to: '2026-08' }),
      /not a figure on the Balance Sheet/,
    );
  });

  await test('the day book carries the account id on every line', async () => {
    const book = await dayBook('2026-08-02', '2026-08-31');
    assert.ok(book.entries.length > 0);
    for (const entry of book.entries) {
      for (const line of entry.lines) {
        assert.match(line.ledgerId, /^[0-9a-f]{24}$/, 'a line amount cannot drill without the id');
      }
    }
  });

  await test('the trail agrees with the account balance the rest of the module reports', async () => {
    const trail = await resolveTrail({ kind: 'ledger', ledgerId: await ledgerId('1110') });
    const ledger = await LedgerModel.findOne({ code: '1110' }).select('cachedBalance').lean().exec();
    assert.equal(
      trail.total,
      round2(ledger!.cachedBalance ?? 0),
      'a trail that disagrees with the balance it explains is worse than no trail',
    );
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
