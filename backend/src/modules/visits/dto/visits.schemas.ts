import Joi from 'joi';

export const createVisitSchema = Joi.object({
  dealerId: Joi.string().required(),
  employeeId: Joi.string().required(),
  routeId: Joi.string().optional(),
  visitDate: Joi.date().optional(),
  status: Joi.string()
    .valid('todo', 'in_progress', 'checked_in', 'completed', 'skipped', 'incomplete', 'cancelled')
    .optional(),
});

export const createVisitsForRouteSchema = Joi.object({
  routeId: Joi.string().required(),
});

export const bulkCreateVisitsSchema = Joi.object({
  employeeId: Joi.string().required(),
  visitDate: Joi.date().required(),
  dealerIds: Joi.array().items(Joi.string()).min(1).required(),
  routeId: Joi.string().optional(),
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
    .valid('todo', 'in_progress', 'checked_in', 'completed', 'skipped', 'incomplete', 'cancelled')
    .optional(),
}).or('dealerId', 'employeeId', 'routeId', 'visitDate', 'status');

export const checkInVisitSchema = Joi.object({
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
});

/**
 * Skip a visit on the route. `confirm` acknowledges a warning that the day will finish
 * below the required completion rate; without it the API returns the warning instead of
 * skipping.
 */
export const skipVisitSchema = Joi.object({
  reason: Joi.string().allow('').max(300).optional(),
  confirm: Joi.boolean().optional(),
});

/** Optional shop photos + notes a rider may attach after checking out. */
export const updateVisitGallerySchema = Joi.object({
  galleryImages: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().required(),
        caption: Joi.string().allow('').max(200).optional(),
      }),
    )
    .max(10)
    .optional(),
  visitNotes: Joi.string().allow('').max(2000).optional(),
}).or('galleryImages', 'visitNotes');
