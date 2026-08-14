import { Schema, model, Document, Types } from 'mongoose';

export interface IProduct extends Document {
  _id: Types.ObjectId;
  barcode: string;
  name: string;
  description?: string;
  image?: string;
  salePrice?: number;
  /**
   * Running WEIGHTED-AVERAGE cost per piece across all warehouses, maintained by Stock In
   * (`recomputeProductCost`). Still the cost basis for the P&L report, and still admin-only in
   * API responses. An admin may override it to correct a bad average; the next receipt wins.
   */
  purchasePrice?: number;
  onlinePrice?: number;
  /**
   * DERIVED MIRROR of total sellable stock = Σ `WarehouseStock.sellable` across all warehouses.
   * Never write this directly — only `stock-ledger.service.ts#syncProductQuantityMirror` may.
   * It exists so every pre-warehouse reader (order stock checks, stock-reports, the products
   * list, the dashboard) keeps working unchanged.
   */
  quantity?: number;
  /**
   * DERIVED MIRROR of total DAMAGED / claim stock = Σ `WarehouseStock.damaged` across all
   * warehouses. Same rule as `quantity` — never write this directly, only
   * `stock-ledger.service.ts#syncProductQuantityMirror` may.
   *
   * It exists so a list screen can show "on hand" (sellable + damaged) without a per-row
   * aggregate. Deliberately SEPARATE from `quantity` rather than folded into it: order
   * availability checks and the low-stock alerts count sellable pieces only, and damaged pieces
   * are by definition not for sale. Do not add this into any availability calculation.
   */
  damagedQuantity?: number;
  /** Admin-set low-stock threshold, compared against the all-warehouse total. */
  survivalQuantity?: number;
  /** Rate on the most recent live Stock In. Shown as a reference when entering a new rate. */
  lastPurchaseRate?: number;
  categoryId: Types.ObjectId;
  createdBy: Types.ObjectId;
  extras?: Record<string, string>;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    barcode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    image: { type: String },
    salePrice: { type: Number, min: 0 },
    purchasePrice: { type: Number, min: 0 },
    onlinePrice: { type: Number, min: 0 },
    quantity: { type: Number, min: 0 },
    // No `default: 0`, matching `quantity` — a product with no stock simply has no field, which
    // every reader treats as zero. `min: 0` documents intent; the mirror writer clamps, because
    // `updateOne` does not run validators but `save()` does, and a negative mirror would make the
    // product permanently uneditable.
    damagedQuantity: { type: Number, min: 0 },
    survivalQuantity: { type: Number, min: 0 },
    lastPurchaseRate: { type: Number, min: 0 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    extras: { type: Schema.Types.Mixed },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

productSchema.index({ name: 1 });
productSchema.index({ categoryId: 1 });
productSchema.index({ createdBy: 1 });
productSchema.index({ isTrashed: 1, createdAt: -1 });
productSchema.index({ isTrashed: 1, trashedAt: -1 });

export const ProductModel = model<IProduct>('Product', productSchema);
