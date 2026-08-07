import { Schema, model, Document, Types } from 'mongoose';
import { StockBucket, STOCK_BUCKETS } from './warehouse-stock.model';

/**
 * The append-only stock ledger. Every change to a `WarehouseStock` bucket writes one row here.
 *
 * Three jobs:
 *  1. The audit trail the spec demands — who moved what, where, when, and why.
 *  2. The source for the movement-history report and for reversals.
 *  3. The integrity check: for every (warehouseId, productId, bucket),
 *     `Σ delta === WarehouseStock[bucket]`. That equality is how drift is detected.
 *
 * Rows are never updated or deleted. A mistake is corrected by a compensating row whose
 * `reversalOf` points at the original.
 */
export type StockMovementType =
  | 'opening_stock'
  | 'stock_in'
  | 'stock_in_reversal'
  | 'sale_out'
  | 'sale_return_in'
  | 'customer_return_in'
  | 'customer_return_reversal'
  | 'damage_marked'
  | 'damage_reversal'
  | 'transfer_out'
  | 'transfer_out_reversal'
  | 'transfer_in'
  | 'transfer_in_reversal'
  | 'transfer_shrinkage'
  | 'count_adjustment'
  | 'manual_adjustment';

export const STOCK_MOVEMENT_TYPES: StockMovementType[] = [
  'opening_stock', 'stock_in', 'stock_in_reversal', 'sale_out', 'sale_return_in',
  'customer_return_in', 'customer_return_reversal', 'damage_marked', 'damage_reversal',
  'transfer_out', 'transfer_out_reversal', 'transfer_in', 'transfer_in_reversal',
  'transfer_shrinkage', 'count_adjustment', 'manual_adjustment',
];

/**
 * Movement types that establish a cost basis. ONLY these may carry `unitCost`, which is what
 * structurally guarantees transfers, sales, damage write-offs and count adjustments can never
 * shift a product's weighted-average cost.
 */
export const COST_BEARING_TYPES: StockMovementType[] = ['opening_stock', 'stock_in'];

export type StockRefType =
  | 'opening_stock'
  | 'stock_in'
  | 'transfer'
  | 'damage_claim'
  | 'order'
  | 'return'
  | 'stock_count'
  | 'adjustment';

export const STOCK_REF_TYPES: StockRefType[] = [
  'opening_stock', 'stock_in', 'transfer', 'damage_claim', 'order', 'return', 'stock_count',
  'adjustment',
];

export interface IStockMovement extends Document {
  _id: Types.ObjectId;
  warehouseId: Types.ObjectId;
  productId: Types.ObjectId;
  bucket: StockBucket;
  /** Signed piece count. Never zero. */
  delta: number;
  /** Bucket value immediately after this row was applied — makes history readable without replay. */
  balanceAfter?: number;
  type: StockMovementType;
  refType: StockRefType;
  refId?: Types.ObjectId;
  refLine?: number;
  /** Rate per piece. Only set on cost-bearing types (see `COST_BEARING_TYPES`). */
  unitCost?: number;
  reversalOf?: Types.ObjectId;
  reason?: string;
  actorId?: Types.ObjectId;
  /** Business date — a backdated Stock In sorts by when it happened, not when it was typed. */
  occurredAt: Date;
  /**
   * `${refType}:${refId}:${refLine}:${type}[:${scope}]`. The unique index on this field is what
   * stands in for a transaction: a replayed request collides here instead of moving stock twice.
   */
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const stockMovementSchema = new Schema<IStockMovement>(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    bucket: { type: String, enum: STOCK_BUCKETS, required: true },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    refType: { type: String, enum: STOCK_REF_TYPES, required: true },
    refId: { type: Schema.Types.ObjectId },
    refLine: { type: Number },
    unitCost: { type: Number, min: 0 },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'StockMovement' },
    reason: { type: String, trim: true, maxlength: 500 },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    occurredAt: { type: Date, default: Date.now },
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

stockMovementSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
stockMovementSchema.index({ productId: 1, occurredAt: -1 });
stockMovementSchema.index({ warehouseId: 1, productId: 1, occurredAt: -1 });
stockMovementSchema.index({ refType: 1, refId: 1 });
stockMovementSchema.index({ occurredAt: -1 });
stockMovementSchema.index({ reversalOf: 1 }, { sparse: true });

export const StockMovementModel = model<IStockMovement>('StockMovement', stockMovementSchema);
