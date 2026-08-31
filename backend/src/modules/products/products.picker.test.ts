/**
 * Integration test for the product picker endpoint and the catalogue guard.
 *
 * An order taker must be able to SELECT a product while booking an order without being able to
 * READ the catalogue: no purchase cost, no last purchase rate, no low-stock level, and above all
 * no populated `createdBy`, whose user document carries salary, notes, home address and phone.
 *
 * Runs against a throwaway in-memory MongoDB — never the real database.
 *
 * Run with: npm run test:products:picker
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Request, Response, NextFunction } from 'express';

import { ProductModel } from '../../models/product.model';
import { CategoryModel } from '../../models/category.model';
import { UserModel } from '../../models/user.model';
import { requireRoles } from '../../middleware/roles.middleware';
import * as productsService from './products.service';
import { CATALOG_ROLES } from './products.routes';

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
  'createdBy',
  'extras',
  'description',
  'onlinePrice',
];

let mongod: MongoMemoryServer;

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
}

/** Runs a `requireRoles` guard for one role and reports whether it called `next()` cleanly. */
function guardAllows(role: string, roles: readonly string[]): boolean {
  let allowed = false;
  const next: NextFunction = ((err?: unknown) => {
    if (!err) allowed = true;
  }) as NextFunction;
  requireRoles(...roles)({ user: { role } } as unknown as Request, {} as Response, next);
  return allowed;
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

  await test('the whole payload contains no trace of the creator\'s salary or notes', async () => {
    // Belt and braces: a future `.populate()` added in the wrong place would show up here even if
    // it arrived under a key FORBIDDEN_KEYS does not list.
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
    assert.deepEqual((await productsService.findForPicker({ search: 'cola' })).map((r) => r.barcode), [
      'B-001',
    ]);
    assert.deepEqual((await productsService.findForPicker({ search: 'B-002' })).map((r) => r.barcode), [
      'B-002',
    ]);
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
  console.log('\nWho may read the full catalogue');
  // -------------------------------------------------------------------------
  await test('admin, sales manager and both warehouse roles pass the catalogue guard', () => {
    for (const role of ['admin', 'sales_manager', 'warehouse_manager', 'warehouse_staff']) {
      assert.ok(guardAllows(role, CATALOG_ROLES), `${role} was refused the catalogue`);
    }
  });

  await test('order_taker, delivery_man and employee are refused the full catalogue', () => {
    for (const role of ['order_taker', 'delivery_man', 'employee']) {
      assert.ok(!guardAllows(role, CATALOG_ROLES), `${role} reached the catalogue`);
    }
  });

  await test('the guard list itself has not quietly grown a field role', () => {
    assert.deepEqual([...CATALOG_ROLES].sort(), [
      'admin',
      'sales_manager',
      'warehouse_manager',
      'warehouse_staff',
    ]);
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
