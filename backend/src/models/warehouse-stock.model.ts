import { Schema, model, Document, Types } from 'mongoose';

/**
 * The balance document — the single source of truth for how much stock exists where.
 *
 * Its whole reason for existing is the non-negativity guarantee: the only lock-free way to
 * stop stock going negative on MongoDB is a guarded update,
 *   `findOneAndUpdate({ warehouseId, productId, sellable: { $gte: qty } }, { $inc: { sellable: -qty } })`
 * and that predicate needs a materialised number on ONE document. Deriving balances from the
 * ledger instead would mean read-aggregate-then-insert, which races.
 *
 * Only `stock-ledger.service.ts` may write to this collection.
 */
export type StockBucket = 'sellable' | 'damaged' | 'in_transit';

/** Bucket name → field name on this document. */
export const BUCKET_FIELD: Record<StockBucket, 'sellable' | 'damaged' | 'inTransit'> = {
  sellable: 'sellable',
  damaged: 'damaged',
  in_transit: 'inTransit',
};

export const STOCK_BUCKETS: StockBucket[] = ['sellable', 'damaged', 'in_transit'];

export interface IWarehouseStock extends Document {
  _id: Types.ObjectId;
  warehouseId: Types.ObjectId;
  productId: Types.ObjectId;
  /** Good stock, ready to sell. */
  sellable: number;
  /** Set aside — damaged or claimed, not for sale. */
  damaged: number;
  /** Left this warehouse on an approved transfer but not yet received anywhere. */
  inTransit: number;
  lastMovementAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const warehouseStockSchema = new Schema<IWarehouseStock>(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    // No `min: 0` here on purpose: Mongoose validators do NOT run on `$inc` updates, so a
    // `min` would give false confidence while the query predicate does the real work.
    sellable: { type: Number, required: true, default: 0 },
    damaged: { type: Number, required: true, default: 0 },
    inTransit: { type: Number, required: true, default: 0 },
    lastMovementAt: { type: Date },
  },
  { timestamps: true },
);

/** One balance row per warehouse+product. Makes a concurrent upsert resolve as a retriable 11000. */
warehouseStockSchema.index({ warehouseId: 1, productId: 1 }, { unique: true });
warehouseStockSchema.index({ productId: 1 });
warehouseStockSchema.index({ warehouseId: 1, sellable: -1 });

export const WarehouseStockModel = model<IWarehouseStock>('WarehouseStock', warehouseStockSchema);
