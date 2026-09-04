/**
 * Behavioural checks for the chart of accounts, against an in-memory MongoDB.
 *
 * The rules suite proves the arithmetic. This proves the things only a database can: that the
 * seed builds a complete chart with every engine role mapped, and that the guards which stop an
 * accountant restating history actually refuse.
 *
 * Run with: npm run test:finance:flow
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AccountGroupModel } from '../../models/account-group.model';
import { LedgerModel } from '../../models/ledger.model';
import { FinanceSettingsModel, LEDGER_ROLE_KEYS } from '../../models/finance-settings.model';
import { seedFinanceChart } from '../../database/seeds/finance-chart.seed';
import * as chart from './chart.service';
import { MONEY_EPSILON, normalBalanceFor } from './finance.rules';

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

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'finance-chart-flow-test' });

  // -------------------------------------------------------------------------
  // The seed
  // -------------------------------------------------------------------------

  await test('the seed builds the chart and maps every engine role', async () => {
    const result = await seedFinanceChart();

    assert.ok(result.groupsCreated.length >= 10, 'too few groups seeded');
    assert.ok(result.ledgersCreated.length >= 45, 'too few ledgers seeded');
    assert.equal(result.rolesMapped, LEDGER_ROLE_KEYS.length);
    assert.equal(result.settingsCreated, true);
  });

  await test('every ledger sits under a group whose type it inherits', async () => {
    const groups = await AccountGroupModel.find().lean();
    const byId = new Map(groups.map((g) => [String(g._id), g]));
    const ledgers = await LedgerModel.find().lean();

    for (const l of ledgers) {
      const group = byId.get(String(l.groupId));
      assert.ok(group, `ledger ${l.code} has no group`);
      // Nothing downstream can render an account whose group has vanished, and no report would
      // report the omission — it would simply be absent from the balance sheet.
      assert.ok(normalBalanceFor(group!.accountType), `${l.code} has no resolvable side`);
    }
  });

  await test('a child group never disagrees with its parent about the account type', async () => {
    const groups = await AccountGroupModel.find().lean();
    const byId = new Map(groups.map((g) => [String(g._id), g]));
    for (const g of groups) {
      if (!g.parentGroupId) continue;
      const parent = byId.get(String(g.parentGroupId));
      assert.equal(g.accountType, parent!.accountType, `${g.code} disagrees with its parent`);
    }
  });

  await test('the ledger map is healthy straight after seeding', async () => {
    const health = await chart.verifyLedgerMap();
    assert.deepEqual(health.problems, []);
    assert.equal(health.ok, true);
  });

  await test('re-seeding changes nothing and does not duplicate the chart', async () => {
    const before = await LedgerModel.countDocuments();
    const again = await seedFinanceChart();
    const after = await LedgerModel.countDocuments();

    assert.equal(after, before, 'the second run created ledgers');
    assert.equal(again.ledgersCreated.length, 0);
    assert.ok(again.ledgersSkipped.length > 0);
  });

  await test("re-seeding does not overwrite an accountant's rename", async () => {
    // The contract access-policies.seed.ts holds, for the same reason: a redeploy must not undo
    // deliberate configuration.
    const bank = await LedgerModel.findOne({ code: '1120' }).exec();
    bank!.name = 'Bank — Meezan Current';
    await bank!.save();

    await seedFinanceChart();

    const after = await LedgerModel.findOne({ code: '1120' }).lean();
    assert.equal(after!.name, 'Bank — Meezan Current');
  });

  await test('a broken ledger map is reported rather than discovered at posting time', async () => {
    const settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).exec();
    const saved = settings!.ledgerMap.get('cogs');
    settings!.ledgerMap.delete('cogs');
    await settings!.save();

    const health = await chart.verifyLedgerMap();
    assert.equal(health.ok, false);
    assert.match(health.problems.join(' '), /cogs/);

    settings!.ledgerMap.set('cogs', saved!);
    await settings!.save();
  });

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  await test('the seeded control accounts are the five the posting engine needs', async () => {
    const controls = await chart.listLedgers({ isControl: true });
    const bySubledger = new Set(controls.map((c) => c.subledgerType));
    for (const t of ['dealer', 'vendor', 'rider', 'warehouse', 'employee']) {
      assert.ok(bySubledger.has(t), `no control account summarises the ${t} subledger`);
    }
  });

  await test('cheques are not counted as cash', async () => {
    // A cheque is not money until it clears. Counting one as a cash equivalent is how a
    // system's bank balance stops matching the bank's.
    const cash = await chart.listLedgers({ isCashEquivalent: true });
    const codes = cash.map((c) => c.code).sort();
    assert.deepEqual(codes, ['1110', '1120']);
  });

  await test('a ledger view carries the derived normal balance, never a stored one', async () => {
    const [receivable] = await chart.listLedgers({ search: '1140' });
    assert.equal(receivable.accountType, 'asset');
    assert.equal(receivable.normalBalance, 'debit');

    const [sales] = await chart.listLedgers({ search: '4110' });
    assert.equal(sales.accountType, 'income');
    assert.equal(sales.normalBalance, 'credit');
  });

  await test('a search term is escaped rather than treated as a pattern', async () => {
    const results = await chart.listLedgers({ search: '.*' });
    assert.equal(results.length, 0, 'a regex metacharacter matched everything');
  });

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  await test('a code from another type\'s block is refused', async () => {
    const assets = await AccountGroupModel.findOne({ code: '1100' }).lean();
    await rejectsWith(
      chart.createLedger({ name: 'Wrong block', code: '4999', groupId: String(assets!._id) }),
      /does not belong to a asset account/,
    );
  });

  await test('a code already used by a group is refused for a ledger', async () => {
    const assets = await AccountGroupModel.findOne({ code: '1100' }).lean();
    await rejectsWith(
      chart.createLedger({ name: 'Clash', code: '1100', groupId: String(assets!._id) }),
      /already used by the group/,
    );
  });

  await test('an omitted code is allocated from the group\'s own block', async () => {
    const assets = await AccountGroupModel.findOne({ code: '1100' }).lean();
    const created = await chart.createLedger({ name: 'Petty Cash', groupId: String(assets!._id) });
    assert.match(created.code, /^1\d{3}$/);
    assert.equal(created.accountType, 'asset');
    assert.equal(created.isSystem, false, 'only engine accounts are protected');
  });

  await test('a control ledger without a subledger is refused, and vice versa', async () => {
    const assets = await AccountGroupModel.findOne({ code: '1100' }).lean();
    await rejectsWith(
      chart.createLedger({ name: 'Bad control', groupId: String(assets!._id), isControl: true }),
      /which subledger/,
    );
    await rejectsWith(
      chart.createLedger({
        name: 'Bad subledger',
        groupId: String(assets!._id),
        subledgerType: 'dealer',
      }),
      /Only a control ledger/,
    );
  });

  await test('an engine account cannot be deleted', async () => {
    const cogs = await LedgerModel.findOne({ code: '5110' }).lean();
    await rejectsWith(chart.deleteLedger(String(cogs!._id)), /accounting engine/);
  });

  await test('an engine account cannot be retyped by moving it to another group', async () => {
    const cogs = await LedgerModel.findOne({ code: '5110' }).lean();
    const assets = await AccountGroupModel.findOne({ code: '1100' }).lean();
    await rejectsWith(
      chart.updateLedger(String(cogs!._id), { groupId: String(assets!._id) }),
      /must stay a expense account/,
    );
  });

  await test('an engine account can still be renamed and re-coded', async () => {
    // The line between "customisable" and "breakable": the engine resolves by role, not by
    // code, so both of these are safe and both are things a real accountant will want.
    const cogs = await LedgerModel.findOne({ code: '5110' }).lean();
    const updated = await chart.updateLedger(String(cogs!._id), {
      name: 'Cost of Sales — Goods',
      code: '5115',
    });
    assert.equal(updated.name, 'Cost of Sales — Goods');
    assert.equal(updated.code, '5115');

    const health = await chart.verifyLedgerMap();
    assert.equal(health.ok, true, 'renaming an engine account must not orphan its role');
  });

  await test('a group in the standard chart cannot be deleted', async () => {
    const assets = await AccountGroupModel.findOne({ code: '1100' }).lean();
    await rejectsWith(chart.deleteGroup(String(assets!._id)), /standard chart/);
  });

  await test('a group holding ledgers cannot be emptied by deleting it', async () => {
    const custom = await chart.createGroup({
      name: 'Deposits',
      code: '1900',
      parentGroupId: String((await AccountGroupModel.findOne({ code: '1000' }).lean())!._id),
    });
    const ledger = await chart.createLedger({
      name: 'Security Deposits',
      groupId: String(custom._id),
    });

    await rejectsWith(chart.deleteGroup(String(custom._id)), /still holds 1 ledger/);

    await chart.deleteLedger(ledger.id);
    const gone = await chart.deleteGroup(String(custom._id));
    assert.match(gone.message, /deleted/);
  });

  await test('a child group inherits its parent type and cannot contradict it', async () => {
    const income = await AccountGroupModel.findOne({ code: '4000' }).lean();
    await rejectsWith(
      chart.createGroup({
        name: 'Wrong type',
        code: '4500',
        parentGroupId: String(income!._id),
        accountType: 'expense',
      }),
      /must also be income/,
    );

    const ok = await chart.createGroup({
      name: 'Rental Income',
      code: '4500',
      parentGroupId: String(income!._id),
    });
    assert.equal(ok.accountType, 'income');
    assert.equal(ok.depth, 2);
  });

  await test('groups stop nesting at the documented depth', async () => {
    let parentId = String((await AccountGroupModel.findOne({ code: '4500' }).lean())!._id);
    // 4500 is depth 2. Depth 3 and 4 are legal; depth 5 is not.
    const third = await chart.createGroup({ name: 'Level 3', code: '4510', parentGroupId: parentId });
    parentId = String(third._id);
    const fourth = await chart.createGroup({ name: 'Level 4', code: '4520', parentGroupId: parentId });
    assert.equal(fourth.depth, 4);

    await rejectsWith(
      chart.createGroup({ name: 'Level 5', code: '4530', parentGroupId: String(fourth._id) }),
      /levels deep/,
    );
  });

  // -------------------------------------------------------------------------
  // History-preserving guards
  // -------------------------------------------------------------------------

  await test('a posted account cannot move to a group of a different type', async () => {
    // Simulates what the posting service will do in the next step. Written now because the
    // guard is here now, and a guard nothing exercises is a guard nobody trusts.
    const petty = await LedgerModel.findOne({ name: 'Petty Cash' }).exec();
    petty!.cachedDebitTotal = 5000;
    petty!.cachedCreditTotal = 1200;
    await petty!.save();

    const income = await AccountGroupModel.findOne({ code: '4000' }).lean();
    await rejectsWith(
      chart.updateLedger(String(petty!._id), { groupId: String(income!._id) }),
      /already been posted to/,
    );
  });

  await test('a posted account cannot have its opening balance edited', async () => {
    const petty = await LedgerModel.findOne({ name: 'Petty Cash' }).lean();
    await rejectsWith(
      chart.updateLedger(String(petty!._id), { openingBalance: { amount: 999, asOf: null } }),
      /Correct an opening balance with a journal entry/,
    );
  });

  await test('a posted account cannot become a control account', async () => {
    const petty = await LedgerModel.findOne({ name: 'Petty Cash' }).lean();
    await rejectsWith(
      chart.updateLedger(String(petty!._id), { isControl: true, subledgerType: 'rider' }),
      /cannot become a control account/,
    );
  });

  await test('a posted account cannot be deleted, only deactivated', async () => {
    const petty = await LedgerModel.findOne({ name: 'Petty Cash' }).lean();
    await rejectsWith(chart.deleteLedger(String(petty!._id)), /entries posted to it/);
  });

  await test('an account still holding a balance cannot be deactivated', async () => {
    const petty = await LedgerModel.findOne({ name: 'Petty Cash' }).exec();
    petty!.cachedBalance = 3800;
    await petty!.save();

    await rejectsWith(
      chart.updateLedger(String(petty!._id), { isActive: false }),
      /still holds a balance/,
    );

    petty!.cachedBalance = 0;
    await petty!.save();
    const off = await chart.updateLedger(String(petty!._id), { isActive: false });
    assert.equal(off.isActive, false);
  });

  await test('a deactivated ledger drops out of the default list', async () => {
    const active = await chart.listLedgers({});
    assert.ok(!active.some((l) => l.name === 'Petty Cash'));

    const all = await chart.listLedgers({ status: 'all' });
    assert.ok(all.some((l) => l.name === 'Petty Cash'));
  });

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  await test('settings report July as the fiscal year start and PKR as the currency', async () => {
    const settings = await chart.getSettings();
    assert.equal(settings.fiscalYearStartMonth, 7);
    assert.equal(settings.baseCurrency, 'PKR');
    assert.deepEqual(settings.agingBuckets, [30, 60, 90]);
  });

  await test('every engine role resolves to a named ledger in the settings view', async () => {
    const settings = await chart.getSettings();
    for (const key of LEDGER_ROLE_KEYS) {
      assert.ok(settings.roles[key], `${key} is unmapped`);
      assert.ok(settings.roles[key]!.code, `${key} points at a ledger with no code`);
    }
  });

  await test('auto-posting is off for every event until a later step turns it on', async () => {
    // Merged and deployed long before anyone switches it on, one event at a time, watching the
    // reconciliation each morning. Turning them all on at once is the riskiest possible move.
    const settings = await chart.getSettings();
    for (const enabled of Object.values(settings.postingEnabled)) {
      assert.equal(enabled, false);
    }
  });

  await test('the seeded chart starts with every balance flat', async () => {
    const ledgers = await LedgerModel.find({ isSystem: true }).lean();
    for (const l of ledgers) {
      assert.ok(Math.abs(l.cachedBalance) < MONEY_EPSILON, `${l.code} opened with a balance`);
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
