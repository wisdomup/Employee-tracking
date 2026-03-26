import Joi from 'joi';

const returnProductSchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().min(0).required(),
});

export const createReturnSchema = Joi.object({
  dealerId: Joi.string().required(),
  returnType: Joi.string().valid('return', 'damage').required(),
  products: Joi.alternatives()
    .try(
      Joi.array().items(returnProductSchema).min(1),
      Joi.string(),
    )
    .required(),
  amount: Joi.number().min(0).optional(),
  returnReason: Joi.string().optional().allow(''),
});

export const updateReturnSchema = Joi.object({
  dealerId: Joi.string().optional(),
  returnType: Joi.string().valid('return', 'damage').optional(),
  products: Joi.alternatives()
    .try(
      Joi.array().items(returnProductSchema).min(1),
      Joi.string(),
    )
    .optional(),
  amount: Joi.number().min(0).optional(),
  returnReason: Joi.string().optional().allow(''),
  status: Joi.string().valid('pending', 'approved', 'picked', 'completed').optional(),
}).min(1);
