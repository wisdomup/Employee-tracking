import Joi from 'joi';

export const createVisitSchema = Joi.object({
  dealerId: Joi.string().required(),
  employeeId: Joi.string().required(),
  routeId: Joi.string().optional(),
  visitDate: Joi.date().optional(),
  status: Joi.string()
    .valid('todo', 'in_progress', 'completed', 'incomplete', 'cancelled')
    .optional(),
});

export const createVisitsForRouteSchema = Joi.object({
  routeId: Joi.string().required(),
});

export const completeVisitSchema = Joi.object({
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  completionImages: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid('shop', 'selfie').required(),
        url: Joi.string().required(),
      }),
    )
    .min(2)
    .required(),
});

/** Partial update: admin may send dealer/employee/date/route/status; order_taker sends status only. */
export const updateVisitSchema = Joi.object({
  dealerId: Joi.string().optional(),
  employeeId: Joi.string().optional(),
  routeId: Joi.string().optional().allow(null, ''),
  visitDate: Joi.date().optional(),
  status: Joi.string()
    .valid('todo', 'in_progress', 'completed', 'incomplete', 'cancelled')
    .optional(),
}).or('dealerId', 'employeeId', 'routeId', 'visitDate', 'status');
