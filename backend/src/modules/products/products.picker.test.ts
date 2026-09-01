/**
 * Integration test for the product picker endpoint.
 *
 * A Salesman must be able to SELECT a product while booking an order without holding
 * `products:view` — the cell that opens the /products catalogue screen and the catalogue API.
 * The seeded `order_taker` policy deliberately omits `products:view`, so before this endpoint
 * existed the order form's product list answered 403 and no order could be booked at all.
 *
 * What the picker must not leak: purchase cost, last purchase rate, low-stock level, and the
 * populated `createdBy` user, whose document carries salary, notes, home address and phone.
 *
 * Runs against a throwaway in-memory MongoDB — never the real database.
 *
 * Run with: npm run test:products:picker
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ProductModel } from '../../models/product.model';
import { CategoryModel } from '../../models/category.model';
import { UserModel } from '../../models/user.model';
import { seedAccessPolicies } from '../../database/seeds/access-policies.seed';
import { invalidateAccessCache, resolveAccess, accessAllows } from '../../services/access-control.service';
import { PermissionKey } from '../../constants/permissions';
import * as productsService from './products.service';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

const ADMIN = new Types.ObjectId();
const CATEGORY = new Types.ObjectId();
const OTHER_CATEGORY = new Types.ObjectId();

/** Exactly the keys a picker row may carry. Mongoose always returns `_id`. */
const ALLOWED_KEYS = ['_id', 'barcode', 'name', 'salePrice', 'quantity', 'categoryId'];

/** Fields whose presence in a picker row would be the leak this endpoint exists to prevent. */
const FORBIDDEN_KEYS = [
  'purchasePrice',
  'lastPurchaseRate',
  'survivalQuantity',
  'damagedQuantity',
  'createdBy',
  'extras',
  'description',
  'onlinePrice',
];

/**
 * The guard on GET /api/products/picker. Kept in step with products.routes.ts by hand — the
 * route cannot export it, because `requireAnyPermission` is applied at module load.
 */
const PICKER_PERMISSIONS: PermissionKey[] = [
  'orders:add',
  'orders:edit',
  'returns:add',
  'returns:edit',
  'products:view',
];

let mongod: MongoMemoryServer;

/** Does this role pass the picker guard — i.e. hold ANY of its permissions? */
async function passesPickerGuard(role: string): Promise<boolean> {
  const access = await resolveAccess({ role });
  return PICKER_PERMISSIONS.some((p) => accessAllows(access, p));
}

async function holds(role: string, permission: PermissionKey): Promise<boolean> {
  return accessAllows(await resolveAccess({ role }), permission);
}

