import Joi from 'joi';

export const createProductSchema = Joi.object({
  barcode: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().optional(),
  image: Joi.string().optional(),
  salePrice: Joi.number().optional(),
  purchasePrice: Joi.number().optional(),
  quantity: Joi.number().optional(),
  categoryId: Joi.string().required(),
  extras: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});

export const updateProductSchema = Joi.object({
  barcode: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().optional().allow(''),
  image: Joi.string().optional().allow(''),
  salePrice: Joi.number().optional(),
  purchasePrice: Joi.number().optional(),
  quantity: Joi.number().optional(),
  categoryId: Joi.string().required(),
  extras: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});
