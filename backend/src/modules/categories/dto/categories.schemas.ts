import Joi from 'joi';

export const createCategorySchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional(),
  image: Joi.string().optional(),
});

export const updateCategorySchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional().allow(''),
  image: Joi.string().optional().allow(''),
});
