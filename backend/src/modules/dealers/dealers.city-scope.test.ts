/**
 * Integration test for city-scoped client visibility.
 *
 * A rider should only see clients in their own city. Runs against a throwaway
 * in-memory MongoDB — never the real database.
 *
 * Run with: npm run test:city-scope
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import * as dealersService from './dealers.service';
import { resolveCityScope } from '../users/users.service';

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

const LAHORE_RIDER = new Types.ObjectId();
const KARACHI_RIDER = new Types.ObjectId();
const NO_CITY_RIDER = new Types.ObjectId();
const MESSY_CITY_RIDER = new Types.ObjectId();
const ADMIN = new Types.ObjectId();
const MANAGER = new Types.ObjectId();

let mongod: MongoMemoryServer;

/** Names of the clients a given scope returns, sorted for stable comparison. */
async function visibleNames(cityScope: string | null): Promise<string[]> {
  const rows = await dealersService.findAll({ cityScope });
  return rows.map((d) => d.name).sort();
}

async function seed(): Promise<void> {
  await UserModel.create([
    { _id: LAHORE_RIDER, userID: 'R-LHR', username: 'rider.lahore', phone: '0300000001', password: 'x', role: 'order_taker', address: { city: 'Lahore' } },
    { _id: KARACHI_RIDER, userID: 'R-KHI', username: 'rider.karachi', phone: '0300000002', password: 'x', role: 'order_taker', address: { city: 'Karachi' } },
    { _id: NO_CITY_RIDER, userID: 'R-NON', username: 'rider.nocity', phone: '0300000003', password: 'x', role: 'order_taker' },
    // Sloppy data entry: different case and stray whitespace.
    { _id: MESSY_CITY_RIDER, userID: 'R-MSY', username: 'rider.messy', phone: '0300000004', password: 'x', role: 'order_taker', address: { city: '  lahore ' } },
    { _id: ADMIN, userID: 'ADM', username: 'admin.one', phone: '0300000005', password: 'x', role: 'admin', address: { city: 'Lahore' } },
    { _id: MANAGER, userID: 'SM', username: 'manager.one', phone: '0300000006', password: 'x', role: 'sales_manager', address: { city: 'Lahore' } },
  ]);

  await DealerModel.create([
    { name: 'Lahore Shop A', phone: '0311111101', address: { city: 'Lahore' } },
    // Same city, different casing/spacing — must still be visible to a Lahore rider.
    { name: 'Lahore Shop B', phone: '0311111102', address: { city: 'lahore' } },
    { name: 'Lahore Shop C', phone: '0311111103', address: { city: ' Lahore ' } },
    { name: 'Karachi Shop A', phone: '0311111104', address: { city: 'Karachi' } },
    { name: 'No City Shop', phone: '0311111105', address: {} },
    // Soft-deleted — must never appear regardless of city.
    { name: 'Trashed Lahore Shop', phone: '0311111106', address: { city: 'Lahore' }, isTrashed: true },
  ]);
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'city-scope-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await seed();

  // -------------------------------------------------------------------------
  console.log('Resolving a viewer\'s city scope');
  // -------------------------------------------------------------------------
  await test('a rider with a city resolves to that city', async () => {
    assert.equal(await resolveCityScope(String(LAHORE_RIDER), 'order_taker'), 'Lahore');
  });

  await test('a rider\'s city is trimmed before use', async () => {
    assert.equal(await resolveCityScope(String(MESSY_CITY_RIDER), 'order_taker'), 'lahore');
  });

  await test('a rider with NO city resolves to null (sees everything, does not get locked out)', async () => {
    assert.equal(await resolveCityScope(String(NO_CITY_RIDER), 'order_taker'), null);
  });

  await test('admin and sales_manager are never city-scoped, even with a city set', async () => {
    assert.equal(await resolveCityScope(String(ADMIN), 'admin'), null);
    assert.equal(await resolveCityScope(String(MANAGER), 'sales_manager'), null);
  });

  // -------------------------------------------------------------------------
  console.log('\nFiltering the client list');
  // -------------------------------------------------------------------------
  await test('a Lahore rider sees only Lahore clients', async () => {
    const names = await visibleNames('Lahore');
    assert.deepEqual(names, ['Lahore Shop A', 'Lahore Shop B', 'Lahore Shop C']);
  });

  await test('city match ignores case and surrounding whitespace on BOTH sides', async () => {
    // Rider city "  lahore " must still match dealers stored as "Lahore" / " Lahore ".
    assert.deepEqual(await visibleNames('  lahore '), [
      'Lahore Shop A',
      'Lahore Shop B',
      'Lahore Shop C',
    ]);
  });

  await test('a Karachi rider never sees Lahore clients', async () => {
    const names = await visibleNames('Karachi');
    assert.deepEqual(names, ['Karachi Shop A']);
    assert.ok(!names.some((n) => n.includes('Lahore')));
  });

  await test('clients with no city are hidden from city-scoped riders', async () => {
    const names = await visibleNames('Lahore');
    assert.ok(!names.includes('No City Shop'));
  });

  await test('trashed clients stay hidden even when the city matches', async () => {
    const names = await visibleNames('Lahore');
    assert.ok(!names.includes('Trashed Lahore Shop'));
  });

  await test('an unrestricted viewer (null scope) sees every non-trashed client', async () => {
    const names = await visibleNames(null);
    assert.deepEqual(names, [
      'Karachi Shop A',
      'Lahore Shop A',
      'Lahore Shop B',
      'Lahore Shop C',
      'No City Shop',
    ]);
  });

  await test('a city with no clients returns an empty list, not everything', async () => {
    assert.deepEqual(await visibleNames('Islamabad'), []);
  });

  await test('a city name containing regex characters is matched literally', async () => {
    await DealerModel.create({ name: 'Regex Shop', phone: '0311111107', address: { city: 'A.B' } });
    // "A.B" must not match "AXB" — the dot is escaped, not a wildcard.
    await DealerModel.create({ name: 'Wildcard Trap', phone: '0311111108', address: { city: 'AXB' } });
    assert.deepEqual(await visibleNames('A.B'), ['Regex Shop']);
  });

  // -------------------------------------------------------------------------
  console.log('\nDirect access by id (URL guessing)');
  // -------------------------------------------------------------------------
  await test('a rider can open a client in their own city', async () => {
    const shop = await DealerModel.findOne({ name: 'Lahore Shop A' });
    const found = await dealersService.findById(String(shop!._id), 'Lahore');
    assert.equal(found.name, 'Lahore Shop A');
  });

  await test('a rider CANNOT open a client from another city by guessing the id', async () => {
    const shop = await DealerModel.findOne({ name: 'Karachi Shop A' });
    await rejectsWith(dealersService.findById(String(shop!._id), 'Lahore'), /not found/i);
  });

  await test('an unrestricted viewer can open any client', async () => {
    const shop = await DealerModel.findOne({ name: 'Karachi Shop A' });
    const found = await dealersService.findById(String(shop!._id), null);
    assert.equal(found.name, 'Karachi Shop A');
  });

  // -------------------------------------------------------------------------
  console.log('\nNearby search');
  // -------------------------------------------------------------------------
  await test('nearby search is city-scoped too', async () => {
    await DealerModel.create([
      { name: 'Near Lahore', phone: '0311111109', latitude: 31.5204, longitude: 74.3587, address: { city: 'Lahore' } },
      { name: 'Near Karachi', phone: '0311111110', latitude: 31.5205, longitude: 74.3588, address: { city: 'Karachi' } },
    ]);
    // Both are at practically the same coordinates, so only the city can separate them.
    const nearby = await dealersService.findByLocation(31.5204, 74.3587, 5, 'Lahore');
    const names = nearby.map((d) => d.name);
    assert.ok(names.includes('Near Lahore'));
    assert.ok(!names.includes('Near Karachi'), 'another city must not leak into nearby results');
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} city-scope tests passed.`);
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
