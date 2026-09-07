import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

/**
 * A goods receipt this bill is paying for.
 *
 * `amount` is optional and defaults, in the service, to whatever is still unbilled on that
 * receipt — which is what it is in nearly every case. Making the caller state a figure they
 * almost never want to change is how a form starts getting typed past.
 */
const matchedReceipt = Joi.object({
  receiptId: objectId.required(),
  amount: Joi.number().min(0).optional(),
});

const billLine = Joi.object({
  description: Joi.string().trim().min(1).max(300).required(),
  ledgerId: objectId.required(),
  amount: Joi.number().min(0).required(),
});

const billBody = {
  vendorId: objectId.required(),
  supplierBillNo: Joi.string().trim().allow('').max(100).optional(),
  billDate: Joi.date().required(),
  /** Absent means "work it out from the supplier's payment terms". */
  dueDate: Joi.date().optional(),
  matchedReceipts: Joi.array().items(matchedReceipt).default([]),
  lines: Joi.array().items(billLine).default([]),
  taxAmount: Joi.number().min(0).default(0),
  notes: Joi.string().trim().allow('').max(1000).optional(),
};

/**
 * A bill with neither goods nor charges on it is not a bill.
 *
 * Checked here rather than in the service so the message arrives before anything is written.
 * Tax alone does not count — an input-tax-only document is a credit note or a correction, and
 * recording one as a purchase would put a claimable figure on a return with no purchase under
 * it.
 */
const hasSomethingOnIt = (schema: Joi.ObjectSchema) =>
  schema
    .custom((value, helpers) => {
      const goods = (value.matchedReceipts ?? []).length;
      const charges = (value.lines ?? []).length;
      if (goods + charges === 0) return helpers.error('bill.empty');
      return value;
    })
    .messages({
      'bill.empty': 'A bill needs at least one goods receipt or one charge on it.',
    });

export const createBillSchema = hasSomethingOnIt(Joi.object(billBody));

export const updateBillSchema = hasSomethingOnIt(Joi.object(billBody));

export const cancelBillSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why this bill is being cancelled.',
    'string.empty': 'Say why this bill is being cancelled.',
  }),
});
