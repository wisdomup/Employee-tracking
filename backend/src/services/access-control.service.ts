import { AccessPolicyModel, IAccessPolicy, IModuleGrant } from '../models/access-policy.model';
import { PermissionProfileModel, buildRoleKey } from '../models/permission-profile.model';
import { ROLES } from '../constants/global';
import {
  Action,
  PermissionKey,
  allPermissionKeys,
  allReportIds,
  parsePermissionKey,
} from '../constants/permissions';

/**
 * Resolves what a user may do, from the admin-editable matrix.
 *
 * ## Resolution order
 *
 * 1. `admin` gets everything, without touching the database. The super-admin is deliberately
 *    not editable — a matrix that can revoke access to the matrix editor is a lockout waiting
 *    to happen.
 * 2. A per-user override, if one exists. Set by hand for one person; wins outright over their
 *    roles rather than being merged with them, so what the screen shows is what they get.
 * 3. One role: that role's policy.
 * 4. Two or more roles: the active `PermissionProfile` whose combination matches exactly.
 * 5. Two or more roles with no matching profile: **the primary role's policy only.**
 *
 * Step 5 is the interesting one. The obvious fallbacks are both wrong: unioning the roles is
 * the auto-merge the requirement forbids, and denying everything locks out a real person
 * because an admin has not finished a configuration screen. Falling back to the primary role
 * grants strictly no more than a single-role user would get, which is safe, deterministic,
 * and leaves the user able to work while the profile is created. It warns loudly so the gap
 * is visible rather than silent.
 */

export interface ResolvedAccess {
  isAdmin: boolean;
  /** Flat `module:action` keys. Empty for a user whose roles resolve to nothing. */
  permissions: Set<PermissionKey>;
  /** Report ids this user may view. */
  reports: Set<string>;
  /** Which policy answered — surfaced in the admin UI and in the audit log. */
  source: 'admin' | 'user' | 'role' | 'profile' | 'primary-role-fallback' | 'none';
}

const ADMIN_ACCESS: ResolvedAccess = Object.freeze({
  isAdmin: true,
  permissions: new Set<PermissionKey>(),
  reports: new Set<string>(),
  source: 'admin' as const,
});

