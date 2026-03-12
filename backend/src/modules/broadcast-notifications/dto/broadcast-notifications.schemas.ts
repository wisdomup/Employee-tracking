import Joi from 'joi';

export const createBroadcastNotificationSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional(),
  broadcastTo: Joi.string().valid('all', 'employees', 'dealers', 'customers').required(),
  startAt: Joi.date().optional(),
  endAt: Joi.date().optional(),
});

export const updateBroadcastNotificationSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(''),
  broadcastTo: Joi.string().valid('all', 'employees', 'dealers', 'customers').required(),
  startAt: Joi.date().optional(),
  endAt: Joi.date().optional(),
});
