import Joi from 'joi';

const periodMonth = Joi.string()
  .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
  .messages({ 'string.pattern.base': 'periodMonth must be in YYYY-MM format' });

/** Create-or-update a monthly target. At least one metric must be supplied. */
export const upsertTargetSchema = Joi.object({
  employeeId: Joi.string().required(),
  periodMonth: periodMonth.required(),
  salesAmount: Joi.number().min(0).optional(),
  orderCount: Joi.number().integer().min(0).optional(),
  visitCount: Joi.number().integer().min(0).optional(),
  notes: Joi.string().allow('').max(500).optional(),
})
  .or('salesAmount', 'orderCount', 'visitCount')
  .messages({ 'object.missing': 'Set at least one of salesAmount, orderCount or visitCount' });
