import Joi from 'joi';
import { PAYMENT_METHODS } from '../../../models/supplier-payment.model';

const objectId = Joi.string().hex().length(24);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const createCategorySchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  ledgerId: objectId.required().messages({
    'any.required': 'Choose the expense account this category posts to.',
  }),
  requiresApproval: Joi.boolean().default(false),
  // Null means no limit. Zero is allowed and means every expense in the category waits.
  approvalAbove: Joi.number().min(0).allow(null).default(null),
  requiresReceipt: Joi.boolean().default(false),
  notes: Joi.string().trim().allow('').max(500).optional(),
});

export const updateCategorySchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  ledgerId: objectId.optional(),
  requiresApproval: Joi.boolean().optional(),
  approvalAbove: Joi.number().min(0).allow(null).optional(),
  requiresReceipt: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  notes: Joi.string().trim().allow('').max(500).optional(),
}).min(1);

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

const expenseBody = {
  categoryId: objectId.required().messages({ 'any.required': 'Choose what kind of spending this is.' }),
  expenseDate: Joi.date().required(),
  description: Joi.string().trim().min(3).max(300).required().messages({
    'any.required': 'Say what the money was spent on.',
    'string.empty': 'Say what the money was spent on.',
    'string.min': 'Say what the money was spent on.',
  }),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'An expense has to be for something.',
  }),
  taxAmount: Joi.number().min(0).default(0),
  method: Joi.string().valid(...PAYMENT_METHODS).required(),
  paidFromLedgerId: objectId.required().messages({
    'any.required': 'Say which cash or bank account the money came out of.',
  }),
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
  vendorId: objectId.allow(null, '').optional(),
  payeeName: Joi.string().trim().allow('').max(200).optional(),
  warehouseId: objectId.allow(null, '').optional(),
  attachments: Joi.array().items(Joi.string().trim().max(500)).max(10).default([]),
  notes: Joi.string().trim().allow('').max(1000).optional(),
};

export const createExpenseSchema = Joi.object(expenseBody);

export const updateExpenseSchema = Joi.object(expenseBody);

export const rejectExpenseSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why it is being rejected — whoever submitted it needs to know what to fix.',
    'string.empty': 'Say why it is being rejected — whoever submitted it needs to know what to fix.',
    'string.min': 'Say why it is being rejected — whoever submitted it needs to know what to fix.',
  }),
});

export const cancelExpenseSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required().messages({
    'any.required': 'Say why this expense is being cancelled.',
    'string.empty': 'Say why this expense is being cancelled.',
  }),
});
