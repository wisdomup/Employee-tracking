import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

/**
 * Figures typed on the worksheet.
 *
 * Amounts are signed and given in the account's OWN direction: 500,000 against Bank means money
 * held, 200,000 against a loan means money owed. Asking a non-accountant which side of the entry
 * a figure belongs on is how opening balances get entered backwards.
 */
export const saveWorksheetSchema = Joi.object({
  entries: Joi.array()
    .items(
      Joi.object({
        ledgerId: objectId.required(),
        amount: Joi.number().required(),
      }),
    )
    .min(1)
    .max(500)
    .required(),
});

export const postOpeningEntrySchema = Joi.object({
  cutoverDate: Joi.date().required(),
  narration: Joi.string().trim().allow('').max(300).optional(),
});

export const closeOpeningEquitySchema = Joi.object({
  toLedgerId: objectId.required(),
});

export const reopenMigrationSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why the changeover is being reopened.',
    'string.empty': 'Say why the changeover is being reopened.',
  }),
});
