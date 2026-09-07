import Joi from 'joi';
import { SUBLEDGER_TYPES } from '../finance.rules';

const objectId = Joi.string().hex().length(24);

/**
 * A line carries a debit OR a credit, never both.
 *
 * Enforced again in `finance.rules.ts#normaliseLines`, which is what actually runs for a system
 * posting that never passes through this schema. The duplication is deliberate: the edge
 * rejects a malformed request early, the rule protects every caller.
 */
const line = Joi.object({
  ledgerId: objectId.required(),
  debit: Joi.number().min(0).default(0),
  credit: Joi.number().min(0).default(0),
  lineNarration: Joi.string().trim().allow('').max(300).optional(),
  subledgerRef: Joi.object({
    type: Joi.string().valid(...SUBLEDGER_TYPES).required(),
    id: objectId.required(),
  })
    .allow(null)
    .optional(),
});

export const createDraftSchema = Joi.object({
  date: Joi.date().required(),
  narration: Joi.string().trim().min(3).max(1000).required(),
  referenceNo: Joi.string().trim().allow('').max(50).optional(),
  // Two lines is the floor. One line is not an entry, it is half of one.
  lines: Joi.array().items(line).min(2).required(),
  attachments: Joi.array().items(Joi.string()).optional(),
});

export const updateDraftSchema = Joi.object({
  date: Joi.date().optional(),
  narration: Joi.string().trim().min(3).max(1000).optional(),
  referenceNo: Joi.string().trim().allow('').max(50).optional(),
  lines: Joi.array().items(line).min(2).optional(),
  attachments: Joi.array().items(Joi.string()).optional(),
}).min(1);

export const reverseEntrySchema = Joi.object({
  // Required, and required at the moment it happens. A reversal reconstructed from memory six
  // months later is the thing an auditor asks about and nobody can answer.
  reason: Joi.string().trim().min(3).max(500).required(),
  date: Joi.date().optional(),
});

const period = Joi.string()
  .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
  .messages({ 'string.pattern.base': 'Use YYYY-MM, for example 2026-07.' });

export const openPeriodSchema = Joi.object({
  period: period.required(),
});

export const openFiscalYearSchema = Joi.object({
  fiscalYear: Joi.string().trim().min(4).max(9).required(),
});

export const closePeriodSchema = Joi.object({
  period: period.required(),
});

export const reopenPeriodSchema = Joi.object({
  period: period.required(),
  reason: Joi.string().trim().min(3).max(500).required(),
});

export const lockThroughSchema = Joi.object({
  period: period.required(),
});
