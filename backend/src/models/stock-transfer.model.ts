import { Schema, model, Document, Types } from 'mongoose';

/**
 * Moving stock between warehouses. Three steps, per spec §8:
 *   1. the sending warehouse creates the transfer   → `pending`   (no stock moves)
 *   2. an admin approves it                         → `approved`  (source sellable → inTransit)
 *   3. the receiving warehouse confirms what ARRIVED
 *        received == sent → `completed`
 *        received <  sent → `mismatch`, flagged for an admin; only the received quantity is
 *                           credited, and the shortfall stays parked in the source's inTransit
 *                           bucket so it reads as an open question rather than silent loss.
 *        received >  sent → rejected outright; over-receipt would create stock from nothing.
 *
 * Stock leaves the source at APPROVAL, not at receipt: in between the goods are on a truck and
 * must not be sellable anywhere.
 */
export interface IStockTransferLine {
  productId: Types.ObjectId;
  sentQty: number;
  /** Unset until the destination confirms. */
  receivedQty?: number;
  receiveNote?: string;
}

export type StockTransferStatus =
  | 'pending'
  | 'approved'
  | 'completed'
  | 'mismatch'
  | 'rejected'
  | 'cancelled';

export interface IStockTransfer extends Document {
  _id: Types.ObjectId;
  documentNo?: number;
  fromWarehouseId: Types.ObjectId;
  toWarehouseId: Types.ObjectId;
  products: IStockTransferLine[];
  status: StockTransferStatus;
  notes?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  receivedBy?: Types.ObjectId;
  receivedAt?: Date;
  mismatchResolvedBy?: Types.ObjectId;
  mismatchResolvedAt?: Date;
  /** `write_off` accepts the loss; `return_to_source` puts the shortfall back on the shelf. */
  mismatchResolution?: 'write_off' | 'return_to_source';
  mismatchResolutionNote?: string;
  cancelledBy?: Types.ObjectId;
  cancelledAt?: Date;
  cancelReason?: string;
  createdBy: Types.ObjectId;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const stockTransferLineSchema = new Schema<IStockTransferLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sentQty: { type: Number, required: true, min: 1 },
    receivedQty: { type: Number, min: 0 },
    receiveNote: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const stockTransferSchema = new Schema<IStockTransfer>(
  {
    documentNo: { type: Number, min: 1 },
    fromWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    toWarehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    products: { type: [stockTransferLineSchema], required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'completed', 'mismatch', 'rejected', 'cancelled'],
      default: 'pending',
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receivedAt: { type: Date },
    mismatchResolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    mismatchResolvedAt: { type: Date },
    mismatchResolution: { type: String, enum: ['write_off', 'return_to_source'] },
    mismatchResolutionNote: { type: String, trim: true, maxlength: 500 },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

stockTransferSchema.index({ documentNo: 1 }, { unique: true, sparse: true });
stockTransferSchema.index({ fromWarehouseId: 1, status: 1, createdAt: -1 });
stockTransferSchema.index({ toWarehouseId: 1, status: 1, createdAt: -1 });
stockTransferSchema.index({ status: 1, createdAt: -1 });
stockTransferSchema.index({ isTrashed: 1, createdAt: -1 });
stockTransferSchema.index({ isTrashed: 1, trashedAt: -1 });

export const StockTransferModel = model<IStockTransfer>('StockTransfer', stockTransferSchema);
