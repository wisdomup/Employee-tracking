import Joi from 'joi';

const APPROVAL_TYPES = [
  'leave',
  'allowance',
  'advance_salary',
  'query',
  'other',
] as const;

const DURATION_TYPES = ['full_day', 'half_day', 'short_leave'] as const;

export const createApprovalSchema = Joi.object({
  approvalType: Joi.string()
    .valid(...APPROVAL_TYPES)
    .default('leave'),
  leaveType: Joi.when('approvalType', {
    is: 'leave',
    then: Joi.string().valid(...DURATION_TYPES).required(),
    otherwise: Joi.string().valid(...DURATION_TYPES).optional().strip(),
  }),
  leaveReason: Joi.when('approvalType', {
    is: 'leave',
    then: Joi.string().optional().allow(''),
    otherwise: Joi.string().trim().min(1).required(),
  }),
  leaveDate: Joi.date().required(),
});

export const updateApprovalSchema = Joi.object({
  approvalType: Joi.string().valid(...APPROVAL_TYPES).optional(),
  leaveType: Joi.string().valid(...DURATION_TYPES).optional(),
  leaveReason: Joi.string().optional().allow(''),
  leaveDate: Joi.date().optional(),
  status: Joi.string().valid('pending', 'approved', 'rejected').optional(),
}).min(1);

export const updateApprovalStatusSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
});
