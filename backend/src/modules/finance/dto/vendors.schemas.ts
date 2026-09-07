import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

const address = Joi.object({
  street: Joi.string().trim().allow('').max(200),
  city: Joi.string().trim().allow('').max(100),
  state: Joi.string().trim().allow('').max(100),
  country: Joi.string().trim().allow('').max(100),
  postalCode: Joi.string().trim().allow('').max(20),
});

const openingBalance = Joi.object({
  amount: Joi.number().required(),
  asOf: Joi.date().allow(null).optional(),
});

export const createVendorSchema = Joi.object({
  name: Joi.string().trim().min(2).max(200).required(),
  phone: Joi.string().trim().allow('').max(40).optional(),
  email: Joi.string().trim().allow('').max(200).optional(),
  address: address.optional(),
  taxRegistrationNo: Joi.string().trim().allow('').max(50).optional(),
  // Zero means payable on receipt, which is what most cash purchases are.
  paymentTermsDays: Joi.number().integer().min(0).max(365).optional(),
  defaultExpenseLedgerId: objectId.allow(null).optional(),
  openingBalance: openingBalance.optional(),
  notes: Joi.string().trim().allow('').max(1000).optional(),
});

export const updateVendorSchema = Joi.object({
  name: Joi.string().trim().min(2).max(200).optional(),
  phone: Joi.string().trim().allow('').max(40).optional(),
  email: Joi.string().trim().allow('').max(200).optional(),
  address: address.optional(),
  taxRegistrationNo: Joi.string().trim().allow('').max(50).optional(),
  paymentTermsDays: Joi.number().integer().min(0).max(365).optional(),
  defaultExpenseLedgerId: objectId.allow(null).optional(),
  openingBalance: openingBalance.optional(),
  notes: Joi.string().trim().allow('').max(1000).optional(),
}).min(1);

export const setVendorStatusSchema = Joi.object({
  isActive: Joi.boolean().required(),
});

/**
 * Attaching typed names to a supplier.
 *
 * Exactly one of `vendorId` or `newVendorName`: the caller is either adding names to a supplier
 * that exists or creating one from those names. Accepting both would leave the question of which
 * wins, and the answer would be decided by whichever branch happened to run first.
 */
export const assignSupplierNamesSchema = Joi.object({
  vendorId: objectId.optional(),
  newVendorName: Joi.string().trim().min(2).max(200).optional(),
  typedNames: Joi.array().items(Joi.string().trim().min(1).max(200)).min(1).required(),
})
  .xor('vendorId', 'newVendorName')
  .messages({
    'object.xor': 'Choose an existing supplier or give a new name — not both.',
    'object.missing': 'Choose an existing supplier, or give a new name.',
  });
