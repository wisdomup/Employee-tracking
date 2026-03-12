import Joi from 'joi';

export const createRouteSchema = Joi.object({
  name: Joi.string().required(),
  startingPoint: Joi.string().required(),
  endingPoint: Joi.string().required(),
});

export const updateRouteSchema = Joi.object({
  name: Joi.string().optional(),
  startingPoint: Joi.string().optional(),
  endingPoint: Joi.string().optional(),
});
