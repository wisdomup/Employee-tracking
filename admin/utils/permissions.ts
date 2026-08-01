export type Role =
  | 'admin'
  | 'sales_manager'
  | 'order_taker'
  | 'employee'
  | 'warehouse_manager'
  | 'delivery_man';

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
  // Riders may see their own performance against their monthly target.
  'analytics:view-own',
]);

/**
 * A sales manager supervises field staff. They get read access to the operational
 * data of their team plus analytics and target setting for their own reports —
 * but no product/catalog administration.
 */
const SALES_MANAGER_PERMISSIONS = new Set([
  'dealers:view',
  'products:view',
  'catalogs:view',
  'routes:view',
  'orders:view',
  'returns:view',
  'tasks:view',
  'visits:view',
  'attendance:view',
  'approvals:view',
  'activity-logs:view',
  'employees:view',
  'analytics:view-own',
  'analytics:view-team',
  'targets:view',
  'targets:manage',
  'region-sales:view',
]);

/**
 * Check whether the given role has permission to perform an action.
 * Usage: can(user?.role, 'orders:create')
 */
const TASKS_FIELD_ROLES: Role[] = ['employee', 'warehouse_manager', 'delivery_man'];

export function can(role: Role | string | undefined, permission: string): boolean {
  if (role === 'admin') return true;
  if (role === 'sales_manager') return SALES_MANAGER_PERMISSIONS.has(permission);
  if (role === 'order_taker') return ORDER_TAKER_PERMISSIONS.has(permission);
  if (
    role &&
    TASKS_FIELD_ROLES.includes(role as Role) &&
    (permission === 'tasks:view' ||
      permission === 'tasks:update-status' ||
      permission === 'visits:view' ||
      permission === 'analytics:view-own')
  ) {
    return true;
  }
  return false;
}

/** Roles that belong to field/office staff (not admin). */
export const EMPLOYEE_ROLES: Role[] = [
  'sales_manager',
  'order_taker',
  'employee',
  'warehouse_manager',
  'delivery_man',
];

/** Field roles that carry sales targets and can be assigned to a sales manager. */
export const FIELD_STAFF_ROLES: Role[] = ['order_taker', 'delivery_man', 'employee'];

/** All roles that can access the app (used in ProtectedRoute). */
export const ALL_ROLES: Role[] = ['admin', ...EMPLOYEE_ROLES];
