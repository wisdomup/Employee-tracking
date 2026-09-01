import { Schema, model, Document, Types } from 'mongoose';

export interface IOrderProduct {
  productId: Types.ObjectId;
  quantity: number;
  price: number;
  /** Flat discount (Rs.) taken off this line's `quantity * price` subtotal. */
  discount?: number;
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
  /**
   * The shop visit this order was punched during, set when the rider used "Order Lena" while
   * checked in at the store. Absent for orders raised from the normal Orders screen — which
   * is why the visit report reads a missing/empty link as "No Order" rather than as an error.
   */
  visitId?: Types.ObjectId;
  /** Warehouse the stock was taken from. Resolved from the salesman's city; admin-overridable. */
  warehouseId?: Types.ObjectId;
  /**
   * Where the order taker physically stood when they punched this order, captured by their
   * device at save time. Required for an `order_taker` punch — the location trail is the
   * point, so a punch with no fix is refused rather than stored blind. Optional for admin
   * back-office entry, which has no field position to record.
   */
  punchedLatitude?: number;
  punchedLongitude?: number;
  /**
   * The client's map pin SNAPSHOT, copied at punch time. A dealer can be re-pinned later; without
   * the snapshot every historical order's distance would silently restate itself the moment
   * someone corrects a shop's coordinates.
   */
  clientLatitudeAtPunch?: number;
  clientLongitudeAtPunch?: number;
  /**
   * Straight-line metres between the two points above, frozen at punch time. Absent when either
   * side had no coordinates — an unpinned client, or an admin-entered order.
   */
  punchDistanceMetres?: number;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  /** Admin (or actor) who approved the order; set when status becomes `approved` from `pending`. */
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  /**
   * Rider (`delivery_man`) who will deliver this order. Set by an admin at approve time or
   * reassigned later. The rider's own order list filters on this and nothing else — an order
   * with no rider is invisible to every rider.
   */
  assignedRiderId?: Types.ObjectId;
  assignedAt?: Date;
  /** Set by the assigned rider on `approved` -> `packed`. */
  packedAt?: Date;
  /** Set by the assigned rider on `packed` -> `delivered`, alongside the DeliveryCollection. */
  deliveredAt?: Date;
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
    discount: { type: Number, min: 0 },
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
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    punchedLatitude: { type: Number, min: -90, max: 90 },
    punchedLongitude: { type: Number, min: -180, max: 180 },
    clientLatitudeAtPunch: { type: Number, min: -90, max: 90 },
    clientLongitudeAtPunch: { type: Number, min: -180, max: 180 },
    punchDistanceMetres: { type: Number, min: 0 },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    assignedRiderId: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },
    packedAt: { type: Date },
    deliveredAt: { type: Date },
    termsAndConditions: { type: String },
  },
  { timestamps: true },
);

orderSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });

orderSchema.index({ dealerId: 1 });
orderSchema.index({ routeId: 1 });
// The visit report's "order taken during this visit?" lookup, batched over a page of visits.
// Sparse: only visit-linked orders carry the field, and they are the minority.
orderSchema.index({ visitId: 1 }, { sparse: true });
orderSchema.index({ createdBy: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ isTrashed: 1, createdAt: -1 });
orderSchema.index({ isTrashed: 1, trashedAt: -1 });
// Per-salesman sale over a date window — the shape every region-sales query uses.
orderSchema.index({ createdBy: 1, status: 1, createdAt: -1 });
// The rider's own delivery list — the hottest query in the collection module, hit on every
// pull-to-refresh of the rider's home screen.
orderSchema.index({ assignedRiderId: 1, status: 1, assignedAt: -1 });

export const OrderModel = model<IOrder>('Order', orderSchema);
