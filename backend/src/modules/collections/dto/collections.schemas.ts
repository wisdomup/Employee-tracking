import Joi from 'joi';

/**
 * Joi is the first gate; `collections.rules.ts` is the authoritative one. The rules module owns
 * the cross-field invariant (cash + online + credit = order amount) because it needs the order,
 * which Joi never sees. Note `validate()` uses `stripUnknown`, so a fourth money field cannot
 * sneak past this schema into the service.
 */

const moneyField = Joi.number().min(0).precision(2).required();
const noteField = Joi.string().max(500).optional().allow('');
const reasonField = Joi.string().max(500).optional().allow('');

/** `orderAmount` is deliberately absent — it always comes from the order, server-side. */
export const deliverOrderSchema = Joi.object({
  cash: moneyField,
  online: moneyField,
  credit: moneyField,
  note: noteField,
});

export const createRecoverySchema = Joi.object({
  dealerId: Joi.string().hex().length(24).required(),
  amount: Joi.number().greater(0).precision(2).required(),
  mode: Joi.string().valid('cash', 'online').required(),
  note: noteField,
});

export const createSettlementSchema = Joi.object({
  mode: Joi.string().valid('cash', 'online').required(),
  amount: Joi.number().greater(0).precision(2).required(),
  note: noteField,
  /**
   * Uploaded separately via `POST /api/upload` and passed here as a URL, so this endpoint stays
   * pure JSON and reuses the existing ImageUpload component (camera flow included).
   */
  screenshotUrl: Joi.string().max(2048).optional().allow(''),
});

export const receiveSettlementSchema = Joi.object({
  note: noteField,
});

/** All three parts are required: a partial correction is ambiguous about the remainder. */
export const correctCollectionSchema = Joi.object({
  cash: moneyField,
  online: moneyField,
  credit: moneyField,
  reason: reasonField,
});

export const correctRecoverySchema = Joi.object({
  amount: Joi.number().greater(0).precision(2).optional(),
  mode: Joi.string().valid('cash', 'online').optional(),
  reason: reasonField,
}).or('amount', 'mode');

export const correctSettlementSchema = Joi.object({
  amount: Joi.number().greater(0).precision(2).optional(),
  note: noteField,
  reason: reasonField,
}).or('amount', 'note');

/** A void erases money from every total, so the reason is mandatory. */
export const voidEntrySchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
});

/**
 * Writing off a rider's cash shortfall.
 *
 * `reason` is required and has a floor, not because three characters prove anything, but because
 * an empty string in this field is the difference between an auditable decision and an
 * unexplained hole.
 */
export const writeOffRiderCashSchema = Joi.object({
  riderId: Joi.string().hex().length(24).required(),
  mode: Joi.string().valid('cash', 'online').required(),
  amount: Joi.number().positive().required(),
  reason: Joi.string().trim().min(3).max(500).required(),
});
