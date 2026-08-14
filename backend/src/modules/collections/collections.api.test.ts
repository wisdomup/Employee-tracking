/**
 * HTTP-layer test for the collection module.
 *
 * The other two collection suites call services directly, which means they prove the business
 * logic but say NOTHING about whether the module is reachable or protected. This one boots the
 * real Express app against a throwaway in-memory MongoDB and drives it over HTTP with real
 * JWTs, so it covers the layers those tests skip:
 *
 *   - route wiring (every endpoint exists and is mounted)
 *   - `requireRoles` — spec §7's "rider cannot edit or delete their own entries" is enforced by
 *     the route table, so it can only be verified here
 *   - controller scope narrowing (a rider asking for another rider's data gets their own)
 *   - Joi validation + `stripUnknown`
 *   - static-vs-`/:id` route ordering
 *   - the global error handler's status codes
 *
 * Run with: npm run test:collections:api
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';

// The app reads JWT_SECRET at call time, but set it before importing anything that might cache.
process.env.JWT_SECRET = 'collections-api-test-secret';

import app from '../../app';
import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { OrderModel } from '../../models/order.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { SettlementModel } from '../../models/settlement.model';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

const ADMIN = new Types.ObjectId();
const TAKER = new Types.ObjectId();
const R1 = new Types.ObjectId();
const R2 = new Types.ObjectId();

let mongod: MongoMemoryServer;
let server: http.Server;
let baseUrl: string;
let lahoreShop: Types.ObjectId;
let karachiShop: Types.ObjectId;

const tokens: Record<string, string> = {};

function signToken(id: Types.ObjectId, username: string, role: string): string {
  return jwt.sign({ sub: String(id), username, role }, process.env.JWT_SECRET!, {
    expiresIn: '1h',
  });
}

interface Res<T = any> {
  status: number;
  body: T;
}

/** Minimal HTTP client. `who` selects a seeded token; omit it to send no Authorization header. */
async function call<T = any>(
  method: string,
  path: string,
  opts: { who?: keyof typeof tokens; body?: unknown } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.who) headers.Authorization = `Bearer ${tokens[opts.who]}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response — keep the raw text for the assertion message */
  }
  return { status: response.status, body: body as T };
}

async function seed(): Promise<void> {
  await UserModel.create([
    { _id: ADMIN, userID: 'ADM', username: 'admin.one', phone: '0300000000', password: 'x', role: 'admin', isActive: true },
    { _id: TAKER, userID: 'OT1', username: 'taker', phone: '0300000001', password: 'x', role: 'order_taker', isActive: true, address: { city: 'Lahore' } },
    { _id: R1, userID: 'DM1', username: 'ali', fullName: 'Ali Raza', phone: '0300000002', password: 'x', role: 'delivery_man', isActive: true, address: { city: 'Lahore' } },
    { _id: R2, userID: 'DM2', username: 'daud', fullName: 'Daud Ali', phone: '0300000003', password: 'x', role: 'delivery_man', isActive: true, address: { city: 'Karachi' } },
  ]);

  tokens.admin = signToken(ADMIN, 'admin.one', 'admin');
  tokens.taker = signToken(TAKER, 'taker', 'order_taker');
  tokens.r1 = signToken(R1, 'ali', 'delivery_man');
  tokens.r2 = signToken(R2, 'daud', 'delivery_man');

  const [s1, s2] = await DealerModel.create([
    { name: 'Ahmed Traders', shopName: 'Ahmed Kiryana', phone: '0311111111', address: { city: 'Lahore' }, latitude: 31.52, longitude: 74.35 },
    { name: 'Karachi Shop', shopName: 'KS', phone: '0311111112', address: { city: 'Karachi' } },
  ]);
  lahoreShop = s1._id as Types.ObjectId;
  karachiShop = s2._id as Types.ObjectId;
}

async function makeOrder(
  dealerId: Types.ObjectId,
  grandTotal: number,
  rider: Types.ObjectId | null = R1,
  status = 'approved',
) {
  return OrderModel.create({
    dealerId,
    createdBy: TAKER,
    products: [],
    grandTotal,
    totalPrice: grandTotal,
    status,
    ...(rider ? { assignedRiderId: rider, assignedAt: new Date() } : {}),
  });
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'collections-api-test' });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  // eslint-disable-next-line no-console
  console.log(`Real Express app listening on ${baseUrl}\n`);

  await seed();

  // -------------------------------------------------------------------------
  console.log('Authentication');
  // -------------------------------------------------------------------------
  await test('every collection endpoint requires a token', async () => {
    for (const [method, path] of [
      ['GET', '/collections/my/orders'],
      ['GET', '/collections/my/balance'],
      ['GET', '/collections/report'],
      ['GET', '/collections/activity'],
      ['GET', '/collections/settlements'],
    ] as const) {
      const res = await call(method, path);
      assert.equal(res.status, 401, `${method} ${path} should be 401 without a token`);
    }
  });

  await test('a garbage token is rejected, not ignored', async () => {
    const response = await fetch(`${baseUrl}/collections/my/orders`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(response.status, 401);
  });

  // -------------------------------------------------------------------------
  console.log('\nRoute wiring — every endpoint is mounted and reachable');
  // -------------------------------------------------------------------------
  await test('rider endpoints respond for a rider', async () => {
    assert.equal((await call('GET', '/collections/my/orders', { who: 'r1' })).status, 200);
    assert.equal((await call('GET', '/collections/my/balance', { who: 'r1' })).status, 200);
    assert.equal((await call('GET', '/collections/recoveries', { who: 'r1' })).status, 200);
    assert.equal((await call('GET', '/collections/settlements', { who: 'r1' })).status, 200);
  });

  await test('admin report endpoints respond for an admin', async () => {
    assert.equal((await call('GET', '/collections/report', { who: 'admin' })).status, 200);
    assert.equal((await call('GET', '/collections/activity', { who: 'admin' })).status, 200);
    assert.equal((await call('GET', '/collections/day-end', { who: 'admin' })).status, 200);
    assert.equal((await call('GET', '/collections/riders', { who: 'admin' })).status, 200);
  });

  await test('static paths are not swallowed by the /:id correction route', async () => {
    // `/report`, `/activity`, `/riders` are declared before `PATCH /:id` and `POST /:id/void`.
    // If that ordering ever regressed, these would 404 or be treated as ids.
    const report = await call('GET', '/collections/report', { who: 'admin' });
    assert.equal(report.status, 200);
    assert.ok(Array.isArray(report.body.rows), 'report returns its own shape, not an entity');

    const riders = await call('GET', '/collections/riders', { who: 'admin' });
    assert.ok(Array.isArray(riders.body), 'riders returns an array');
  });

  // -------------------------------------------------------------------------
  console.log('\nRole gates (spec §7 lives in the route table)');
  // -------------------------------------------------------------------------
  await test('a rider cannot reach any admin-only report', async () => {
    assert.equal((await call('GET', '/collections/report', { who: 'r1' })).status, 403);
    assert.equal((await call('GET', '/collections/riders', { who: 'r1' })).status, 403);
  });

  await test('a rider cannot correct or void ANY entry — the core §7 guarantee', async () => {
    const fakeId = new Types.ObjectId();
    for (const [method, path, body] of [
      ['PATCH', `/collections/${fakeId}`, { cash: 1, online: 0, credit: 0 }],
      ['POST', `/collections/${fakeId}/void`, { reason: 'trying it on' }],
      ['PATCH', `/collections/recoveries/${fakeId}`, { amount: 1 }],
      ['POST', `/collections/recoveries/${fakeId}/void`, { reason: 'trying it on' }],
      ['PATCH', `/collections/settlements/${fakeId}`, { amount: 1 }],
      ['POST', `/collections/settlements/${fakeId}/void`, { reason: 'trying it on' }],
      ['PATCH', `/collections/settlements/${fakeId}/receive`, {}],
    ] as const) {
      const res = await call(method, path, { who: 'r1', body });
      assert.equal(res.status, 403, `${method} ${path} must be forbidden for a rider`);
    }
  });

  await test('an order taker cannot reach the rider or admin surfaces', async () => {
    assert.equal((await call('GET', '/collections/my/orders', { who: 'taker' })).status, 403);
    assert.equal((await call('GET', '/collections/report', { who: 'taker' })).status, 403);
    assert.equal((await call('GET', '/collections/settlements', { who: 'taker' })).status, 403);
  });

  await test('only an admin can assign a rider to an order', async () => {
    const order = await makeOrder(lahoreShop, 500, null);
    const asRider = await call('PATCH', `/orders/${order._id}/assign-rider`, {
      who: 'r1',
      body: { assignedRiderId: String(R1) },
    });
    assert.equal(asRider.status, 403);

    const asTaker = await call('PATCH', `/orders/${order._id}/assign-rider`, {
      who: 'taker',
      body: { assignedRiderId: String(R1) },
    });
    assert.equal(asTaker.status, 403);

    const asAdmin = await call('PATCH', `/orders/${order._id}/assign-rider`, {
      who: 'admin',
      body: { assignedRiderId: String(R1) },
    });
    assert.equal(asAdmin.status, 200);
  });

  // -------------------------------------------------------------------------
  console.log('\nController scope narrowing');
  // -------------------------------------------------------------------------
  await test("a rider asking for another rider's data silently gets their own", async () => {
    // The controller OVERWRITES riderId rather than validating it, so this must not leak.
    const res = await call('GET', `/collections/recoveries?riderId=${R2}`, { who: 'r1' });
    assert.equal(res.status, 200);
    assert.ok(
      res.body.rows.every((r: any) => String(r.riderId) === String(R1)),
      "a rider must never see another rider's entries",
    );
  });

  await test('a rider cannot widen the settlement list to everyone', async () => {
    const res = await call('GET', '/collections/settlements?riderId=all', { who: 'r1' });
    assert.equal(res.status, 200);
    assert.ok(res.body.rows.every((r: any) => String(r.riderId) === String(R1)));
  });

  await test('an admin CAN filter to a specific rider', async () => {
    const res = await call('GET', `/collections/recoveries?riderId=${R1}`, { who: 'admin' });
    assert.equal(res.status, 200);
  });

  // -------------------------------------------------------------------------
  console.log('\nValidation (Joi + stripUnknown)');
  // -------------------------------------------------------------------------
  await test('a deliver call missing a split component is rejected as a validation error', async () => {
    const order = await makeOrder(lahoreShop, 1000);
    await call('PATCH', `/collections/orders/${order._id}/packed`, { who: 'r1' });

    const res = await call('POST', `/collections/orders/${order._id}/deliver`, {
      who: 'r1',
      body: { cash: 1000 },
    });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /online/i, 'the message names the missing field');
  });

  await test('a negative component is rejected before it reaches the service', async () => {
    const order = await makeOrder(lahoreShop, 1000);
    await call('PATCH', `/collections/orders/${order._id}/packed`, { who: 'r1' });
    const res = await call('POST', `/collections/orders/${order._id}/deliver`, {
      who: 'r1',
      body: { cash: -100, online: 1100, credit: 0 },
    });
    assert.equal(res.status, 400);
  });

  await test('an injected orderAmount is stripped, not honoured', async () => {
    // stripUnknown means a client cannot shrink the total the split is checked against.
    const order = await makeOrder(lahoreShop, 1000);
    await call('PATCH', `/collections/orders/${order._id}/packed`, { who: 'r1' });
    const res = await call('POST', `/collections/orders/${order._id}/deliver`, {
      who: 'r1',
      body: { cash: 10, online: 0, credit: 0, orderAmount: 10, grandTotal: 10 },
    });
    assert.equal(res.status, 400, 'still validated against the real Rs. 1000');
    assert.match(JSON.stringify(res.body), /990/, 'the shortfall is against the true amount');
  });

  await test('a void without a reason is rejected', async () => {
    const fakeId = new Types.ObjectId();
    const res = await call('POST', `/collections/${fakeId}/void`, { who: 'admin', body: {} });
    assert.equal(res.status, 400);
  });

  await test('a malformed date query is a 400, not a 500', async () => {
    const res = await call('GET', '/collections/report?from=31-07-2026', { who: 'admin' });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Invalid date/);
  });

  // -------------------------------------------------------------------------
  console.log('\nEnd-to-end over HTTP');
  // -------------------------------------------------------------------------
  let e2eCollectionId = '';

  await test('the full rider journey works through the real stack', async () => {
    const order = await makeOrder(lahoreShop, 12000);

    const listed = await call('GET', '/collections/my/orders', { who: 'r1' });
    assert.equal(listed.status, 200);
    const group = listed.body.groups.find((g: any) => g.dealer._id === String(lahoreShop));
    assert.ok(group, 'the order is grouped under its client');
    assert.equal(group.dealer.hasLocation, true, 'the map pin is present for Start');

    const packed = await call('PATCH', `/collections/orders/${order._id}/packed`, { who: 'r1' });
    assert.equal(packed.status, 200);
    assert.equal(packed.body.order.status, 'packed');

    const delivered = await call('POST', `/collections/orders/${order._id}/deliver`, {
      who: 'r1',
      body: { cash: 7000, online: 3000, credit: 2000 },
    });
    assert.equal(delivered.status, 201);
    assert.equal(delivered.body.order.status, 'delivered');
    assert.equal(delivered.body.balance.cash.inHand, 7000);
    e2eCollectionId = delivered.body.collection._id;
  });

  await test('a double-tap on Delivered returns a readable 409, not a raw duplicate-key error', async () => {
    const order = await OrderModel.findOne({ status: 'delivered', assignedRiderId: R1 }).lean();
    const res = await call('POST', `/collections/orders/${order!._id}/deliver`, {
      who: 'r1',
      body: { cash: 7000, online: 3000, credit: 2000 },
    });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /already been delivered/i);
    assert.ok(!/E11000|duplicate key/i.test(res.body.message), 'no raw Mongo error leaks out');
  });

  await test("another rider cannot touch the first rider's order", async () => {
    const order = await makeOrder(lahoreShop, 300, R1);
    const res = await call('PATCH', `/collections/orders/${order._id}/packed`, { who: 'r2' });
    assert.equal(res.status, 403);
    assert.match(res.body.message, /not assigned to you/i);
  });

  await test('the cash settlement two-step works over HTTP and only step 2 moves the balance', async () => {
    const before = await call('GET', '/collections/my/balance', { who: 'r1' });
    const held = before.body.cash.inHand;
    assert.ok(held > 0);

    const submitted = await call('POST', '/collections/settlements', {
      who: 'r1',
      body: { mode: 'cash', amount: held },
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.settlement.status, 'pending');
    assert.equal(submitted.body.balance.cash.inHand, held, 'step 1 does not reduce the balance');

    const settlementId = submitted.body.settlement._id;
    const received = await call('PATCH', `/collections/settlements/${settlementId}/receive`, {
      who: 'admin',
      body: {},
    });
    assert.equal(received.status, 200);
    assert.equal(received.body.riderBalance.cash.inHand, 0, 'step 2 does');

    const again = await call('PATCH', `/collections/settlements/${settlementId}/receive`, {
      who: 'admin',
      body: {},
    });
    assert.equal(again.status, 409, 'a second confirmation is refused');
  });

  await test('an admin correction over HTTP moves the balance and is audited', async () => {
    const res = await call('PATCH', `/collections/${e2eCollectionId}`, {
      who: 'admin',
      body: { cash: 5000, online: 5000, credit: 2000, reason: 'Rs. 2000 was a transfer' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.corrections.length, 1);
    assert.equal(res.body.corrections[0].from.cash, 7000);
    assert.equal(res.body.corrections[0].to.cash, 5000);
  });

  await test('an unbalanced correction is refused with the arithmetic spelled out', async () => {
    const res = await call('PATCH', `/collections/${e2eCollectionId}`, {
      who: 'admin',
      body: { cash: 5000, online: 5000, credit: 5000 },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /more than the order total/);
  });

  await test('the report reflects everything, city-grouped, with matching totals', async () => {
    const res = await call('GET', '/collections/report', { who: 'admin' });
    assert.equal(res.status, 200);
    const rowSum = res.body.rows.reduce((s: number, r: any) => s + r.amount, 0);
    const citySum = res.body.cities.reduce((s: number, c: any) => s + c.amount, 0);
    assert.equal(res.body.totals.amount, rowSum);
    assert.equal(res.body.totals.amount, citySum);
    assert.ok(res.body.rows.every((r: any) => r.cityKey === 'lahore'));
  });

  await test('a Karachi filter returns nothing from a Lahore rider — the no-mixing proof', async () => {
    const res = await call('GET', '/collections/report?cityKey=karachi', { who: 'admin' });
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.count, 0);
    assert.equal(res.body.totals.amount, 0);
  });

  await test('a rider with zero activity still appears in All Riders activity', async () => {
    const res = await call('GET', '/collections/activity', { who: 'admin' });
    assert.equal(res.status, 200);
    const daud = res.body.riders.find((r: any) => r.rider.id === String(R2));
    assert.ok(daud, 'the roster drives the list');
    assert.equal(daud.counts.delivered, 0);
  });

  await test('a cross-city delivery is refused over HTTP', async () => {
    const order = await makeOrder(karachiShop, 600, R1);
    await call('PATCH', `/collections/orders/${order._id}/packed`, { who: 'r1' });
    const res = await call('POST', `/collections/orders/${order._id}/deliver`, {
      who: 'r1',
      body: { cash: 600, online: 0, credit: 0 },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /cannot cross cities/i);
  });

  await test('trashing an order with a live collection is a 409 through the real handler', async () => {
    const collection = await DeliveryCollectionModel.findById(e2eCollectionId).lean();
    const res = await call('DELETE', `/orders/${collection!.orderId}`, { who: 'admin' });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /Void that entry/);
  });

  // -------------------------------------------------------------------------
  console.log('\nAPI documentation');
  // -------------------------------------------------------------------------
  await test('the collection routes appear in the Swagger spec', async () => {
    // `config/swagger.ts` uses an explicit allowlist of route files, not a glob — a new module
    // is invisible in /api/docs until it is added there, and nothing else would catch it.
    const res = await call('GET', '/docs.json', { who: 'admin' });
    assert.equal(res.status, 200);
    const paths = Object.keys(res.body.paths ?? {});
    const collectionPaths = paths.filter((p) => p.startsWith('/api/collections'));
    assert.ok(
      collectionPaths.length >= 10,
      `expected the collection endpoints to be documented, found ${collectionPaths.length}`,
    );
    for (const expected of [
      '/api/collections/my/orders',
      '/api/collections/orders/{orderId}/deliver',
      '/api/collections/recoveries',
      '/api/collections/settlements',
      '/api/collections/report',
      '/api/collections/activity',
      '/api/collections/day-end',
    ]) {
      assert.ok(paths.includes(expected), `${expected} is missing from the API docs`);
    }
    assert.ok(paths.includes('/api/orders/{id}/assign-rider'), 'assign-rider is documented');
  });

  // -------------------------------------------------------------------------
  console.log('\nRegression guard: the rest of the app still works');
  // -------------------------------------------------------------------------
  await test('a rider can now read the client list, scoped to their own city', async () => {
    // C1: `resolveCityScope` already listed delivery_man, but the route gate had locked them out.
    const res = await call('GET', '/dealers', { who: 'r1' });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(
      res.body.every((d: any) => (d.address?.city ?? '').toLowerCase().trim() === 'lahore'),
      'a Lahore rider sees only Lahore clients',
    );
  });

  await test('a Karachi rider sees a different client list', async () => {
    const res = await call('GET', '/dealers', { who: 'r2' });
    assert.equal(res.status, 200);
    assert.ok(res.body.every((d: any) => (d.address?.city ?? '').toLowerCase().trim() === 'karachi'));
  });

  await test('the orders module still works and now carries the rider', async () => {
    const res = await call('GET', '/orders', { who: 'admin' });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    const assigned = res.body.find((o: any) => o.assignedRiderId);
    assert.ok(assigned, 'assignedRiderId is populated on the list');
    assert.ok(assigned.assignedRiderId.username, 'and it is a populated user, not a bare id');
  });

  await test('the unassigned filter finds orders nobody is carrying', async () => {
    await makeOrder(lahoreShop, 250, null);
    const res = await call('GET', '/orders?assignedRiderId=unassigned', { who: 'admin' });
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
    assert.ok(res.body.every((o: any) => !o.assignedRiderId));
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} collection API tests passed.`);
}

main()
  .then(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('\n✗ FAILED:', err);
    await new Promise<void>((resolve) => server?.close(() => resolve())).catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(1);
  });