const EMPTY_ACCESS: ResolvedAccess = Object.freeze({
  isAdmin: false,
  permissions: new Set<PermissionKey>(),
  reports: new Set<string>(),
  source: 'none' as const,
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Policies change when an admin saves the matrix — a handful of times a month — while they
 * are read on literally every authenticated request. So the whole set is held in memory and
 * dropped on write, rather than queried per request.
 *
 * The TTL is a backstop, not the mechanism: in a multi-process deployment (PM2 runs several
 * workers) a save invalidates only the worker that handled it, and the others would otherwise
 * serve stale grants until restart. Sixty seconds bounds that window. If this ever moves
 * behind more than a couple of workers, replace the TTL with a pub/sub invalidation rather
 * than shortening it — a shorter TTL just moves cost onto every request.
 */
const CACHE_TTL_MS = 60_000;

interface PolicyCache {
  /** `${subjectType}:${subjectKey}` to the policy. */
  bySubject: Map<string, IAccessPolicy>;
  /** Sorted-role-key to the active profile's `_id` string. */
  profileByRoleKey: Map<string, string>;
  loadedAt: number;
}

let cache: PolicyCache | null = null;
let loading: Promise<PolicyCache> | null = null;

export function invalidateAccessCache(): void {
  cache = null;
  loading = null;
}

async function loadCache(): Promise<PolicyCache> {
  const [policies, profiles] = await Promise.all([
    AccessPolicyModel.find({}).lean<IAccessPolicy[]>().exec(),
    PermissionProfileModel.find({ isActive: true }).select('_id roleKey').lean().exec(),
  ]);

  const bySubject = new Map<string, IAccessPolicy>();
  for (const p of policies) {
    bySubject.set(`${p.subjectType}:${p.subjectKey}`, p);
  }

  const profileByRoleKey = new Map<string, string>();
  for (const prof of profiles) {
    profileByRoleKey.set(prof.roleKey, String(prof._id));
  }

  return { bySubject, profileByRoleKey, loadedAt: Date.now() };
}

async function getCache(): Promise<PolicyCache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;

  // Collapse a thundering herd on cold start: concurrent requests share one query rather
  // than each firing their own.
  if (!loading) {
    loading = loadCache()
      .then((loaded) => {
        cache = loaded;
        loading = null;
        return loaded;
      })
      .catch((err) => {
        loading = null;
        throw err;
      });
  }

  return loading;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * `grants` comes back from `.lean()` as a plain object, but as a real `Map` from a hydrated
 * document. Both shapes reach here depending on the call path, so normalise rather than
 * assume — the bug this prevents is a silent "no permissions" for every user.
 */
function readGrant(
  grants: IAccessPolicy['grants'] | Record<string, IModuleGrant> | undefined,
  moduleId: string,
): IModuleGrant | undefined {
  if (!grants) return undefined;
  if (grants instanceof Map) return grants.get(moduleId);
  return (grants as Record<string, IModuleGrant>)[moduleId];
}

function policyToAccess(
  policy: IAccessPolicy | undefined,
  source: ResolvedAccess['source'],
): ResolvedAccess {
  if (!policy) return EMPTY_ACCESS;

  const permissions = new Set<PermissionKey>();
  const grants = policy.grants;

  const moduleIds =
    grants instanceof Map ? [...grants.keys()] : Object.keys((grants ?? {}) as object);

  for (const moduleId of moduleIds) {
    const grant = readGrant(grants, moduleId);
    if (!grant) continue;
    for (const action of ['view', 'add', 'edit', 'delete', 'change'] as Action[]) {
      if (grant[action]) permissions.add(`${moduleId}:${action}`);
    }
  }

  return {
    isAdmin: false,
    permissions,
    reports: new Set(policy.reports ?? []),
    source,
  };
}

export interface AccessSubject {
  /** Needed to find a per-user override. `req.user` already carries it. */
  userId?: string;
  role?: string;
  roles?: string[];
}

export async function resolveAccess(user: AccessSubject | undefined): Promise<ResolvedAccess> {
  if (!user) return EMPTY_ACCESS;

  const roles = user.roles?.length ? user.roles : user.role ? [user.role] : [];
  if (roles.length === 0) return EMPTY_ACCESS;

  if (roles.includes(ROLES.ADMIN)) return ADMIN_ACCESS;

  const { bySubject, profileByRoleKey } = await getCache();

  // A per-user override replaces the role logic entirely — see the note on the model. Checked
  // before roles so that what an admin set on this one person is what actually applies.
  if (user.userId) {
    const override = bySubject.get(`user:${user.userId}`);
    if (override) return policyToAccess(override, 'user');
  }

  if (roles.length === 1) {
    return policyToAccess(bySubject.get(`role:${roles[0]}`), 'role');
  }

  const profileId = profileByRoleKey.get(buildRoleKey(roles));
  if (profileId) {
    return policyToAccess(bySubject.get(`profile:${profileId}`), 'profile');
  }

  // No profile covers this combination. Fall back to the primary role — see the header note.
  // eslint-disable-next-line no-console -- operational warning; the admin needs to see this
  console.warn(
    `[access] No permission profile for role combination "${buildRoleKey(roles)}". ` +
      `Falling back to primary role "${roles[0]}". Create a profile to grant the combined set.`,
  );
  return policyToAccess(bySubject.get(`role:${roles[0]}`), 'primary-role-fallback');
}

export function accessAllows(access: ResolvedAccess, permission: PermissionKey): boolean {
  if (access.isAdmin) return true;
  return access.permissions.has(permission);
}

export function accessAllowsReport(access: ResolvedAccess, reportId: string): boolean {
  if (access.isAdmin) return true;
  return access.reports.has(reportId);
}

/**
 * The shape the admin panel consumes. Admin resolves to the full catalogue rather than the
 * empty set it carries internally, so the frontend `can()` needs no special case of its own.
 */
export async function describeAccessForClient(user: AccessSubject | undefined): Promise<{
  isAdmin: boolean;
  permissions: PermissionKey[];
  reports: string[];
  source: ResolvedAccess['source'];
}> {
  const access = await resolveAccess(user);

  if (access.isAdmin) {
    return {
      isAdmin: true,
      permissions: allPermissionKeys(),
      reports: allReportIds(),
      source: 'admin',
    };
  }

  return {
    isAdmin: false,
    permissions: [...access.permissions],
    reports: [...access.reports],
    source: access.source,
  };
}

/** Guard used by the route middleware; keeps the parse-and-check in one place. */
export function assertKnownPermission(permission: PermissionKey): void {
  if (!parsePermissionKey(permission)) {
    throw new Error(`Unknown permission key: "${permission}"`);
  }
}
