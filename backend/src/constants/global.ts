export const ROLES = {
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  /**
   * Warehouse operations: transfers, reports, adjustments. Scoped to `User.warehouseId`
   * when one is set, company-wide when it is not.
   */
  WAREHOUSE_MANAGER: 'warehouse_manager',
  /** Day-to-day stock work at ONE warehouse. Always scoped to `User.warehouseId`. */
  WAREHOUSE_STAFF: 'warehouse_staff',
  /** Supervises a team of field staff; sees analytics for their own reports only. */
  SALES_MANAGER: 'sales_manager',
  ORDER_TAKER: 'order_taker',
  DELIVERY_MAN: 'delivery_man',
} as const;

/**
 * Field roles whose work is measured by sales targets and visit analytics.
 * These are the users that can be assigned to a sales manager via `managerId`.
 */
export const FIELD_STAFF_ROLES: readonly string[] = [
  ROLES.ORDER_TAKER,
  ROLES.DELIVERY_MAN,
  ROLES.EMPLOYEE,
];


/**
 * Roles that work inside the warehouse module and can be tied to a `warehouseId`.
 * Deliberately NOT part of `FIELD_STAFF_ROLES` — they carry no sales target and no manager.
 */
export const WAREHOUSE_ROLES: readonly string[] = [
  ROLES.WAREHOUSE_MANAGER,
  ROLES.WAREHOUSE_STAFF,
];


export const DEALER_CATEGORIES = {
  RETAILER: 'retailer',
  WHOLESELLER: 'wholesaler'
} as const;

/** Maximum dealers per route — enforcement disabled in `dealers.service.ts` (re-enable there before uncommenting). */
// export const MAX_DEALERS_PER_ROUTE = 20;


export type Role = (typeof ROLES)[keyof typeof ROLES];
export type DealerCategory = (typeof DEALER_CATEGORIES)[keyof typeof DEALER_CATEGORIES];