async function seed(): Promise<void> {
  await UserModel.create({
    _id: ADMIN,
    userID: 'ADM',
    username: 'admin.one',
    phone: '0300000001',
    password: 'x',
    role: 'admin',
    // The three reasons `createdBy` must never be populated for a picker caller.
    perks: { salary: 250000, bonus: 40000, allowance: 10000 },
    extraNotes: 'On probation until March.',
    address: { street: '12 Private Road', city: 'Lahore' },
  });

  await CategoryModel.create([
    { _id: CATEGORY, name: 'Beverages', createdBy: ADMIN },
    { _id: OTHER_CATEGORY, name: 'Snacks', createdBy: ADMIN },
  ]);

  await ProductModel.create([
    {
      barcode: 'B-001',
      name: 'Cola 500ml',
      description: 'internal note about the supplier',
      salePrice: 120,
      purchasePrice: 80,
      onlinePrice: 115,
      quantity: 42,
      survivalQuantity: 10,
      lastPurchaseRate: 78,
      extras: { shelf: 'A3' },
      categoryId: CATEGORY,
      createdBy: ADMIN,
    },
    {
      barcode: 'B-002',
      name: 'Chips Salted',
      salePrice: 60,
      purchasePrice: 35,
      quantity: 0,
      categoryId: OTHER_CATEGORY,
      createdBy: ADMIN,
    },
    {
      barcode: 'B-003',
      name: 'Trashed Cola',
      salePrice: 120,
      categoryId: CATEGORY,
      createdBy: ADMIN,
      isTrashed: true,
    },
  ]);

  // Every non-admin answer below comes from the seeded matrix, not from a hardcoded list.
  await seedAccessPolicies({ force: true, backfillUsers: false });
  invalidateAccessCache();
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'products-picker-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  await seed();

  // -------------------------------------------------------------------------
  console.log('What the picker projection returns');
  // -------------------------------------------------------------------------
  await test('every projected field is a real schema path (catches a typo in PICKER_FIELDS)', () => {
    for (const key of ALLOWED_KEYS) {
      assert.ok(
        ProductModel.schema.path(key) !== undefined,
        `PICKER_FIELDS names "${key}", which is not a field on the product schema`,
      );
    }
  });

  await test('a picker row carries the fields a line-item selector needs', async () => {
    const rows = await productsService.findForPicker();
    const cola = rows.find((r) => r.barcode === 'B-001');
    assert.ok(cola, 'the picker returned no row for B-001');
    assert.equal(cola!.name, 'Cola 500ml');
    assert.equal(cola!.salePrice, 120);
    assert.equal(cola!.quantity, 42);
  });

  await test('a picker row carries NOTHING beyond the allowed keys', async () => {
    const rows = await productsService.findForPicker();
    for (const row of rows) {
      const keys = Object.keys(row.toObject());
      const extra = keys.filter((k) => !ALLOWED_KEYS.includes(k) && k !== '__v');
      assert.deepEqual(extra, [], `picker row leaked: ${extra.join(', ')}`);
    }
  });

  await test('cost, stock threshold and the creator record are all absent', async () => {
    const rows = await productsService.findForPicker();
    const plain = rows.map((r) => r.toObject() as Record<string, unknown>);
    for (const key of FORBIDDEN_KEYS) {
      assert.ok(
        plain.every((row) => !(key in row)),
        `"${key}" reached a picker caller`,
      );
    }
  });

  await test("the whole payload contains no trace of the creator's salary or notes", async () => {
    // Belt and braces: a future `.populate()` added in the wrong place would show up here even
    // if it arrived under a key FORBIDDEN_KEYS does not list.
    const serialized = JSON.stringify(await productsService.findForPicker());
    for (const secret of ['250000', 'probation', 'Private Road', '0300000001']) {
      assert.ok(!serialized.includes(secret), `picker payload contains "${secret}"`);
    }
  });

  await test('the category arrives as a name, not the full category document', async () => {
    const rows = await productsService.findForPicker();
    const cola = rows.find((r) => r.barcode === 'B-001');
    const cat = (cola!.toObject() as { categoryId: Record<string, unknown> }).categoryId;
    assert.equal(cat.name, 'Beverages');
    assert.deepEqual(Object.keys(cat).sort(), ['_id', 'name']);
  });

  // -------------------------------------------------------------------------
  console.log('\nFiltering, sorting and soft deletes');
  // -------------------------------------------------------------------------
  await test('trashed products stay hidden', async () => {
    const rows = await productsService.findForPicker();
    assert.ok(!rows.some((r) => r.barcode === 'B-003'), 'a trashed product reached the picker');
    assert.equal(rows.length, 2);
  });

  await test('the categoryId filter narrows the list', async () => {
    const rows = await productsService.findForPicker({ categoryId: String(OTHER_CATEGORY) });
    assert.deepEqual(
      rows.map((r) => r.barcode),
      ['B-002'],
    );
  });

  await test('search matches name or barcode, case-insensitively', async () => {
    assert.deepEqual(
      (await productsService.findForPicker({ search: 'cola' })).map((r) => r.barcode),
      ['B-001'],
    );
    assert.deepEqual(
      (await productsService.findForPicker({ search: 'B-002' })).map((r) => r.barcode),
      ['B-002'],
    );
  });

  await test('a zero-quantity product is still selectable (the form shows the stock warning)', async () => {
    const rows = await productsService.findForPicker();
    const chips = rows.find((r) => r.barcode === 'B-002');
    assert.equal(chips!.quantity, 0);
  });

  await test('picker and catalogue return the same products in the same order', async () => {
    // The order form is a dropdown; changing the sort would silently reshuffle it.
    const picker = (await productsService.findForPicker()).map((r) => String(r._id));
    const catalog = (await productsService.findAll()).map((r) => String(r._id));
    assert.deepEqual(picker, catalog);
  });

  // -------------------------------------------------------------------------
  console.log('\nWho the seeded matrix lets through');
  // -------------------------------------------------------------------------
  await test('the Salesman does NOT hold products:view — the catalogue stays shut', async () => {
    assert.equal(await holds('order_taker', 'products:view'), false);
  });

  await test('the Salesman DOES pass the picker guard, so orders can still be booked', async () => {
    // This is the regression the endpoint exists for: with the order form on GET /api/products,
    // a Salesman got 403 and could not add a line item at all.
    assert.ok(await passesPickerGuard('order_taker'));
    assert.ok(await holds('order_taker', 'orders:add'));
  });

  await test('the Rider passes too — riders book orders as well as deliver', async () => {
    assert.ok(await passesPickerGuard('delivery_man'));
  });

  await test('admin passes everything', async () => {
    assert.ok(await passesPickerGuard('admin'));
    assert.ok(await holds('admin', 'products:view'));
  });

  await test('legacy `employee` passes, because the seed keeps its order-booking grants', async () => {
    // Not a zero-permission role in practice: the seed preserves the 35 endpoints those
    // accounts already reached, `orders:add` among them. So the picker must serve it too —
    // asserting otherwise would be asserting a break for existing users.
    assert.ok(await holds('employee', 'orders:add'));
    assert.ok(await passesPickerGuard('employee'));
  });

  await test('both warehouse roles keep products:view, so their stock forms still load', async () => {
    // `products:view` stopped being baseline for the Salesman's sake; the warehouse seeds hold it
    // explicitly, because stock-in, transfers, damage and opening-stock each load the full list.
    for (const role of ['warehouse_staff', 'warehouse_manager']) {
      assert.ok(await holds(role, 'products:view'), `${role} lost the product list`);
    }
  });

  await test('the Salesman is the only field role whose catalogue is shut', async () => {
    // Riders and legacy employees book orders too, so they also lose products:view — recorded in
    // the parity test's INTENTIONAL list. All three keep the picker.
    for (const role of ['order_taker', 'delivery_man', 'employee']) {
      assert.equal(await holds(role, 'products:view'), false, `${role} can still browse products`);
      assert.ok(await passesPickerGuard(role), `${role} cannot select a product`);
    }
  });

  await test('a caller with no roles at all is refused', async () => {
    assert.equal(await passesPickerGuard(''), false);
    const none = await resolveAccess(undefined);
    assert.equal(PICKER_PERMISSIONS.some((p) => accessAllows(none, p)), false);
  });

  await test('every permission naming the picker guard is a real catalogue key', () => {
    // A typo here would make the guard permanently deny, and `requireAnyPermission` would
    // throw at boot — this fails the test first, with a clearer message.
    const { isValidPermission } = require('../../constants/permissions');
    for (const p of PICKER_PERMISSIONS) {
      assert.ok(isValidPermission(p), `"${p}" is not in the permission catalogue`);
    }
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} product picker tests passed.`);
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
