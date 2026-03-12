import Joi from 'joi';

export const createLeaveSchema = Joi.object({
  leaveType: Joi.string().valid('full_day', 'half_day', 'short_leave').required(),
  leaveReason: Joi.string().optional(),
  leaveDate: Joi.date().required(),
});

export const updateLeaveSchema = Joi.object({
  leaveType: Joi.string().valid('full_day', 'half_day', 'short_leave').optional(),
  leaveReason: Joi.string().optional().allow(''),
  leaveDate: Joi.date().optional(),
  status: Joi.string().valid('pending', 'approved', 'rejected').optional(),
});

export const updateLeaveStatusSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
});
