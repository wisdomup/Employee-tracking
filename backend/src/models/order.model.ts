import { Schema, model, Document, Types } from 'mongoose';

export interface IOrderProduct {
  productId: Types.ObjectId;
  quantity: number;
  price: number;
  /**
   * Cost per piece SNAPSHOT, taken when the stock actually moved. Without it the P&L report
   * multiplies by the live `Product.purchasePrice`, which now shifts on every goods receipt —
   * so a closed period would silently restate itself every time stock came in.
   */
  unitCost?: number;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  /** Sequential sale invoice number (assigned server-side). */
  invoiceNumber?: number;
  products: IOrderProduct[];
  totalPrice?: number;
  discount?: number;
  grandTotal?: number;
  paidAmount?: number;
  description?: string;
  status: 'pending' | 'approved' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  paymentType?: 'online' | 'adjustment' | 'cash' | 'credit';
  orderDate?: Date;
  deliveryDate?: Date;
  dealerId: Types.ObjectId;
  routeId?: Types.ObjectId;
  /** Warehouse the stock was taken from. Resolved from the salesman's city; admin-overridable. */
  warehouseId?: Types.ObjectId;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  /** Admin (or actor) who approved the order; set when status becomes `approved` from `pending`. */
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  /** Sanitized HTML for invoice terms; admin-only writes. */
  termsAndConditions?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderProductSchema = new Schema<IOrderProduct>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    unitCost: { type: Number, min: 0 },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    invoiceNumber: { type: Number, min: 1 },
    products: { type: [orderProductSchema], required: true },
    totalPrice: { type: Number },
    discount: { type: Number },
    grandTotal: { type: Number },
    paidAmount: { type: Number },
    description: { type: String },
    status: {
      type: String,
      enum: ['pending', 'approved', 'packed', 'dispatched', 'delivered', 'cancelled'],
      default: 'pending',
    },
    paymentType: { type: String, enum: ['online', 'adjustment', 'cash', 'credit'] },
    orderDate: { type: Date },
    deliveryDate: { type: Date },
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer', required: true },
    routeId: { type: Schema.Types.ObjectId, ref: 'Route' },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    termsAndConditions: { type: String },
  },
  { timestamps: true },
);

orderSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });

orderSchema.index({ dealerId: 1 });
orderSchema.index({ routeId: 1 });
orderSchema.index({ createdBy: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ isTrashed: 1, createdAt: -1 });
orderSchema.index({ isTrashed: 1, trashedAt: -1 });
// Per-salesman sale over a date window — the shape every region-sales query uses.
orderSchema.index({ createdBy: 1, status: 1, createdAt: -1 });

export const OrderModel = model<IOrder>('Order', orderSchema);
