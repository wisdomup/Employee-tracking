import Joi from 'joi';

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
  status: Joi.string()
    .valid('pending', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled')
    .optional(),
  paymentType: Joi.string().valid('online', 'adjustment', 'cash', 'credit').optional(),
  orderDate: Joi.date().optional(),
  deliveryDate: Joi.date().optional(),
  dealerId: Joi.string().required(),
  routeId: Joi.string().optional(),
});

export const updateOrderSchema = Joi.object({
  products: Joi.array().items(orderProductSchema).min(1).required(),
  totalPrice: Joi.number().optional(),
  discount: Joi.number().optional(),
  grandTotal: Joi.number().optional(),
  paidAmount: Joi.number().optional(),
  description: Joi.string().optional().allow(''),
  status: Joi.string()
    .valid('pending', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled')
    .optional(),
  paymentType: Joi.string().valid('online', 'adjustment', 'cash', 'credit').optional(),
  orderDate: Joi.date().optional(),
  deliveryDate: Joi.date().optional(),
  dealerId: Joi.string().required(),
  routeId: Joi.string().optional().allow(null, ''),
});
