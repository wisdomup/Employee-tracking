import { Schema, model, Document, Types } from 'mongoose';

/**
 * Damaged / claimed stock (spec §7). Two kinds:
 *   • `internal_damage` — happened inside the warehouse, no client involved.
 *   • `client_claim`    — a customer returned a damaged or faulty item; the client is recorded.
 *
 * A new model rather than a reuse of `Return`: internal damage has no dealer, and `Return.dealerId`
 * is required. `Return` stays the client-facing document; this is the warehouse-side write-off.
 *
 * Creating an entry moves NO stock. Only an admin approval moves pieces from Sellable to
 * Damaged/Claim; a rejection changes nothing at all.
 */
export type DamageClaimSource = 'internal_damage' | 'client_claim';

export interface IDamageClaimLine {
  productId: Types.ObjectId;
  quantity: number;
}

export interface IDamageClaim extends Document {
  _id: Types.ObjectId;
  documentNo?: number;
  warehouseId: Types.ObjectId;
  products: IDamageClaimLine[];
  source: DamageClaimSource;
  /** Required when `source === 'client_claim'` — the damage report is useless without it. */
  clientName?: string;
  dealerId?: Types.ObjectId;
  /** Set when this entry was raised automatically by a completed damage-type Return. */
  linkedReturnId?: Types.ObjectId;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
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

const damageClaimLineSchema = new Schema<IDamageClaimLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const damageClaimSchema = new Schema<IDamageClaim>(
  {
    documentNo: { type: Number, min: 1 },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    products: { type: [damageClaimLineSchema], required: true },
    source: { type: String, enum: ['internal_damage', 'client_claim'], required: true },
    clientName: { type: String, trim: true, maxlength: 200 },
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer' },
    linkedReturnId: { type: Schema.Types.ObjectId, ref: 'Return' },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
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

damageClaimSchema.index({ documentNo: 1 }, { unique: true, sparse: true });
damageClaimSchema.index({ warehouseId: 1, status: 1, createdAt: -1 });
damageClaimSchema.index({ status: 1, createdAt: -1 });
damageClaimSchema.index({ 'products.productId': 1 });
damageClaimSchema.index({ linkedReturnId: 1 }, { sparse: true });
damageClaimSchema.index({ isTrashed: 1, createdAt: -1 });
damageClaimSchema.index({ isTrashed: 1, trashedAt: -1 });

export const DamageClaimModel = model<IDamageClaim>('DamageClaim', damageClaimSchema);
