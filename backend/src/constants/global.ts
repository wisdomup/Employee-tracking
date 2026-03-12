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


export type Role = (typeof ROLES)[keyof typeof ROLES];
export type DealerCategory = (typeof DEALER_CATEGORIES)[keyof typeof DEALER_CATEGORIES];