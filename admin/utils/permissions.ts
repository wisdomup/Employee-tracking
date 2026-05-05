export type Role = 'admin' | 'order_taker' | 'employee' | 'warehouse_manager' | 'delivery_man';

/**
 * Permissions granted to the order_taker role.
 * Admins implicitly have all permissions.
 * All other employee roles have no permissions (Coming Soon).
 */
const ORDER_TAKER_PERMISSIONS = new Set([
  'dealers:view',
  'dealers:create',
  'catalogs:view',
  'products:view',
  'activity-logs:view',
  'routes:view',
  'tasks:view',
  'tasks:update-status',
  'orders:view',
  'orders:create',
  'orders:edit-pending',
  'approvals:view',
  'approvals:create',
  'approvals:edit-non-approved',
  'approvals:delete-non-approved',
  'attendance:view',
  'attendance:create',
  'visits:view',
  'visits:update-status',
  'returns:view',
  'returns:create',
  'returns:edit-pending',
  'returns:delete-pending',
]);

/**
 * Check whether the given role has permission to perform an action.
 * Usage: can(user?.role, 'orders:create')
 */
const TASKS_FIELD_ROLES: Role[] = ['employee', 'warehouse_manager', 'delivery_man'];

export function can(role: Role | string | undefined, permission: string): boolean {
  if (role === 'admin') return true;
  if (role === 'order_taker') return ORDER_TAKER_PERMISSIONS.has(permission);
  if (
    role &&
    TASKS_FIELD_ROLES.includes(role as Role) &&
    (permission === 'tasks:view' || permission === 'tasks:update-status')
  ) {
    return true;
  }
  return false;
}

/** Roles that belong to field/office staff (not admin). */
export const EMPLOYEE_ROLES: Role[] = [
  'order_taker',
  'employee',
  'warehouse_manager',
  'delivery_man',
];

/** All roles that can access the app (used in ProtectedRoute). */
export const ALL_ROLES: Role[] = ['admin', ...EMPLOYEE_ROLES];
