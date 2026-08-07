import { Schema, model, Document, Types } from 'mongoose';

/**
 * Monthly physical stock count (spec §12): one warehouse at a time, sellable and damaged counted
 * separately, submitted for admin approval, and on approval the system figure is corrected.
 *
 * IMPORTANT — the one place this deviates from the spec text. The spec says approval "updates system
 * stock to match the physical count". Taken literally, that would erase every sale, transfer and
 * receipt that happened between submission and approval. So each line stores the system figure AS AT
 * SUBMISSION, and approval applies the DELTA (`counted − systemAtSubmission`). The report still shows
 * the submit-time figure, so the variance the counter actually saw is preserved.
 */
export interface IStockCountLine {
  productId: Types.ObjectId;
  /** System figures snapshotted when the sheet was submitted. */
  systemSellable: number;
  systemDamaged: number;
  countedSellable: number;
  countedDamaged: number;
  note?: string;
}

export type StockCountStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface IStockCount extends Document {
  _id: Types.ObjectId;
  documentNo?: number;
  warehouseId: Types.ObjectId;
  /** `YYYY-MM`, defaulted in the business timezone so "monthly" is not a UTC accident. */
  periodMonth: string;
  /**
   * Only the products the counter actually covered. A partial count must not be read as
   * "everything else is zero", so approval iterates THIS list, never the product catalogue.
   */
  lines: IStockCountLine[];
  status: StockCountStatus;
  submittedBy?: Types.ObjectId;
  submittedAt?: Date;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
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

const stockCountLineSchema = new Schema<IStockCountLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    systemSellable: { type: Number, required: true, default: 0 },
    systemDamaged: { type: Number, required: true, default: 0 },
    countedSellable: { type: Number, required: true, min: 0, default: 0 },
    countedDamaged: { type: Number, required: true, min: 0, default: 0 },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const stockCountSchema = new Schema<IStockCount>(
  {
    documentNo: { type: Number, min: 1 },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    periodMonth: {
      type: String,
      required: true,
      match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth must look like YYYY-MM'],
    },
    lines: { type: [stockCountLineSchema], required: true },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'rejected', 'cancelled'],
      default: 'draft',
    },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
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

stockCountSchema.index({ documentNo: 1 }, { unique: true, sparse: true });
// "One open count per warehouse" cannot be a partial unique index — `partialFilterExpression` does
// not support `$in` — so it is asserted in the service instead.
stockCountSchema.index({ warehouseId: 1, periodMonth: 1, status: 1 });
stockCountSchema.index({ status: 1, createdAt: -1 });
stockCountSchema.index({ isTrashed: 1, createdAt: -1 });

export const StockCountModel = model<IStockCount>('StockCount', stockCountSchema);
