export const ROLES = {
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  WAREHOUSE_MANAGER: 'warehouse_manager',
  ORDER_TAKER: 'order_taker',
  DELIVERY_MAN: 'delivery_man',
} as const;


export const DEALER_CATEGORIES = {
  RETAILER: 'retailer',
  WHOLESELLER: 'wholesaler'
} as const;

/** Maximum dealers per route — enforcement disabled in `dealers.service.ts` (re-enable there before uncommenting). */
// export const MAX_DEALERS_PER_ROUTE = 20;


export type Role = (typeof ROLES)[keyof typeof ROLES];
export type DealerCategory = (typeof DEALER_CATEGORIES)[keyof typeof DEALER_CATEGORIES];