export type Role =
  | 'admin'
  | 'sales_manager'
  | 'order_taker'
  | 'employee'
  | 'warehouse_manager'
  | 'warehouse_staff'
  | 'delivery_man';

/**
 * Permissions granted to the order_taker role.
 * Admins implicitly have all permissions.
 * All other employee roles have no permissions (Coming Soon).
 */
const ORDER_TAKER_PERMISSIONS = new Set([
  'dealers:view',
  'dealers:create',
  // The pin and the postal address only — the rider is the one standing outside the shop.
  // Phone, category, route and status stay on the admin edit form.
  'dealers:fix-location',
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
 * Warehouse staff: day-to-day stock work at their own warehouse. They may raise transfers, damage
 * entries and counts, but never approve them — approval is the only control on write-offs.
 *
 * Note which keys are deliberately ABSENT: `transfers:approve`, `damage:approve`,
 * `stock-count:approve`, `warehouses:manage`, `opening-stock:manage`, `stock:set-low-level`,
 * `stock:adjust`, `orders:set-source-warehouse`, `stock-in:edit` and `stock-in:delete` appear in no
 * Set at all. `can()` returns true for 'admin' before consulting any Set, so
 * `can(role, 'transfers:approve')` is an exact admin test — which lets pages express
 * "admin only" through `can()` instead of hardcoding a role comparison.
 *
 * `stock-in:edit`/`stock-in:delete` are admin-only while `stock-in:cancel` is not, on purpose: a
 * cancel leaves the wrong figures visible in the record, whereas an edit rewrites them and a
 * delete hides the document. Those two rewrite history and stay with the admin.
 */
const WAREHOUSE_STAFF_PERMISSIONS = new Set([
  'products:view',
  'warehouse:view',
  'warehouses:view',
  'stock-in:view',
  'stock-in:create',
  'transfers:view',
  'transfers:create',
  'transfers:receive',
  'damage:view',
  'damage:create',
  'stock-count:view',
  'stock-count:create',
  'warehouse-reports:view',
  'tasks:view',
  'tasks:update-status',
  'attendance:view',
  'attendance:create',
]);

/**
 * Warehouse manager: everything staff can do, plus cancelling documents and a wider read view.
 * Scoped to one warehouse when `User.warehouseId` is set, company-wide when it is not.
 */
const WAREHOUSE_MANAGER_PERMISSIONS = new Set([
  ...WAREHOUSE_STAFF_PERMISSIONS,
  'stock-in:cancel',
  'transfers:cancel',
  'damage:cancel',
  'employees:view',
  'visits:view',
  'analytics:view-own',
  'orders:view',
  'catalogs:view',
]);

/**
 * Delivery boy (rider): the collection module, plus the field-staff basics.
 *
 * The first four keys are NOT optional. `can()` returns from this Set before it reaches the
 * `TASKS_FIELD_ROLES` branch below, which is the only thing that used to grant them — omitting
 * them here would silently revoke Tasks, Visits and Performance from every rider. Same trap
 * documented for the warehouse roles above.
 *
 * Deliberately ABSENT from every Set, which per the idiom above makes `can(role, key)` an exact
 * admin test: 'collection:report', 'collection:activity', 'collection:day-end',
 * 'collection:correct', 'collection:receive', 'collection:assign'.
 */
const DELIVERY_MAN_PERMISSIONS = new Set([
  // — preserved from the old TASKS_FIELD_ROLES branch —
  'tasks:view',
  'tasks:update-status',
  'visits:view',
  'analytics:view-own',
  // — riders check in and out like every other field role —
  'attendance:view',
  'attendance:create',
  // — the city-scoped client list, for the credit-recovery party picker; and the pin fix,
  //   since the rider is the one standing outside the shop —
  'dealers:view',
  'dealers:fix-location',
  // — the collection module itself —
  'collection:view',
  'collection:deliver',
  'collection:recover',
  'collection:settle',
]);

/**
 * Check whether the given role has permission to perform an action.
 * Usage: can(user?.role, 'orders:create')
 */
const TASKS_FIELD_ROLES: Role[] = ['employee'];

export function can(role: Role | string | undefined, permission: string): boolean {
  if (role === 'admin') return true;
  if (role === 'sales_manager') return SALES_MANAGER_PERMISSIONS.has(permission);
  if (role === 'order_taker') return ORDER_TAKER_PERMISSIONS.has(permission);
  // These three return early, so their Sets must carry the task/visit keys that
  // `TASKS_FIELD_ROLES` used to grant them — they do, above.
  if (role === 'warehouse_manager') return WAREHOUSE_MANAGER_PERMISSIONS.has(permission);
  if (role === 'warehouse_staff') return WAREHOUSE_STAFF_PERMISSIONS.has(permission);
  if (role === 'delivery_man') return DELIVERY_MAN_PERMISSIONS.has(permission);
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
  'warehouse_staff',
  'delivery_man',
];

/** Roles that work in the warehouse module and can be tied to a warehouse. */
export const WAREHOUSE_ROLES: Role[] = ['warehouse_manager', 'warehouse_staff'];

/** Field roles that carry sales targets and can be assigned to a sales manager. */
export const FIELD_STAFF_ROLES: Role[] = ['order_taker', 'delivery_man', 'employee'];

/** All roles that can access the app (used in ProtectedRoute). */
export const ALL_ROLES: Role[] = ['admin', ...EMPLOYEE_ROLES];
