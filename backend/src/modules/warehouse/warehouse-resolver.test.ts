/**
 * Which warehouse does a sale draw from?
 *
 * Cities are free text on both the user and the warehouse, so this is the one place where a typo
 * silently sends stock to the wrong city. Resolution must never return "nowhere", and must never
 * pick arbitrarily when the data is ambiguous.
 *
 * Run with: npm run test:warehouse-resolver
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { resolveWarehouseForUser, resolveMainWarehouseId } from './warehouse-resolver';
import { resolveWarehouseScope, assertWarehouseAccess } from './warehouse-scope';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
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
let mainId: string;
let lahoreId: string;

async function seedWarehouses() {
  await WarehouseModel.deleteMany({});
  const [main, lahore, inactive, trashed] = await WarehouseModel.create([
    { name: 'Main Warehouse', city: 'Faisalabad', cityKey: 'faisalabad', isMain: true, isActive: true },
    { name: 'Lahore Warehouse', city: 'Lahore', cityKey: 'lahore', isActive: true },
    { name: 'Multan Warehouse', city: 'Multan', cityKey: 'multan', isActive: false },
    { name: 'Old Gujranwala', city: 'Gujranwala', cityKey: 'gujranwala', isActive: true, isTrashed: true },
  ]);
  mainId = String(main._id);
  lahoreId = String(lahore._id);
  return { main, lahore, inactive, trashed };
}

let userSeq = 0;
async function makeUser(overrides: Record<string, unknown>) {
  userSeq += 1;
  const suffix = String(userSeq).padStart(6, '0');
  return UserModel.create({
    userID: `U-${suffix}`,
    username: `user.${suffix}`,
    phone: `0300${suffix}`,
    password: 'x',
    role: 'order_taker',
    ...overrides,
  });
}

async function main() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'warehouse-resolver-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');
  await WarehouseModel.syncIndexes();

  await seedWarehouses();

  // -------------------------------------------------------------------------
  console.log('Resolving a sale\'s source warehouse');
  // -------------------------------------------------------------------------
  await test('an explicit User.warehouseId beats the city', async () => {
    const user = await makeUser({ warehouseId: lahoreId, address: { city: 'Faisalabad' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), lahoreId);
    assert.equal(result.source, 'user_warehouse');
  });

  await test('a Lahore salesman resolves to the Lahore warehouse', async () => {
    const user = await makeUser({ address: { city: 'Lahore' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), lahoreId);
    assert.equal(result.source, 'city_match');
  });

  await test('city matching ignores case and stray whitespace on both sides', async () => {
    const user = await makeUser({ address: { city: '  LAHORE ' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), lahoreId);
  });

  await test('no city falls back to Main and says why', async () => {
    const user = await makeUser({ address: {} });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), mainId);
    assert.equal(result.source, 'main');
    assert.match(result.note ?? '', /no city is set/i);
  });

  await test('an unmatched city falls back to Main and names the city', async () => {
    const user = await makeUser({ address: { city: 'Quetta' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), mainId);
    assert.match(result.note ?? '', /Quetta/);
  });

  await test('an INACTIVE warehouse is never resolved to', async () => {
    const user = await makeUser({ address: { city: 'Multan' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), mainId, 'must fall back, not use the inactive one');
  });

  await test('a TRASHED warehouse is never resolved to', async () => {
    const user = await makeUser({ address: { city: 'Gujranwala' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), mainId);
  });

  await test('a stale User.warehouseId pointing at a trashed warehouse falls through to the city', async () => {
    const trashed = await WarehouseModel.findOne({ isTrashed: true });
    const user = await makeUser({ warehouseId: trashed!._id, address: { city: 'Lahore' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), lahoreId);
    assert.equal(result.source, 'city_match');
  });

  await test('two active warehouses in one city resolve deterministically and are flagged', async () => {
    const second = await WarehouseModel.create({
      name: 'Lahore Warehouse 2', city: 'lahore', cityKey: 'lahore', isActive: true,
    });
    const user = await makeUser({ address: { city: 'Lahore' } });
    const result = await resolveWarehouseForUser(String(user._id));
    // Neither is Main, so the lowest _id wins — stable, not "whichever the index returned first".
    const expected = [lahoreId, String(second._id)].sort()[0];
    assert.equal(String(result.warehouseId), expected);
    assert.match(result.note ?? '', /more than one active warehouse/i);
    await WarehouseModel.findByIdAndDelete(second._id);
  });

  await test('when one of the duplicates is Main, Main wins', async () => {
    await WarehouseModel.updateMany({ isMain: true }, { $set: { isMain: false } });
    await WarehouseModel.updateOne({ _id: lahoreId }, { $set: { isMain: true } });
    const second = await WarehouseModel.create({
      name: 'Lahore Overflow', city: 'Lahore', cityKey: 'lahore', isActive: true,
    });
    const user = await makeUser({ address: { city: 'Lahore' } });
    const result = await resolveWarehouseForUser(String(user._id));
    assert.equal(String(result.warehouseId), lahoreId);
    await WarehouseModel.findByIdAndDelete(second._id);
    await WarehouseModel.updateOne({ _id: lahoreId }, { $set: { isMain: false } });
    await WarehouseModel.updateOne({ _id: mainId }, { $set: { isMain: true } });
  });

  await test('with no Main configured at all, resolution fails loudly', async () => {
    await WarehouseModel.updateMany({}, { $set: { isMain: false } });
    await rejectsWith(resolveMainWarehouseId(), /no main warehouse/i);
    const user = await makeUser({ address: { city: 'Quetta' } });
    await rejectsWith(resolveWarehouseForUser(String(user._id)), /no main warehouse/i);
    await WarehouseModel.updateOne({ _id: mainId }, { $set: { isMain: true } });
  });

  // -------------------------------------------------------------------------
  console.log('\nWarehouse scoping (fails CLOSED for staff)');
  // -------------------------------------------------------------------------
  await test('an admin is unrestricted', async () => {
    const admin = await makeUser({ role: 'admin' });
    assert.equal(await resolveWarehouseScope(String(admin._id), 'admin'), null);
  });

  await test('warehouse staff are scoped to their own warehouse', async () => {
    const staff = await makeUser({ role: 'warehouse_staff', warehouseId: lahoreId });
    const scope = await resolveWarehouseScope(String(staff._id), 'warehouse_staff');
    assert.equal(String(scope), lahoreId);
  });

  await test('warehouse staff with NO warehouse are locked out, not handed everything', async () => {
    // Deliberately the opposite of `resolveCityScope`, which fails open for a read-only list.
    const staff = await makeUser({ role: 'warehouse_staff' });
    await rejectsWith(
      resolveWarehouseScope(String(staff._id), 'warehouse_staff'),
      /not assigned to a warehouse/i,
    );
  });

  await test('a manager WITH a warehouse is scoped to it', async () => {
    const manager = await makeUser({ role: 'warehouse_manager', warehouseId: mainId });
    assert.equal(String(await resolveWarehouseScope(String(manager._id), 'warehouse_manager')), mainId);
  });

  await test('a manager with NO warehouse is company-wide', async () => {
    const manager = await makeUser({ role: 'warehouse_manager' });
    assert.equal(await resolveWarehouseScope(String(manager._id), 'warehouse_manager'), null);
  });

  await test('staff reaching another warehouse get a forbidden, not empty data', async () => {
    const staff = await makeUser({ role: 'warehouse_staff', warehouseId: lahoreId });
    await assertWarehouseAccess(String(staff._id), 'warehouse_staff', lahoreId);
    await rejectsWith(
      assertWarehouseAccess(String(staff._id), 'warehouse_staff', mainId),
      /do not have access/i,
    );
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} warehouse resolver/scope tests passed.`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('\n✗ FAILED:', err);
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(1);
  });
