import { Schema, model, Document, Types } from 'mongoose';

/**
 * One-time starting stock, entered per warehouse per product when the module goes live.
 *
 * "One-time" is enforced by the database: a unique partial index on posted rows means a second
 * posting for the same warehouse+product fails outright. Cancelling a row frees the slot, which
 * is the only supported way to correct a bad entry.
 */
export interface IOpeningStock extends Document {
  _id: Types.ObjectId;
  warehouseId: Types.ObjectId;
  productId: Types.ObjectId;
  sellableQty: number;
  damagedQty: number;
  /** Cost per piece — feeds the product's weighted-average cost. */
  rate: number;
  effectiveAt: Date;
  status: 'posted' | 'cancelled';
  cancelledBy?: Types.ObjectId;
  cancelledAt?: Date;
  cancelReason?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const openingStockSchema = new Schema<IOpeningStock>(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sellableQty: { type: Number, required: true, min: 0 },
    damagedQty: { type: Number, required: true, min: 0, default: 0 },
    rate: { type: Number, required: true, min: 0, default: 0 },
    effectiveAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['posted', 'cancelled'], default: 'posted' },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

openingStockSchema.index(
  { warehouseId: 1, productId: 1 },
  { unique: true, partialFilterExpression: { status: 'posted' } },
);
openingStockSchema.index({ warehouseId: 1, status: 1, createdAt: -1 });

export const OpeningStockModel = model<IOpeningStock>('OpeningStock', openingStockSchema);
