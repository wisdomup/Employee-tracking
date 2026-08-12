import { Schema, model, Document, Types } from 'mongoose';

/**
 * One-time starting stock, entered per warehouse per product when the module goes live.
 *
 * "One-time" means one ROW per warehouse+product, enforced by a unique partial index on posted
 * rows — a second posting for the same pair fails outright. The figures on that row can still be
 * corrected: an edit reverses the old movement and re-posts the new one, so the ledger keeps both
 * halves and the correction trail below records who changed it. Cancelling frees the slot entirely.
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
  /** Correction trail — set once the figures have been edited. Mirrors `StockReceipt`. */
  lastEditedBy?: Types.ObjectId;
  lastEditedAt?: Date;
  editReason?: string;
  editCount?: number;
  /**
   * An edit that reversed the stock and then failed to re-apply it. Recorded so the next attempt
   * gets a fresh `updatedAt` stamp — see the rollback branch in `updateOpeningStock`.
   */
  lastEditFailedAt?: Date;
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
    lastEditedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastEditedAt: { type: Date },
    editReason: { type: String, trim: true, maxlength: 500 },
    editCount: { type: Number, default: 0 },
    lastEditFailedAt: { type: Date },
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
