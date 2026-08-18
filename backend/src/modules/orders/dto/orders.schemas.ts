import Joi from 'joi';

const termsAndConditionsField = Joi.string().allow('').max(50_000).optional();

const orderProductSchema = Joi.object({
  productId: Joi.string().required(),
  // Stock is counted in whole pieces. Without `.integer().min(1)` a negative quantity
  // passes the stock pre-check and then *increments* stock on the guarded update.
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().min(0).required(),
  // Flat Rs. off this line's subtotal. Clamped to the subtotal in the service so a line
  // can never go negative.
  discount: Joi.number().min(0).optional(),
});

export const createOrderSchema = Joi.object({
  products: Joi.array().items(orderProductSchema).min(1).required(),
  totalPrice: Joi.number().optional(),
  discount: Joi.number().optional(),
  grandTotal: Joi.number().optional(),
  paidAmount: Joi.number().optional(),
  description: Joi.string().optional(),
  termsAndConditions: termsAndConditionsField,
  status: Joi.string()
    .valid('pending', 'approved', 'packed', 'dispatched', 'delivered', 'cancelled')
    .optional(),
  paymentType: Joi.string().valid('online', 'adjustment', 'cash', 'credit').optional(),
  orderDate: Joi.date().optional(),
  deliveryDate: Joi.date().optional(),
  dealerId: Joi.string().required(),
  routeId: Joi.string().optional().allow(null, ''),
  /** Visit the rider is checked in to, when the order is punched via "Order Lena". */
  visitId: Joi.string().hex().length(24).optional(),
  /**
   * Source warehouse. Normally resolved from the salesman's city; only an admin may override it, and
   * the controller strips it for every other role.
   */
  warehouseId: Joi.string().hex().length(24).optional(),
});

export const updateOrderSchema = Joi.object({
  products: Joi.array().items(orderProductSchema).min(1).optional(),
  totalPrice: Joi.number().optional(),
  discount: Joi.number().optional(),
  grandTotal: Joi.number().optional(),
  paidAmount: Joi.number().optional(),
  description: Joi.string().optional().allow(''),
  termsAndConditions: termsAndConditionsField,
  status: Joi.string()
    .valid('pending', 'approved', 'packed', 'dispatched', 'delivered', 'cancelled')
    .optional(),
  paymentType: Joi.string().valid('online', 'adjustment', 'cash', 'credit').optional(),
  orderDate: Joi.date().optional(),
  deliveryDate: Joi.date().optional(),
  dealerId: Joi.string().optional(),
  routeId: Joi.string().optional().allow(null, ''),
  /** Admin-only source-warehouse change; the move is applied as a compensating pair of movements. */
  warehouseId: Joi.string().hex().length(24).optional(),
});

export const approveOrderSchema = Joi.object({
  termsAndConditions: termsAndConditionsField,
  /**
   * Rider to hand this order to. Optional — an admin may approve now and assign later via
   * `PATCH /orders/:id/assign-rider`. An order with no rider is invisible to every rider.
   */
  assignedRiderId: Joi.string().hex().length(24).optional().allow(null, ''),
});

/** `null`/`''` unassigns; a 24-hex id assigns. Required so "assign" is never a silent no-op. */
export const assignRiderSchema = Joi.object({
  assignedRiderId: Joi.string().hex().length(24).required().allow(null, ''),
});
