import { Types } from 'mongoose';
import { AccessPolicyModel, IModuleGrant } from '../../models/access-policy.model';
import { PermissionProfileModel, buildRoleKey } from '../../models/permission-profile.model';
import { UserModel } from '../../models/user.model';
import { ROLES } from '../../constants/global';
import {
  ALL_ACTIONS,
  Action,
  MODULES,
  REPORTS,
  isValidPermission,
  isValidReport,
} from '../../constants/permissions';
import { invalidateAccessCache, resolveAccess } from '../../services/access-control.service';
import { badRequest, notFound } from '../../utils/app-error';

/**
 * Read and write the permission matrix. Everything here is admin-only at the route.
 *
 * Every mutation ends with `invalidateAccessCache()`. Forgetting that would leave the
 * resolver serving the previous grants for up to the cache TTL — the admin would save, test,
 * see no change, and save again.
 */

// ---------------------------------------------------------------------------
// Catalogue — what the admin screen renders
// ---------------------------------------------------------------------------

export function getCatalogue() {
  return {
    actions: ALL_ACTIONS,
    modules: MODULES.map((m) => ({
      id: m.id,
      label: m.label,
      group: m.group,
      actions: m.actions,
      ...(m.changeMeans ? { changeMeans: m.changeMeans } : {}),
    })),
    reports: REPORTS.map((r) => ({
      id: r.id,
      label: r.label,
      surface: r.surface,
      path: r.path,
    })),
    /**
     * Admin is not in this list on purpose: it has no policy and no editable matrix. The UI
     * shows it as a fixed row so nobody goes looking for the missing tab.
     */
    editableRoles: Object.values(ROLES).filter((r) => r !== ROLES.ADMIN),
  };
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

function grantsToObject(grants: unknown): Record<string, IModuleGrant> {
  if (!grants) return {};
  if (grants instanceof Map) return Object.fromEntries(grants);
  return grants as Record<string, IModuleGrant>;
}

export async function getPolicy(subjectType: 'role' | 'profile' | 'user', subjectKey: string) {
  const policy = await AccessPolicyModel.findOne({ subjectType, subjectKey }).lean().exec();

  // An unconfigured subject is a legitimate state, not an error — a brand-new profile has no
  // policy until it is first saved. Return the empty shape so the editor can render a blank
  // grid instead of a 404 the admin has to interpret.
  return {
    subjectType,
    subjectKey,
    grants: grantsToObject(policy?.grants),
    reports: policy?.reports ?? [],
    isSystem: policy?.isSystem ?? false,
    updatedAt: policy?.updatedAt ?? null,
  };
}

export interface SavePolicyInput {
  /** Flat `module:action` keys that should be ON. Anything absent is turned off. */
  permissions: string[];
  /** Report ids that should be ticked. Anything absent is unticked. */
  reports: string[];
}

export async function savePolicy(
  subjectType: 'role' | 'profile' | 'user',
  subjectKey: string,
  input: SavePolicyInput,
  actorId?: string,
) {
  const badPermissions = input.permissions.filter((k) => !isValidPermission(k));
  if (badPermissions.length > 0) {
    throw badRequest(`Unknown permissions: ${badPermissions.join(', ')}`);
  }

  const badReports = input.reports.filter((r) => !isValidReport(r));
  if (badReports.length > 0) {
    throw badRequest(`Unknown reports: ${badReports.join(', ')}`);
  }

  if (subjectType === 'role') {
    if (subjectKey === ROLES.ADMIN) {
      throw badRequest(
        'The admin role is not editable. It resolves to full access before any policy is read, ' +
          'which is what stops the matrix from being able to lock you out of the matrix.',
      );
    }
    if (!Object.values(ROLES).includes(subjectKey as never)) {
      throw badRequest(`Unknown role "${subjectKey}"`);
    }
  } else if (subjectType === 'profile') {
    const profile = await PermissionProfileModel.findById(subjectKey).lean().exec();
    if (!profile) throw notFound('Permission profile not found');
  } else {
    const target = await UserModel.findOne({ _id: subjectKey, isTrashed: { $ne: true } })
      .select('_id role roles')
      .lean()
      .exec();
    if (!target) throw notFound('User not found');

    // An override on an admin would be dead configuration: the resolver returns full access
    // before it ever reads a policy. Refusing is clearer than saving something inert.
    const held = target.roles?.length ? target.roles : [target.role];
    if (held.includes(ROLES.ADMIN)) {
      throw badRequest(
        'Admin accounts always have full access and cannot be given a per-user permission set. ' +
          'Change their role first if you need to limit them.',
      );
    }
  }

  const grants = new Map<string, IModuleGrant>();
  for (const key of input.permissions) {
    const [moduleId, action] = key.split(':') as [string, Action];
    const existing = grants.get(moduleId) ?? {};
    existing[action] = true;
    grants.set(moduleId, existing);
  }

  const saved = await AccessPolicyModel.findOneAndUpdate(
    { subjectType, subjectKey },
    {
      $set: {
        grants,
        reports: input.reports,
        ...(actorId ? { updatedBy: new Types.ObjectId(actorId) } : {}),
      },
      $setOnInsert: { subjectType, subjectKey, isSystem: false },
    },
    { new: true, upsert: true },
  ).exec();

  invalidateAccessCache();
  return getPolicy(subjectType, String(saved.subjectKey));
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function listProfiles() {
  const profiles = await PermissionProfileModel.find({}).sort({ name: 1 }).lean().exec();

  // How many people actually hold each combination. An admin deciding whether a profile is
  // still needed should not have to go and count users by hand.
  const counts = await UserModel.aggregate<{ _id: string[]; count: number }>([
    { $match: { isTrashed: { $ne: true } } },
    { $group: { _id: '$roles', count: { $sum: 1 } } },
  ]).exec();

  const byRoleKey = new Map<string, number>();
  for (const row of counts) {
    if (!Array.isArray(row._id) || row._id.length < 2) continue;
    const key = buildRoleKey(row._id);
    byRoleKey.set(key, (byRoleKey.get(key) ?? 0) + row.count);
  }

  return profiles.map((p) => ({
    id: String(p._id),
    name: p.name,
    description: p.description ?? '',
    roles: p.roles,
    roleKey: p.roleKey,
    isActive: p.isActive,
    userCount: byRoleKey.get(p.roleKey) ?? 0,
  }));
}

export interface CreateProfileInput {
  name: string;
  description?: string;
  roles: string[];
}

export async function createProfile(input: CreateProfileInput, actorId?: string) {
  const unique = [...new Set(input.roles)];

  if (unique.length < 2) {
    throw badRequest(
      'A profile covers a combination of two or more roles. For a single role, edit that ' +
        "role's own matrix instead.",
    );
  }

  const unknown = unique.filter((r) => !Object.values(ROLES).includes(r as never));
  if (unknown.length > 0) throw badRequest(`Unknown roles: ${unknown.join(', ')}`);

  if (unique.includes(ROLES.ADMIN)) {
    throw badRequest('Admin already has full access; combining it with another role has no meaning.');
  }

  const roleKey = buildRoleKey(unique);
  const clash = await PermissionProfileModel.findOne({ roleKey, isActive: true }).lean().exec();
  if (clash) {
    throw badRequest(
      `"${clash.name}" already covers this combination. Edit it rather than creating a second ` +
        'profile for the same roles — two would resolve unpredictably.',
    );
  }

  const created = await PermissionProfileModel.create({
    name: input.name,
    description: input.description,
    roles: unique,
    roleKey,
    isActive: true,
    ...(actorId ? { createdBy: new Types.ObjectId(actorId) } : {}),
  });

  invalidateAccessCache();
  return { id: String(created._id), roleKey: created.roleKey, roles: created.roles };
}

export async function setProfileActive(profileId: string, isActive: boolean) {
  const profile = await PermissionProfileModel.findById(profileId).exec();
  if (!profile) throw notFound('Permission profile not found');

  profile.isActive = isActive;
  await profile.save();

  invalidateAccessCache();
  return { id: String(profile._id), isActive: profile.isActive };
}

export async function deleteProfile(profileId: string) {
  const profile = await PermissionProfileModel.findById(profileId).lean().exec();
  if (!profile) throw notFound('Permission profile not found');

  const holders = await UserModel.countDocuments({
    roles: { $all: profile.roles, $size: profile.roles.length },
    isTrashed: { $ne: true },
  }).exec();

  if (holders > 0) {
    throw badRequest(
      `${holders} user(s) hold this exact role combination. Deleting the profile would drop ` +
        'them back to their primary role only. Reassign them first, or deactivate the profile.',
    );
  }

  await PermissionProfileModel.deleteOne({ _id: profileId }).exec();
  await AccessPolicyModel.deleteOne({ subjectType: 'profile', subjectKey: profileId }).exec();

  invalidateAccessCache();
  return { deleted: true };
}

/**
 * Combinations that users actually hold but no profile covers.
 *
 * Surfaced as a warning list on the admin screen, because the resolver's fallback for these
 * is the primary role alone — the users are working, but with less than the admin probably
 * intended. Silence here would make that gap invisible until someone complained.
 */
export async function findUncoveredCombinations() {
  const rows = await UserModel.aggregate<{ _id: string[]; count: number }>([
    { $match: { isTrashed: { $ne: true }, isActive: true } },
    { $group: { _id: '$roles', count: { $sum: 1 } } },
  ]).exec();

  const active = await PermissionProfileModel.find({ isActive: true })
    .select('roleKey')
    .lean()
    .exec();
  const covered = new Set(active.map((p) => p.roleKey));

  return rows
    .filter((r) => Array.isArray(r._id) && r._id.length >= 2)
    .map((r) => ({ roles: r._id, roleKey: buildRoleKey(r._id), userCount: r.count }))
    .filter((r) => !covered.has(r.roleKey));
}

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

export async function setUserRoles(userId: string, roles: string[]) {
  const unique = [...new Set(roles)];
  if (unique.length === 0) throw badRequest('A user must have at least one role');

  const unknown = unique.filter((r) => !Object.values(ROLES).includes(r as never));
  if (unknown.length > 0) throw badRequest(`Unknown roles: ${unknown.join(', ')}`);

  const user = await UserModel.findById(userId).exec();
  if (!user) throw notFound('User not found');

  // The pre-validate hook keeps `role` pointing at roles[0]; setting both here would let the
  // two drift if the hook ever changed.
  user.roles = unique;
  await user.save();

  const uncovered =
    unique.length >= 2
      ? !(await PermissionProfileModel.exists({ roleKey: buildRoleKey(unique), isActive: true }))
      : false;

  return {
    userId: String(user._id),
    role: user.role,
    roles: user.roles,
    /** The caller shows a warning when true — see `findUncoveredCombinations`. */
    needsProfile: uncovered,
  };
}

// ---------------------------------------------------------------------------
// Per-user overrides
// ---------------------------------------------------------------------------

/**
 * Everything the editor needs to open on one person: who they are, what they can do right now,
 * and whether that answer comes from their roles or from an override already set on them.
 *
 * The `permissions` and `reports` here are the CURRENT EFFECTIVE set, resolved the same way a
 * real request resolves. That is what makes the screen usable: an admin editing one person
 * starts from what that person actually has today and adjusts, rather than from a blank grid
 * and a memory test. Nothing is saved until they press save, so this is a starting point, not
 * an automatic grant.
 */
export async function getUserAccessDetail(userId: string) {
  const user = await UserModel.findOne({ _id: userId, isTrashed: { $ne: true } })
    .select('_id username fullName userID role roles isActive')
    .lean()
    .exec();

  if (!user) throw notFound('User not found');

  const override = await AccessPolicyModel.findOne({
    subjectType: 'user',
    subjectKey: String(user._id),
  })
    .lean()
    .exec();

  const resolved = await resolveAccess({
    userId: String(user._id),
    role: user.role,
    roles: user.roles,
  });

  const roles = user.roles?.length ? user.roles : [user.role];

  // Only meaningful when they hold several roles; the UI uses it to explain a fallback.
  const profile =
    roles.length >= 2
      ? await PermissionProfileModel.findOne({ roleKey: buildRoleKey(roles), isActive: true })
          .select('name')
          .lean()
          .exec()
      : null;

  return {
    user: {
      id: String(user._id),
      username: user.username,
      fullName: user.fullName ?? '',
      userID: user.userID ?? '',
      role: user.role,
      roles,
      isActive: user.isActive,
    },
    /** True when a per-user policy exists — the roles are no longer deciding anything. */
    hasOverride: Boolean(override),
    overrideUpdatedAt: override?.updatedAt ?? null,
    /** Which policy answered: `user`, `role`, `profile`, `primary-role-fallback` or `none`. */
    source: resolved.source,
    /** The profile covering their combination, when there is one. */
    profileName: profile?.name ?? null,
    permissions: [...resolved.permissions],
    reports: [...resolved.reports],
  };
}

/**
 * Remove a person's override so their roles decide again.
 *
 * Deleting the document rather than blanking it is deliberate: an empty policy and no policy
 * mean opposite things to the resolver — the first grants nothing, the second falls through to
 * the role. Saving an empty grid is a legitimate way to strip someone's access, so "revert to
 * role" has to be a separate action.
 */
export async function clearUserPolicy(userId: string) {
  const user = await UserModel.findOne({ _id: userId }).select('_id').lean().exec();
  if (!user) throw notFound('User not found');

  const result = await AccessPolicyModel.deleteOne({
    subjectType: 'user',
    subjectKey: String(user._id),
  }).exec();

  invalidateAccessCache();
  return { cleared: result.deletedCount > 0 };
}

/** Ids of every user carrying an override, so the employee list can badge them. */
export async function listOverriddenUserIds(): Promise<string[]> {
  const rows = await AccessPolicyModel.find({ subjectType: 'user' })
    .select('subjectKey')
    .lean()
    .exec();
  return rows.map((r) => r.subjectKey);
}
