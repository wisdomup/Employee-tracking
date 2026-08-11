import Joi from 'joi';

/**
 * Every quantity here is `.integer()`: the spec is explicit that stock is counted in PIECES, not
 * cartons, "because a carton can have missing or extra pieces". The ledger rejects fractions too,
 * but failing at the edge gives a far better error message.
 */
const objectId = Joi.string().hex().length(24);
const pieces = Joi.number().integer().min(1);
const piecesOrZero = Joi.number().integer().min(0);
const rate = Joi.number().min(0);
const reason = Joi.string().trim().min(3).max(500);

export const createWarehouseSchema = Joi.object({
  name: Joi.string().trim().max(200).required(),
  city: Joi.string().trim().max(120).required(),
  address: Joi.string().trim().max(500).optional().allow(''),
  managerId: objectId.optional().allow(null, ''),
  isMain: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
});

export const updateWarehouseSchema = Joi.object({
  name: Joi.string().trim().max(200).optional(),
  city: Joi.string().trim().max(120).optional(),
  address: Joi.string().trim().max(500).optional().allow(''),
  managerId: objectId.optional().allow(null, ''),
  isActive: Joi.boolean().optional(),
}).min(1);

export const postOpeningStockSchema = Joi.object({
  warehouseId: objectId.required(),
  effectiveAt: Joi.date().optional(),
  lines: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),
        sellableQty: piecesOrZero.required(),
        damagedQty: piecesOrZero.optional(),
        rate: rate.optional(),
      }),
    )
    .min(1)
    .required(),
});

export const createStockReceiptSchema = Joi.object({
  receiptDate: Joi.date().required(),
  supplierName: Joi.string().trim().max(200).optional().allow(''),
  notes: Joi.string().trim().max(1000).optional().allow(''),
  products: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),
        quantity: pieces.required(),
        rate: rate.required(),
      }),
    )
    .min(1)
    .required(),
  // Accepted and ignored: Stock In always lands in Main. Declared so an older client that still
  // sends it gets a clean 200 rather than a confusing validation error.
  warehouseId: objectId.optional(),
});

/**
 * Editing a receipt replaces its whole line set, so the payload is the create payload plus a
 * reason. `reason` is required: an edit to a posted stock document overwrites figures that were
 * already printed on a slip, and "why" is the only thing that makes that defensible later.
 */
export const updateStockReceiptSchema = Joi.object({
  receiptDate: Joi.date().required(),
  supplierName: Joi.string().trim().max(200).optional().allow(''),
  notes: Joi.string().trim().max(1000).optional().allow(''),
  reason: reason.required(),
  products: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),
        quantity: pieces.required(),
        rate: rate.required(),
      }),
    )
    .min(1)
    .required(),
  // Ignored, as on create: a receipt never moves warehouse.
  warehouseId: objectId.optional(),
});

export const reasonSchema = Joi.object({
  reason: reason.required(),
});

/** Delete carries an optional note — the row is trashed either way. */
export const optionalReasonSchema = Joi.object({
  reason: reason.optional(),
});

export const createTransferSchema = Joi.object({
  fromWarehouseId: objectId.optional(),
  toWarehouseId: objectId.required(),
  notes: Joi.string().trim().max(1000).optional().allow(''),
  products: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),
        sentQty: pieces.required(),
      }),
    )
    .min(1)
    .required(),
});

export const receiveTransferSchema = Joi.object({
  lines: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),
        receivedQty: piecesOrZero.required(),
        receiveNote: Joi.string().trim().max(300).optional().allow(''),
      }),
    )
    .min(1)
    .required(),
});

export const resolveMismatchSchema = Joi.object({
  resolution: Joi.string().valid('write_off', 'return_to_source').required(),
  reason: reason.required(),
});

export const createDamageClaimSchema = Joi.object({
  warehouseId: objectId.optional(),
  source: Joi.string().valid('internal_damage', 'client_claim').required(),
  // A client claim without the client's name is useless for the damage report, so it is required
  // exactly when the source says a client is involved.
  clientName: Joi.when('source', {
    is: 'client_claim',
    then: Joi.string().trim().min(2).max(200).required(),
    otherwise: Joi.string().trim().max(200).optional().allow(''),
  }),
  dealerId: objectId.optional().allow(null, ''),
  reason: reason.required(),
  products: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),
        quantity: pieces.required(),
      }),
    )
    .min(1)
    .required(),
});

export const openStockCountSchema = Joi.object({
  warehouseId: objectId.required(),
  periodMonth: Joi.string()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

export const saveStockCountSchema = Joi.object({
  lines: Joi.array()
    .items(
      Joi.object({
        productId: objectId.required(),
        countedSellable: piecesOrZero.required(),
        countedDamaged: piecesOrZero.required(),
        note: Joi.string().trim().max(300).optional().allow(''),
      }),
    )
    .min(1)
    .required(),
});

export const resyncMirrorSchema = Joi.object({
  productIds: Joi.array().items(objectId).optional(),
});
