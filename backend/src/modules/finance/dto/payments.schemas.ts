import Joi from 'joi';
import { PAYMENT_METHODS } from '../../../models/supplier-payment.model';

const objectId = Joi.string().hex().length(24);

/**
 * One bill this payment settles.
 *
 * `amount` is optional and defaults, in the service, to what is left unpaid on the bill — capped
 * by what is left of the payment. That is the figure in nearly every case, and asking somebody to
 * retype a number the screen already knows is how a transposed digit gets in.
 */
const allocation = Joi.object({
  billId: objectId.required(),
  amount: Joi.number().min(0).optional(),
});

const paymentBody = {
  vendorId: objectId.required(),
  paymentDate: Joi.date().required(),
  method: Joi.string().valid(...PAYMENT_METHODS).required(),
  paidFromLedgerId: objectId.required().messages({
    'any.required': 'Say which cash or bank account the money is coming out of.',
  }),
  // Required for a cheque, because the number is what bank reconciliation matches on and what
  // stops one leaf being entered twice. Meaningless for anything else, so it is simply ignored.
  chequeNo: Joi.when('method', {
    is: 'cheque',
    then: Joi.string().trim().min(1).max(40).required().messages({
      'any.required': 'A cheque needs its cheque number.',
      'string.empty': 'A cheque needs its cheque number.',
    }),
    otherwise: Joi.string().trim().allow('').max(40).optional(),
  }),
  chequeDate: Joi.date().optional().allow(null),
  transferReference: Joi.string().trim().allow('').max(100).optional(),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'A payment has to be for something.',
  }),
  allocations: Joi.array().items(allocation).default([]),
  notes: Joi.string().trim().allow('').max(1000).optional(),
};

/**
 * Allocations may add up to LESS than the payment — the rest is on account — but never more.
 *
 * Only explicit amounts can be checked here; defaulted ones are capped by the service, which is
 * where the authoritative check lives anyway. This one exists so the common mistake is refused
 * before anything is loaded.
 */
const notOverAllocated = (schema: Joi.ObjectSchema) =>
  schema
    .custom((value, helpers) => {
      const explicit = (value.allocations ?? []).reduce(
        (sum: number, a: { amount?: number }) => sum + (a.amount ?? 0),
        0,
      );
      if (explicit - value.amount > 0.005) return helpers.error('payment.overAllocated');
      return value;
    })
    .messages({
      'payment.overAllocated':
        'The bills this payment is set against add up to more than the payment itself.',
    });

export const createPaymentSchema = notOverAllocated(Joi.object(paymentBody));

export const updatePaymentSchema = notOverAllocated(Joi.object(paymentBody));

export const cancelPaymentSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why this payment is being cancelled.',
    'string.empty': 'Say why this payment is being cancelled.',
  }),
});

/** The day the cheque showed on the bank statement — which is the date the bank moves on. */
export const clearChequeSchema = Joi.object({
  clearedOn: Joi.date().required().messages({
    'any.required': 'Say which day the cheque cleared on the bank statement.',
    'date.base': 'Say which day the cheque cleared on the bank statement.',
  }),
});
