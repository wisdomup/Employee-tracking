import Joi from 'joi';
import { CONTRA_SUBTYPES, VOUCHER_CATEGORIES } from '../../../models/voucher.model';

const objectId = Joi.string().hex().length(24);

/**
 * One line of a journal voucher.
 *
 * Exactly one side carries a figure. A line with both, or neither, is somebody's half-finished
 * thought, and letting it through would produce an entry that balances by accident.
 */
const journalLine = Joi.object({
  ledgerId: objectId.required(),
  debit: Joi.number().min(0).default(0),
  credit: Joi.number().min(0).default(0),
  narration: Joi.string().trim().allow('').max(300).optional(),
});

const voucherBody = {
  category: Joi.string().valid(...VOUCHER_CATEGORIES).required().messages({
    'any.only': 'Choose one of the six voucher categories.',
    'any.required': 'Choose which kind of voucher this is.',
  }),

  // Contra only.
  subtype: Joi.when('category', {
    is: 'CV',
    then: Joi.string().valid(...CONTRA_SUBTYPES).required().messages({
      'any.required': 'Say what kind of transfer this is.',
    }),
    otherwise: Joi.any().strip(),
  }),

  voucherDate: Joi.date().required(),
  narration: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say what this voucher is for.',
    'string.empty': 'Say what this voucher is for.',
    'string.min': 'Say what this voucher is for.',
  }),
  reference: Joi.string().trim().allow('').max(100).optional(),
  attachments: Joi.array().items(Joi.string().trim().max(500)).max(10).default([]),

  // The four money categories: one cash or bank account, and the other side of the entry.
  cashBankLedgerId: Joi.when('category', {
    is: Joi.valid('CPV', 'CRV', 'BPV', 'BRV'),
    then: objectId.required().messages({
      'any.required': 'Say which cash or bank account the money moves through.',
    }),
    otherwise: Joi.any().strip(),
  }),
  /** The other side, when the voucher is not with a shop. */
  counterLedgerId: Joi.when('category', {
    is: Joi.valid('CPV', 'CRV', 'BPV', 'BRV'),
    then: objectId.optional(),
    otherwise: Joi.any().strip(),
  }),
  partyType: Joi.when('category', {
    is: Joi.valid('CPV', 'CRV', 'BPV', 'BRV'),
    then: Joi.string().valid('dealer').optional(),
    otherwise: Joi.any().strip(),
  }),
  partyId: Joi.when('category', {
    is: Joi.valid('CPV', 'CRV', 'BPV', 'BRV'),
    then: objectId.optional(),
    otherwise: Joi.any().strip(),
  }),
  amount: Joi.when('category', {
    is: 'JV',
    then: Joi.any().strip(),
    otherwise: Joi.number().positive().required().messages({
      'number.positive': 'A voucher has to be for something.',
      'any.required': 'Say how much.',
    }),
  }),

  // Contra: where the money comes from and where it goes.
  fromLedgerId: Joi.when('category', {
    is: 'CV',
    then: objectId.required().messages({ 'any.required': 'Say which account the money leaves.' }),
    otherwise: Joi.any().strip(),
  }),
  toLedgerId: Joi.when('category', {
    is: 'CV',
    then: objectId.required().messages({ 'any.required': 'Say which account the money arrives in.' }),
    otherwise: Joi.any().strip(),
  }),

  // Journal: the lines themselves.
  lines: Joi.when('category', {
    is: 'JV',
    then: Joi.array().items(journalLine).min(2).required().messages({
      'array.min': 'A journal voucher needs at least two lines — something debited and something credited.',
      'any.required': 'A journal voucher needs its lines.',
    }),
    otherwise: Joi.any().strip(),
  }),
};

export const createVoucherSchema = Joi.object(voucherBody);

export const updateVoucherSchema = Joi.object(voucherBody);

export const rejectVoucherSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say what needs fixing — whoever raised it will see this.',
    'string.empty': 'Say what needs fixing — whoever raised it will see this.',
    'string.min': 'Say what needs fixing — whoever raised it will see this.',
  }),
});

export const cancelVoucherSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why this voucher is being cancelled.',
    'string.empty': 'Say why this voucher is being cancelled.',
  }),
});
