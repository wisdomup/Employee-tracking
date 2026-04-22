import Joi from 'joi';

const termsAndConditionsField = Joi.string().allow('').max(50_000).optional();

const orderProductSchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().required(),
  price: Joi.number().required(),
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
});

export const approveOrderSchema = Joi.object({
  termsAndConditions: termsAndConditionsField,
});
