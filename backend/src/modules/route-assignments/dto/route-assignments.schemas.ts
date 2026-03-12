import Joi from 'joi';

export const assignRouteSchema = Joi.object({
  routeId: Joi.string().required(),
  employeeId: Joi.string().required(),
});
