import { Types } from 'mongoose';
import { UserModel } from '../../models/user.model';
import { ROLES } from '../../constants/global';
import { forbidden } from '../../utils/app-error';

/**
 * Row-level scoping for the warehouse module.
 *
 * `requireRoles` only answers "is this role allowed on this route". It cannot answer "is this
 * staff member allowed to touch THAT warehouse", which is the question that matters once stock
 * is per-warehouse — so every list, detail and mutating endpoint pairs the role gate with one of
 * these helpers.
 *
 * Note the deliberate polarity flip against `resolveCityScope` in `users.service.ts`: that one
 * fails OPEN (no city ⇒ see everything) because it governs a read-only client list. This one
 * fails CLOSED for `warehouse_staff`, because it governs stock writes — an unconfigured staff
 * account must be locked out, not handed every warehouse.
 */

/** `null` means unrestricted. A returned id means "only this warehouse". */
export async function resolveWarehouseScope(
  userId: string,
  role: string,
): Promise<Types.ObjectId | null> {
  if (role === ROLES.ADMIN) return null;

  if (role !== ROLES.WAREHOUSE_MANAGER && role !== ROLES.WAREHOUSE_STAFF) {
    // Any other role reaching a warehouse route is read-only and unrestricted by design
    // (e.g. a sales manager looking up availability). Route gates decide who gets that far.
    return null;
  }

  const user = await UserModel.findById(userId).select('warehouseId').lean();
  const warehouseId = user?.warehouseId ? new Types.ObjectId(String(user.warehouseId)) : null;

  if (role === ROLES.WAREHOUSE_STAFF && !warehouseId) {
    throw forbidden(
      'Your account is not assigned to a warehouse. Ask an admin to set your warehouse before using this module.',
    );
  }

  // A manager with no warehouse set is a company-wide operations role.
  return warehouseId;
}

/** Throw unless the caller may act on `warehouseId`. */
export async function assertWarehouseAccess(
  userId: string,
  role: string,
  warehouseId: string,
): Promise<void> {
  const scope = await resolveWarehouseScope(userId, role);
  if (scope === null) return;
  if (String(scope) !== String(warehouseId)) {
    throw forbidden('You do not have access to this warehouse');
  }
}

/**
 * Allow access when the caller's warehouse is EITHER end of a transfer — a receiving storekeeper
 * legitimately needs to see an inbound transfer they did not create.
 */
export async function assertWarehouseAccessEither(
  userId: string,
  role: string,
  warehouseIds: (string | Types.ObjectId | undefined | null)[],
): Promise<void> {
  const scope = await resolveWarehouseScope(userId, role);
  if (scope === null) return;
  const allowed = warehouseIds.filter(Boolean).map((id) => String(id));
  if (!allowed.includes(String(scope))) {
    throw forbidden('You do not have access to this transfer');
  }
}

/**
 * Merge a caller's scope into a Mongo query. Pass the field name because the transfer collection
 * has two warehouse fields and needs `$or` instead (see `assertWarehouseAccessEither`).
 */
export async function applyWarehouseScope(
  query: Record<string, unknown>,
  userId: string,
  role: string,
  field = 'warehouseId',
): Promise<Record<string, unknown>> {
  const scope = await resolveWarehouseScope(userId, role);
  if (scope !== null) query[field] = scope;
  return query;
}
