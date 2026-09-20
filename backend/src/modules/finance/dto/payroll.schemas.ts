import Joi from 'joi';

const objectId = Joi.string().hex().length(24);
const period = Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/);
const method = Joi.string().valid('cash', 'bank_transfer');

export const createRunSchema = Joi.object({
  period: period.required().messages({
    'string.pattern.base': 'Say which month this payroll is for, as YYYY-MM.',
    'any.required': 'Say which month this payroll is for.',
  }),
});

/**
 * Every figure on a line is optional: a correction usually touches one person's bonus or one
 * person's advance recovery, and sending the whole month back each time is how a stale screen
 * overwrites somebody else's edit.
 */
export const updateRunSchema = Joi.object({
  lines: Joi.array()
    .items(
      Joi.object({
        userId: objectId.required(),
        salary: Joi.number().min(0).optional(),
        bonus: Joi.number().min(0).optional(),
        allowance: Joi.number().min(0).optional(),
        advanceRecovery: Joi.number().min(0).optional(),
        fineRecovery: Joi.number().min(0).optional(),
      }),
    )
    .optional(),
  notes: Joi.string().trim().allow('').max(1000).optional(),
}).min(1);

export const payRunSchema = Joi.object({
  paidOn: Joi.date().required(),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'A payment has to be for something.',
  }),
  method: method.required().messages({
    'any.required': 'Say whether the wages were paid in cash or by bank transfer.',
  }),
  paidFromLedgerId: objectId.required().messages({
    'any.required': 'Say which cash or bank account the wages came out of.',
  }),
  reference: Joi.string().trim().allow('').max(100).optional(),
});

export const advanceSchema = Joi.object({
  userId: objectId.required().messages({ 'any.required': 'Say who the advance is for.' }),
  advanceDate: Joi.date().required(),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'An advance has to be for something.',
  }),
  method: method.required(),
  paidFromLedgerId: objectId.required().messages({
    'any.required': 'Say which cash or bank account the money came out of.',
  }),
  reference: Joi.string().trim().allow('').max(100).optional(),
  reason: Joi.string().trim().allow('').max(500).optional(),
});

export const cancelPayrollSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why this is being cancelled.',
    'string.empty': 'Say why this is being cancelled.',
  }),
});
