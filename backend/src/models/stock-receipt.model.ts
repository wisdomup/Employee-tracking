import { Schema, model, Document, Types } from 'mongoose';

/**
 * Stock In — a lightweight goods receipt. Deliberately NOT a purchase order: there is no
 * supplier master and no approval workflow, because the spec asks only for "pick the product,
 * enter quantity and rate". `supplierName` is free text.
 *
 * Every receipt lands in the Main warehouse; from there stock is transferred out.
 *
 * A mistake has three exits, all admin-only and all guarded so the reversal can never drive
 * stock negative: **cancel** (keeps the row, marks it cancelled), **edit** (rewrites the lines
 * and re-posts the ledger, keeping the document number), and **delete** (reverses and trashes
 * the row). Delete is a soft delete on purpose — the ledger rows point at this document, so
 * removing it outright would leave the audit trail dangling.
 */
export interface IStockReceiptLine {
  productId: Types.ObjectId;
  quantity: number;
  rate: number;
}

export interface IStockReceipt extends Document {
  _id: Types.ObjectId;
  documentNo?: number;
  receiptDate: Date;
  supplierName?: string;
  /** Resolved to Main at create time and stored, so the slip and the ledger still agree later. */
  warehouseId: Types.ObjectId;
  products: IStockReceiptLine[];
  totalPieces: number;
  totalAmount: number;
  status: 'posted' | 'cancelled';
  notes?: string;
  cancelledBy?: Types.ObjectId;
  cancelledAt?: Date;
  cancelReason?: string;
  /**
   * Correction trail. An admin may edit a posted receipt (the ledger is fully reversed and
   * re-applied underneath), and an edit to a stock document has to be attributable — the
   * printed slip already went out with the old figures.
   */
  lastEditedBy?: Types.ObjectId;
  lastEditedAt?: Date;
  editReason?: string;
  /** How many times this receipt has been corrected. Zero/absent means never. */
  editCount?: number;
  /**
   * When an edit was attempted, failed part-way and was rolled back.
   *
   * Written for the audit trail, but it is also load-bearing: the edit's idempotency scope is
   * derived from `updatedAt`, and saving this is what moves `updatedAt` on so a retry does not
   * reuse a stamp whose reversal has already been recorded. See `updateStockReceipt`.
   */
  lastEditFailedAt?: Date;
  createdBy: Types.ObjectId;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const stockReceiptLineSchema = new Schema<IStockReceiptLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    rate: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const stockReceiptSchema = new Schema<IStockReceipt>(
  {
    documentNo: { type: Number, min: 1 },
    receiptDate: { type: Date, required: true },
    supplierName: { type: String, trim: true, maxlength: 200 },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    products: { type: [stockReceiptLineSchema], required: true },
    totalPieces: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    status: { type: String, enum: ['posted', 'cancelled'], default: 'posted' },
    notes: { type: String, trim: true, maxlength: 1000 },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, maxlength: 500 },
    lastEditedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastEditedAt: { type: Date },
    editReason: { type: String, trim: true, maxlength: 500 },
    editCount: { type: Number, default: 0 },
    lastEditFailedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

stockReceiptSchema.index({ documentNo: 1 }, { unique: true, sparse: true });
stockReceiptSchema.index({ warehouseId: 1, receiptDate: -1 });
stockReceiptSchema.index({ status: 1, receiptDate: -1 });
stockReceiptSchema.index({ 'products.productId': 1, receiptDate: -1 });
stockReceiptSchema.index({ isTrashed: 1, createdAt: -1 });
stockReceiptSchema.index({ isTrashed: 1, trashedAt: -1 });

export const StockReceiptModel = model<IStockReceipt>('StockReceipt', stockReceiptSchema);
