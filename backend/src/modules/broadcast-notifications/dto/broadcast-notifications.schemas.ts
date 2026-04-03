import Joi from 'joi';

const audienceType = Joi.string().valid(
  'all',
  'all_employees',
  'role_order_taker',
  'role_delivery_man',
  'role_warehouse_manager',
  'specific_users',
);

const objectIdString = Joi.string().hex().length(24);

export const createBroadcastNotificationSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(''),
  audienceType: audienceType.required(),
  targetUserIds: Joi.array().items(objectIdString).optional(),
  startAt: Joi.date().optional(),
  endAt: Joi.date().optional(),
});

export const updateBroadcastNotificationSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(''),
  audienceType: audienceType.required(),
  targetUserIds: Joi.array().items(objectIdString).optional(),
  startAt: Joi.date().optional(),
  endAt: Joi.date().optional(),
});
