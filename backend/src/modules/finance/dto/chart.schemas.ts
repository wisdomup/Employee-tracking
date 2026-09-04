import Joi from 'joi';
import { ACCOUNT_TYPES, SUBLEDGER_TYPES } from '../finance.rules';

/**
 * Codes are validated twice on purpose: shape here, block membership in `finance.rules.ts`.
 *
 * Joi can say "four digits" but cannot say "4210 is not an asset" without knowing the group the
 * request names, which is a database read. Splitting them keeps the fast, obvious rejection at
 * the edge and the accounting rule where the accounting rules live.
 */
const code = Joi.string()
  .pattern(/^\d{4}$/)
  .messages({ 'string.pattern.base': 'A code must be exactly four digits, for example 1110.' });

const objectId = Joi.string().hex().length(24);

const accountType = Joi.string().valid(...ACCOUNT_TYPES);

export const createGroupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  code: code.required(),
  // Required only for a root group — a child inherits from its parent, and sending a type that
  // disagrees is refused rather than silently ignored.
  accountType: accountType.optional(),
  parentGroupId: objectId.allow(null).optional(),
  sortOrder: Joi.number().integer().min(0).max(9999).optional(),
});

export const updateGroupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  code: code.optional(),
  accountType: accountType.optional(),
  sortOrder: Joi.number().integer().min(0).max(9999).optional(),
}).min(1);

const openingBalance = Joi.object({
  amount: Joi.number().required(),
  asOf: Joi.date().allow(null).optional(),
});

export const createLedgerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  // Optional: the service allocates the next free code in the group's block when it is absent.
  code: code.optional(),
  groupId: objectId.required(),
  description: Joi.string().trim().allow('').max(500).optional(),
  openingBalance: openingBalance.optional(),
  isControl: Joi.boolean().optional(),
  subledgerType: Joi.string().valid(...SUBLEDGER_TYPES).allow(null).optional(),
  isCashEquivalent: Joi.boolean().optional(),
});

export const updateLedgerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).optional(),
  code: code.optional(),
  groupId: objectId.optional(),
  description: Joi.string().trim().allow('').max(500).optional(),
  openingBalance: openingBalance.optional(),
  isControl: Joi.boolean().optional(),
  subledgerType: Joi.string().valid(...SUBLEDGER_TYPES).allow(null).optional(),
  isCashEquivalent: Joi.boolean().optional(),
}).min(1);

/**
 * Activate or deactivate, on its own endpoint.
 *
 * Kept off the edit schemas so the two map cleanly onto different matrix cells: editing a
 * ledger is `finance-coa:edit`, retiring one is `finance-coa:change`. Folded together, an
 * admin granting "may correct a typo" would also be granting "may remove an account from
 * every future report".
 */
export const setStatusSchema = Joi.object({
  isActive: Joi.boolean().required(),
});
