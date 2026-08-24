/**
 * End-to-end integration test for the permission matrix.
 *
 * Runs against a throwaway in-memory MongoDB (mongodb-memory-server), so it never touches the
 * real database. Drives the real seed, the real resolver and the real service functions, and
 * asserts on what is actually persisted and actually resolved.
 *
 *   npm run test:permissions:flow
 *
 * The static checks next door prove the wiring is consistent. This proves it behaves.
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { UserModel } from '../../models/user.model';
import { AccessPolicyModel } from '../../models/access-policy.model';
import { PermissionProfileModel, buildRoleKey } from '../../models/permission-profile.model';
import { ROLES } from '../../constants/global';
import { seedAccessPolicies } from '../../database/seeds/access-policies.seed';
import {
  resolveAccess,
  accessAllows,
  accessAllowsReport,
  describeAccessForClient,
  invalidateAccessCache,
} from '../../services/access-control.service';
import * as service from './permissions.service';

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
  await mongoose.connect(mongod.getUri(), { dbName: 'permissions-flow-test' });

  // -------------------------------------------------------------------------
  // Seeding
  // -------------------------------------------------------------------------

  await test('seed creates one policy per non-admin role, and none for admin', async () => {
    const result = await seedAccessPolicies({ backfillUsers: false });

    const expected = Object.values(ROLES).filter((r) => r !== ROLES.ADMIN);
    assert.equal(result.created.length, expected.length);

    const adminPolicy = await AccessPolicyModel.findOne({ subjectKey: ROLES.ADMIN }).lean();
    assert.equal(adminPolicy, null, 'admin must never get a stored policy');
  });

  await test('re-seeding does not overwrite a hand-tuned matrix', async () => {
    await service.savePolicy(
      'role',
      ROLES.WAREHOUSE_STAFF,
      { permissions: ['warehouse:view'], reports: [] },
      undefined,
    );

    const result = await seedAccessPolicies({ backfillUsers: false });
    assert.ok(result.skipped.includes(ROLES.WAREHOUSE_STAFF));

    const after = await service.getPolicy('role', ROLES.WAREHOUSE_STAFF);
    assert.deepEqual(Object.keys(after.grants), ['warehouse'], 'the admin edit was clobbered');

    // Put the shipped defaults back for the tests below.
    await seedAccessPolicies({ force: true, backfillUsers: false });
  });

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  await test('admin resolves to everything without reading a policy', async () => {
    const access = await resolveAccess({ role: ROLES.ADMIN, roles: [ROLES.ADMIN] });
    assert.equal(access.isAdmin, true);
    assert.equal(access.source, 'admin');
    // Every check passes, including for permissions no policy grants anyone.
    assert.equal(accessAllows(access, 'stock-in:delete'), true);
    assert.equal(accessAllowsReport(access, 'stock-reports.pl'), true);
  });

  await test('a single role resolves to its own policy', async () => {
    const access = await resolveAccess({ role: ROLES.ORDER_TAKER, roles: [ROLES.ORDER_TAKER] });
    assert.equal(access.source, 'role');
    assert.equal(accessAllows(access, 'orders:add'), true);
    assert.equal(accessAllows(access, 'visits:change'), true);
    // Warehouse belongs to nobody in the field.
    assert.equal(accessAllows(access, 'warehouse:view'), false);
  });

  await test('the `delete` action survives the round trip', async () => {
    // `delete` collides with `Map.prototype.delete` and with Mongoose's document `.delete()`.
    // If either leaked through, `grant.delete` would read as a function — truthy — and hand
    // every role the delete permission on every module they touch.
    const access = await resolveAccess({ role: ROLES.ORDER_TAKER, roles: [ROLES.ORDER_TAKER] });
    assert.equal(accessAllows(access, 'returns:delete'), true, 'a real delete grant was lost');
    assert.equal(
      accessAllows(access, 'orders:delete'),
      false,
      'delete resolved truthy where nothing granted it — the prototype leaked through',
    );
  });

  await test('an unseeded permission is denied, not defaulted', async () => {
    const access = await resolveAccess({ role: ROLES.WAREHOUSE_STAFF, roles: [ROLES.WAREHOUSE_STAFF] });
    // Cancelling a stock receipt was admin-only before the migration and is seeded to nobody.
    assert.equal(accessAllows(access, 'stock-in:change'), false);
    assert.equal(accessAllows(access, 'stock-in:add'), true);
  });

  await test('reports are a separate layer from module grants', async () => {
    const access = await resolveAccess({ role: ROLES.WAREHOUSE_STAFF, roles: [ROLES.WAREHOUSE_STAFF] });
    assert.equal(accessAllows(access, 'warehouse:view'), true);
    assert.equal(accessAllowsReport(access, 'warehouse-reports.stock'), true);
    // Holding the module says nothing about the company P&L.
    assert.equal(accessAllowsReport(access, 'stock-reports.pl'), false);
  });

  await test('a role with no policy at all resolves to nothing, not to everything', async () => {
    await AccessPolicyModel.deleteOne({ subjectType: 'role', subjectKey: ROLES.DELIVERY_MAN });
    invalidateAccessCache();

    const access = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: [ROLES.DELIVERY_MAN] });
    assert.equal(access.permissions.size, 0);
    assert.equal(accessAllows(access, 'collections:view'), false);

    await seedAccessPolicies({ force: true, backfillUsers: false });
  });

  // -------------------------------------------------------------------------
  // Multi-role
  // -------------------------------------------------------------------------

  const combo = [ROLES.DELIVERY_MAN, ROLES.WAREHOUSE_STAFF];

  await test('a role combination with no profile falls back to the PRIMARY role only', async () => {
    const access = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: combo });

    assert.equal(access.source, 'primary-role-fallback');
    assert.equal(accessAllows(access, 'collections:view'), true, 'lost the primary role');
    assert.equal(
      accessAllows(access, 'stock-in:add'),
      false,
      'the second role was unioned in — that is the auto-merge the requirement forbids',
    );
  });

  await test('the fallback never grants more than the primary role alone would', async () => {
    const alone = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: [ROLES.DELIVERY_MAN] });
    const combined = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: combo });

    for (const p of combined.permissions) {
      assert.ok(alone.permissions.has(p), `fallback granted "${p}" that the primary role lacks`);
    }
  });

  await test('a profile takes over for its exact combination', async () => {
    const created = await service.createProfile({ name: 'Rider + Warehouse', roles: combo });
    await service.savePolicy(
      'profile',
      created.id,
      { permissions: ['collections:view', 'stock-in:view'], reports: ['warehouse-reports.stock'] },
      undefined,
    );

    const access = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: combo });
    assert.equal(access.source, 'profile');
    assert.equal(accessAllows(access, 'collections:view'), true);
    assert.equal(accessAllows(access, 'stock-in:view'), true);
    // NOT unioned: the rider's other grants are gone unless the admin ticked them.
    assert.equal(accessAllows(access, 'collections:add'), false);
    assert.equal(accessAllowsReport(access, 'warehouse-reports.stock'), true);
  });

  await test('profile matching ignores the order roles were assigned in', async () => {
    const reversed = [ROLES.WAREHOUSE_STAFF, ROLES.DELIVERY_MAN];
    const access = await resolveAccess({ role: ROLES.WAREHOUSE_STAFF, roles: reversed });
    assert.equal(access.source, 'profile', 'the same set in another order missed its profile');
  });

  await test('a superset of a profile does not match it', async () => {
    const wider = [...combo, ROLES.ORDER_TAKER];
    const access = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: wider });
    assert.equal(access.source, 'primary-role-fallback');
  });

  await test('a deactivated profile stops applying', async () => {
    const profiles = await service.listProfiles();
    const p = profiles.find((x) => x.roleKey === buildRoleKey(combo))!;

    await service.setProfileActive(p.id, false);
    let access = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: combo });
    assert.equal(access.source, 'primary-role-fallback');

    await service.setProfileActive(p.id, true);
    access = await resolveAccess({ role: ROLES.DELIVERY_MAN, roles: combo });
    assert.equal(access.source, 'profile');
  });

  await test('two active profiles cannot cover the same combination', async () => {
    await rejectsWith(
      service.createProfile({ name: 'Duplicate', roles: [...combo].reverse() }),
      /already covers this combination/i,
    );
  });

  await test('a profile needs at least two distinct roles', async () => {
    await rejectsWith(
      service.createProfile({ name: 'Silly', roles: [ROLES.ORDER_TAKER, ROLES.ORDER_TAKER] }),
      /two or more roles/i,
    );
  });

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  await test('saving a policy takes effect on the very next resolve', async () => {
    let access = await resolveAccess({ role: ROLES.WAREHOUSE_STAFF, roles: [ROLES.WAREHOUSE_STAFF] });
    assert.equal(accessAllows(access, 'stock-in:change'), false);

    await service.savePolicy(
      'role',
      ROLES.WAREHOUSE_STAFF,
      { permissions: ['stock-in:view', 'stock-in:change'], reports: [] },
      undefined,
    );

    // No sleep, no cache warm-up: a save that needs a wait is a save an admin will not trust.
    access = await resolveAccess({ role: ROLES.WAREHOUSE_STAFF, roles: [ROLES.WAREHOUSE_STAFF] });
    assert.equal(accessAllows(access, 'stock-in:change'), true);
  });

  await test('saving is a full replacement — unticked boxes really are off', async () => {
    const access = await resolveAccess({ role: ROLES.WAREHOUSE_STAFF, roles: [ROLES.WAREHOUSE_STAFF] });
    assert.equal(accessAllows(access, 'warehouse:view'), false, 'a permission absent from the save survived');

    await seedAccessPolicies({ force: true, backfillUsers: false });
  });

  await test('the admin role cannot be edited', async () => {
    await rejectsWith(
      service.savePolicy('role', ROLES.ADMIN, { permissions: [], reports: [] }, undefined),
      /not editable/i,
    );
  });

  await test('an unknown permission or report is refused', async () => {
    await rejectsWith(
      service.savePolicy('role', ROLES.ORDER_TAKER, { permissions: ['orders:teleport'], reports: [] }, undefined),
      /unknown permissions/i,
    );
    await rejectsWith(
      service.savePolicy('role', ROLES.ORDER_TAKER, { permissions: [], reports: ['reports.invented'] }, undefined),
      /unknown reports/i,
    );
    await seedAccessPolicies({ force: true, backfillUsers: false });
  });

  await test('an action a module does not support is refused', async () => {
    await rejectsWith(
      service.savePolicy('role', ROLES.ORDER_TAKER, { permissions: ['dashboard:delete'], reports: [] }, undefined),
      /unknown permissions/i,
    );
  });

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  async function makeUser(role: string, suffix: string) {
    return UserModel.create({
      userID: `U-${suffix}`,
      username: `user-${suffix}`,
      phone: `0300000${suffix}`,
      password: 'x',
      role,
    });
  }

  await test('the pre-validate hook derives roles[] from role on create', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '001');
    assert.deepEqual(u.roles, [ROLES.ORDER_TAKER], 'roles was not derived from role');
  });

  await test('writing roles[] makes its first entry the primary', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '001b');
    u.roles = [ROLES.DELIVERY_MAN, ROLES.WAREHOUSE_STAFF];
    await u.save();
    assert.equal(u.role, ROLES.DELIVERY_MAN, 'role did not follow roles[0]');
  });

  await test('changing role alone is NOT reverted by the stale roles array', async () => {
    // The employee form writes `role` and never touches `roles`. A hook that always trusted
    // `roles[0]` would silently undo the change and show the admin the old value back.
    const u = await makeUser(ROLES.ORDER_TAKER, '001c');
    assert.deepEqual(u.roles, [ROLES.ORDER_TAKER]);

    u.role = ROLES.WAREHOUSE_STAFF;
    await u.save();

    assert.equal(u.role, ROLES.WAREHOUSE_STAFF, 'the primary role change was reverted');
    assert.deepEqual(u.roles, [ROLES.WAREHOUSE_STAFF], 'roles[] did not follow the new primary');
  });

  await test('changing role alone replaces the whole assignment, it does not merge', async () => {
    // Leaving the old roles behind would mean an admin who changed someone's role still left
    // them holding the old one's permissions, with nothing on screen saying so.
    const u = await makeUser(ROLES.ORDER_TAKER, '001d');
    u.roles = [ROLES.ORDER_TAKER, ROLES.WAREHOUSE_MANAGER];
    await u.save();

    u.role = ROLES.WAREHOUSE_STAFF;
    await u.save();

    assert.equal(u.role, ROLES.WAREHOUSE_STAFF);
    assert.deepEqual(u.roles, [ROLES.WAREHOUSE_STAFF], 'an old role survived the change');
  });

  await test('the employee form flow ends with the roles it asked for', async () => {
    // updateUser writes `role`, then setUserRoles writes the full array. The second call must
    // win, or multi-role assignment from the form would be impossible.
    const u = await makeUser(ROLES.ORDER_TAKER, '001e');

    u.role = ROLES.DELIVERY_MAN;
    await u.save();
    const after = await service.setUserRoles(String(u._id), [
      ROLES.DELIVERY_MAN,
      ROLES.WAREHOUSE_STAFF,
    ]);

    assert.deepEqual(after.roles, [ROLES.DELIVERY_MAN, ROLES.WAREHOUSE_STAFF]);
    assert.equal(after.role, ROLES.DELIVERY_MAN);
  });

  await test('the backfill fills roles[] on pre-migration documents', async () => {
    const u = await makeUser(ROLES.WAREHOUSE_STAFF, '002');
    // Simulate a document written before the field existed, bypassing the hook.
    await UserModel.collection.updateOne({ _id: u._id }, { $unset: { roles: '' } });

    const result = await seedAccessPolicies({ backfillUsers: true });
    assert.ok(result.usersBackfilled >= 1);

    const after = await UserModel.findById(u._id).lean();
    assert.deepEqual(after!.roles, [ROLES.WAREHOUSE_STAFF]);
  });

  await test('assigning roles reports whether a profile covers the combination', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '003');

    const uncovered = await service.setUserRoles(String(u._id), [ROLES.ORDER_TAKER, ROLES.WAREHOUSE_STAFF]);
    assert.equal(uncovered.needsProfile, true);
    assert.equal(uncovered.role, ROLES.ORDER_TAKER, 'the first entry must become primary');

    const covered = await service.setUserRoles(String(u._id), combo);
    assert.equal(covered.needsProfile, false);
  });

  await test('a user must keep at least one role', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '004');
    await rejectsWith(service.setUserRoles(String(u._id), []), /at least one role/i);
  });

  await test('uncovered combinations are reported to the admin', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '005');
    await service.setUserRoles(String(u._id), [ROLES.ORDER_TAKER, ROLES.WAREHOUSE_MANAGER]);

    const gaps = await service.findUncoveredCombinations();
    const key = buildRoleKey([ROLES.ORDER_TAKER, ROLES.WAREHOUSE_MANAGER]);
    const hit = gaps.find((g) => g.roleKey === key);
    assert.ok(hit, 'a live combination with no profile was not surfaced');
    assert.ok(hit!.userCount >= 1);
  });

  await test('a profile in use cannot be deleted out from under its users', async () => {
    const profiles = await service.listProfiles();
    const p = profiles.find((x) => x.roleKey === buildRoleKey(combo))!;
    assert.ok(p.userCount >= 1, 'the fixture user should be holding this combination');

    await rejectsWith(service.deleteProfile(p.id), /hold this exact role combination/i);
  });

  await test('deleting a profile also removes its policy', async () => {
    const u = await UserModel.findOne({ username: 'user-003' });
    await service.setUserRoles(String(u!._id), [ROLES.ORDER_TAKER]);

    const others = await UserModel.find({ roles: { $all: combo, $size: 2 } });
    for (const o of others) await service.setUserRoles(String(o._id), [o.role]);

    const profiles = await service.listProfiles();
    const p = profiles.find((x) => x.roleKey === buildRoleKey(combo))!;
    await service.deleteProfile(p.id);

    const orphan = await AccessPolicyModel.findOne({ subjectType: 'profile', subjectKey: p.id }).lean();
    assert.equal(orphan, null, 'the profile went but its policy stayed behind');
  });

  // -------------------------------------------------------------------------
  // Per-user overrides
  // -------------------------------------------------------------------------

  await test('with no override, a user resolves through their role', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '010');
    const detail = await service.getUserAccessDetail(String(u._id));

    assert.equal(detail.hasOverride, false);
    assert.equal(detail.source, 'role');
    assert.ok(detail.permissions.includes('orders:add'), "should report the role's real grants");
  });

  await test('an override wins over the role outright', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '011');

    await service.savePolicy(
      'user',
      String(u._id),
      { permissions: ['dashboard:view', 'warehouse:view'], reports: [] },
      undefined,
    );

    const access = await resolveAccess({
      userId: String(u._id),
      role: ROLES.ORDER_TAKER,
      roles: [ROLES.ORDER_TAKER],
    });

    assert.equal(access.source, 'user');
    assert.equal(accessAllows(access, 'warehouse:view'), true, 'the override grant is missing');
    assert.equal(
      accessAllows(access, 'orders:add'),
      false,
      'a role grant survived the override — the two were merged instead of replaced',
    );
  });

  await test('an override beats a profile too', async () => {
    const u = await makeUser(ROLES.DELIVERY_MAN, '012');
    await service.setUserRoles(String(u._id), combo);

    const created = await service.createProfile({ name: 'Combo For Override', roles: combo });
    await service.savePolicy(
      'profile',
      created.id,
      { permissions: ['collections:view'], reports: [] },
      undefined,
    );

    let access = await resolveAccess({ userId: String(u._id), role: ROLES.DELIVERY_MAN, roles: combo });
    assert.equal(access.source, 'profile');

    await service.savePolicy(
      'user',
      String(u._id),
      { permissions: ['dashboard:view'], reports: [] },
      undefined,
    );

    access = await resolveAccess({ userId: String(u._id), role: ROLES.DELIVERY_MAN, roles: combo });
    assert.equal(access.source, 'user');
    assert.equal(accessAllows(access, 'collections:view'), false, 'the profile still applied');
  });

  await test('clearing an override falls back to the role, it does not blank them', async () => {
    const u = await makeUser(ROLES.ORDER_TAKER, '013');
    await service.savePolicy('user', String(u._id), { permissions: ['dashboard:view'], reports: [] }, undefined);

    let access = await resolveAccess({ userId: String(u._id), role: ROLES.ORDER_TAKER, roles: [ROLES.ORDER_TAKER] });
    assert.equal(access.source, 'user');

    const { cleared } = await service.clearUserPolicy(String(u._id));
    assert.equal(cleared, true);

    access = await resolveAccess({ userId: String(u._id), role: ROLES.ORDER_TAKER, roles: [ROLES.ORDER_TAKER] });
    assert.equal(access.source, 'role');
    assert.equal(accessAllows(access, 'orders:add'), true, 'the role did not come back');
  });

  await test('an EMPTY override is not the same as no override', async () => {
    // Saving a blank grid is a legitimate way to strip someone. If it fell through to the role
    // instead, an admin could not take access away, only add it.
    const u = await makeUser(ROLES.ORDER_TAKER, '014');
    await service.savePolicy('user', String(u._id), { permissions: [], reports: [] }, undefined);

    const access = await resolveAccess({ userId: String(u._id), role: ROLES.ORDER_TAKER, roles: [ROLES.ORDER_TAKER] });
    assert.equal(access.source, 'user');
    assert.equal(access.permissions.size, 0);
    assert.equal(accessAllows(access, 'orders:add'), false);
  });

  await test('an override cannot be put on an admin', async () => {
    const u = await makeUser(ROLES.ADMIN, '015');
    await rejectsWith(
      service.savePolicy('user', String(u._id), { permissions: ['dashboard:view'], reports: [] }, undefined),
      /always have full access/i,
    );
  });

  await test('the detail payload opens the editor on current reality', async () => {
    const u = await makeUser(ROLES.WAREHOUSE_STAFF, '016');
    const detail = await service.getUserAccessDetail(String(u._id));

    // Not a blank grid: an admin adjusting one person starts from what that person has today.
    assert.ok(detail.permissions.length > 10, "came back empty instead of the role's set");
    assert.ok(detail.reports.length > 0);
    assert.equal(detail.user.role, ROLES.WAREHOUSE_STAFF);
  });

  await test('overridden users are listed for the employee-list badge', async () => {
    const ids = await service.listOverriddenUserIds();
    const u = await UserModel.findOne({ username: 'user-011' }).select('_id').lean();
    assert.ok(ids.includes(String(u!._id)), 'a user with an override was not listed');
  });

  await test('an unknown user is a 404, not a silent empty policy', async () => {
    const ghost = new Types.ObjectId();
    await rejectsWith(service.getUserAccessDetail(String(ghost)), /not found/i);
    await rejectsWith(
      service.savePolicy('user', String(ghost), { permissions: [], reports: [] }, undefined),
      /not found/i,
    );
  });

  // -------------------------------------------------------------------------
  // The client payload
  // -------------------------------------------------------------------------

  await test('admin is described to the client as the full catalogue, not an empty set', async () => {
    const described = await describeAccessForClient({ role: ROLES.ADMIN, roles: [ROLES.ADMIN] });
    assert.equal(described.isAdmin, true);
    assert.ok(described.permissions.length > 100, 'admin came back with an empty permission list');
    assert.ok(described.reports.length >= 48);
  });

  await test('a field role is described with only what it holds', async () => {
    const described = await describeAccessForClient({
      role: ROLES.ORDER_TAKER,
      roles: [ROLES.ORDER_TAKER],
    });
    assert.equal(described.isAdmin, false);
    assert.ok(described.permissions.includes('orders:add'));
    assert.ok(!described.permissions.includes('warehouse:view'));
    assert.equal(described.source, 'role');
  });

  await test('an unauthenticated caller resolves to nothing', async () => {
    const access = await resolveAccess(undefined);
    assert.equal(access.isAdmin, false);
    assert.equal(access.permissions.size, 0);
    assert.equal(access.source, 'none');

    const empty = await resolveAccess({ roles: [] });
    assert.equal(empty.permissions.size, 0);
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
