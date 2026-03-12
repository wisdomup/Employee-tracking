import Joi from 'joi';

export const createReturnSchema = Joi.object({
  productId: Joi.string().required(),
  dealerId: Joi.string().required(),
  returnType: Joi.string().valid('return', 'claim').required(),
  returnReason: Joi.string().optional(),
});

export const updateReturnSchema = Joi.object({
  productId: Joi.string().required(),
  dealerId: Joi.string().required(),
  returnType: Joi.string().valid('return', 'claim').required(),
  returnReason: Joi.string().optional().allow(''),
});
