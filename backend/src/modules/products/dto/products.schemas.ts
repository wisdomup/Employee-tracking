import Joi from 'joi';

/**
 * `quantity` and `lastPurchaseRate` are intentionally absent from both schemas. Stock on hand is
 * derived from the warehouse balances (see product.model.ts) and the last rate comes from Stock
 * In — accepting either here would let the product form silently overwrite real stock. The
 * validate middleware strips unknown keys, so a client that still sends them is simply ignored.
 */
export const createProductSchema = Joi.object({
  barcode: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().optional(),
  image: Joi.string().optional(),
  salePrice: Joi.number().min(0).optional(),
  purchasePrice: Joi.number().min(0).optional(),
  onlinePrice: Joi.number().min(0).optional(),
  survivalQuantity: Joi.number().min(0).optional(),
  categoryId: Joi.string().required(),
  extras: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});

export const updateProductSchema = Joi.object({
  barcode: Joi.string().required(),
  name: Joi.string().required(),
  description: Joi.string().optional().allow(''),
  image: Joi.string().optional().allow(''),
  salePrice: Joi.number().min(0).optional(),
  purchasePrice: Joi.number().min(0).optional(),
  onlinePrice: Joi.number().min(0).optional(),
  survivalQuantity: Joi.number().min(0).optional(),
  categoryId: Joi.string().required(),
  extras: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});
