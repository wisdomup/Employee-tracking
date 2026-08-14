import { Schema, model, Document, Types } from 'mongoose';

/**
 * What a rider actually collected against ONE delivered order, split three ways.
 *
 * Named `DeliveryCollection` rather than `Collection` on purpose: `Collection` is Mongo's own
 * word for a table, and a model by that name reads as a bug in every stack trace and in
 * `mongoose.models`. The API path and the UI both still say "collection".
 *
 * THIS DOC IS AUTHORITATIVE for the split. `Order.paidAmount` / `Order.paymentType` are also
 * written on delivery, but only so the pre-existing analytics KPIs keep working — they cannot
 * represent a three-way split and are lossy by construction.
 */

/** One correction an admin made to this entry. Spec §7: original + corrected + who + when. */
export interface ICollectionCorrection {
  at: Date;
  by: Types.ObjectId;
  from: { cash: number; online: number; credit: number };
  to: { cash: number; online: number; credit: number };
  reason?: string;
}

export interface IDeliveryCollection extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  /** Snapshot of the order's sequential invoice number — the report's "Order #" column. */
  invoiceNumber?: number;
  dealerId: Types.ObjectId;
  riderId: Types.ObjectId;
  /** Display label, original casing. Snapshot of the RIDER's city at delivery time. */
  city: string;
  /** normalizeCityKey(city). Every city filter and every city $group uses THIS, never `city`. */
  cityKey: string;
  /** Snapshot of the DEALER's city key, so a cross-city entry is provable, not just asserted. */
  dealerCityKey: string;
  /** Snapshot of order.grandTotal at delivery. cash + online + credit must equal this. */
  orderAmount: number;
  cash: number;
  online: number;
  credit: number;
  note?: string;
  deliveredAt: Date;
  /** Who submitted it. Equals `riderId` today; separate so an admin backfill stays distinguishable. */
  createdBy: Types.ObjectId;
  corrections: ICollectionCorrection[];
  lastCorrectedAt?: Date;
  lastCorrectedBy?: Types.ObjectId;
  voidedAt?: Date;
  voidedBy?: Types.ObjectId;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const splitSchema = new Schema(
  {
    cash: { type: Number, required: true, min: 0 },
    online: { type: Number, required: true, min: 0 },
    credit: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const correctionSchema = new Schema<ICollectionCorrection>(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    from: { type: splitSchema, required: true },
    to: { type: splitSchema, required: true },
    reason: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const deliveryCollectionSchema = new Schema<IDeliveryCollection>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    invoiceNumber: { type: Number, min: 1 },
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer', required: true },
    riderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    city: { type: String, required: true },
    cityKey: { type: String, required: true },
    dealerCityKey: { type: String, default: '' },
    orderAmount: { type: Number, required: true, min: 0 },
    cash: { type: Number, required: true, min: 0, default: 0 },
    online: { type: Number, required: true, min: 0, default: 0 },
    credit: { type: Number, required: true, min: 0, default: 0 },
    note: { type: String, maxlength: 500 },
    deliveredAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // The DURABLE audit trail. ActivityLog is written too, but `logActivityAsync` is
    // fire-and-forget and swallows its own errors, so it cannot be the only record of a
    // money correction.
    corrections: { type: [correctionSchema], default: [] },
    lastCorrectedAt: { type: Date },
    lastCorrectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Void is the only way to unwind a mistaken delivery: a correction must keep
    // cash+online+credit === orderAmount, so it can never zero an entry.
    voidedAt: { type: Date },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidReason: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

// One collection per order — also the idempotency backstop when a rider double-taps Delivered
// and the status CAS has already been won by the first request.
deliveryCollectionSchema.index({ orderId: 1 }, { unique: true });
// Report: city filter over a date window.
deliveryCollectionSchema.index({ cityKey: 1, deliveredAt: -1 });
// Rider filter, today's activity, and the cash-in-hand balance.
deliveryCollectionSchema.index({ riderId: 1, deliveredAt: -1 });
// Per-dealer outstanding credit and the shop's collection history.
deliveryCollectionSchema.index({ dealerId: 1, deliveredAt: -1 });
// Unfiltered report / grand total / day-end.
deliveryCollectionSchema.index({ deliveredAt: -1 });

export const DeliveryCollectionModel = model<IDeliveryCollection>(
  'DeliveryCollection',
  deliveryCollectionSchema,
);
