import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const createReconciliationSchema = Joi.object({
  ledgerId: objectId.required(),
  statementDate: Joi.date().required(),
  /*
   * Signed, and NOT constrained to be positive.
   *
   * An overdrawn account is a real thing and the statement prints it as a negative. Refusing it
   * here would leave the one business that most needs to reconcile unable to.
   */
  statementClosingBalance: Joi.number().required(),
  notes: Joi.string().trim().allow('').max(1000).optional(),
});

export const updateReconciliationSchema = Joi.object({
  statementClosingBalance: Joi.number().optional(),
  notes: Joi.string().trim().allow('').max(1000).optional(),
}).min(1);

/** Ticking a batch on or off. The whole statement page at once, not one line per request. */
export const setClearedLinesSchema = Joi.object({
  lineIds: Joi.array().items(objectId).min(1).max(500).required(),
  cleared: Joi.boolean().required(),
});

export const reopenReconciliationSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why this reconciliation is being reopened.',
    'string.empty': 'Say why this reconciliation is being reopened.',
  }),
});
