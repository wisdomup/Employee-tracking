export const ROLES = {
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  WAREHOUSE_MANAGER: 'warehouse_manager',
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


export const DEALER_CATEGORIES = {
  RETAILER: 'retailer',
  WHOLESELLER: 'wholesaler'
} as const;

/** Maximum dealers per route — enforcement disabled in `dealers.service.ts` (re-enable there before uncommenting). */
// export const MAX_DEALERS_PER_ROUTE = 20;


export type Role = (typeof ROLES)[keyof typeof ROLES];
export type DealerCategory = (typeof DEALER_CATEGORIES)[keyof typeof DEALER_CATEGORIES];