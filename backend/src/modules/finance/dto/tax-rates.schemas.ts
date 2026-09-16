import Joi from 'joi';
import { TAX_RATE_KINDS } from '../../../models/tax-rate.model';

export const createTaxRateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  kind: Joi.string().valid(...TAX_RATE_KINDS).required().messages({
    'any.only':
      'Say whether this is tax charged on sales or tax withheld from a supplier. They behave in '
      + 'opposite ways and cannot be told apart later.',
  }),
  /** A percentage, not a multiplier: 17, 4.5, 0.25. */
  percentage: Joi.number().min(0).max(100).required(),
  notes: Joi.string().trim().allow('').max(500).optional(),
});

export const updateTaxRateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  // Accepted so an unchanged value can be sent back with the rest of a form, and refused by the
  // service if it actually differs — a rate that changed kind would misdescribe every document
  // that cited it.
  kind: Joi.string().valid(...TAX_RATE_KINDS).optional(),
  percentage: Joi.number().min(0).max(100).optional(),
  notes: Joi.string().trim().allow('').max(500).optional(),
  isActive: Joi.boolean().optional(),
}).min(1);

export const setTaxRateStatusSchema = Joi.object({
  isActive: Joi.boolean().required(),
});
