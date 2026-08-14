import { Schema, model, Document, Types } from 'mongoose';

/**
 * Recovery of OLD pending credit — spec §5. This is NOT a new sale: no order, no stock, no
 * invoice. It moves money into the rider's balance and reduces one dealer's outstanding credit
 * by the same amount.
 *
 * `dealerId` is required even though the spec calls this a "free-form entry". Without a real
 * customer link the second half of §5 — "the customer's pending credit reduces by the same
 * amount" — is not computable at all. The free-form part survives as `note`.
 */

export interface IRecoveryCorrection {
  at: Date;
  by: Types.ObjectId;
  from: { amount: number; mode: 'cash' | 'online' };
  to: { amount: number; mode: 'cash' | 'online' };
  reason?: string;
}

export interface ICreditRecovery extends Document {
  _id: Types.ObjectId;
  dealerId: Types.ObjectId;
  riderId: Types.ObjectId;
  /** Display label, original casing. Snapshot of the RIDER's city at entry time. */
  city: string;
  /** normalizeCityKey(city) — the only field city filters and $groups touch. */
  cityKey: string;
  amount: number;
  mode: 'cash' | 'online';
  note?: string;
  collectedAt: Date;
  createdBy: Types.ObjectId;
  corrections: IRecoveryCorrection[];
  lastCorrectedAt?: Date;
  lastCorrectedBy?: Types.ObjectId;
  voidedAt?: Date;
  voidedBy?: Types.ObjectId;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const recoveryAmountSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: ['cash', 'online'], required: true },
  },
  { _id: false },
);

const correctionSchema = new Schema<IRecoveryCorrection>(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    from: { type: recoveryAmountSchema, required: true },
    to: { type: recoveryAmountSchema, required: true },
    reason: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const creditRecoverySchema = new Schema<ICreditRecovery>(
  {
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer', required: true },
    riderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    city: { type: String, required: true },
    cityKey: { type: String, required: true },
    // min 0.01, not 0: a zero recovery is always a mistyped entry, and it pollutes the
    // entry-wise view that spec §9 puts in front of the admin every day.
    amount: { type: Number, required: true, min: 0.01 },
    mode: { type: String, enum: ['cash', 'online'], required: true },
    note: { type: String, maxlength: 500 },
    collectedAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    corrections: { type: [correctionSchema], default: [] },
    lastCorrectedAt: { type: Date },
    lastCorrectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidedAt: { type: Date },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidReason: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

// Rider balance + "today's recovery entries" on the activity view.
creditRecoverySchema.index({ riderId: 1, collectedAt: -1 });
// Per-dealer outstanding credit.
creditRecoverySchema.index({ dealerId: 1, collectedAt: -1 });
// City-filtered reporting.
creditRecoverySchema.index({ cityKey: 1, collectedAt: -1 });

export const CreditRecoveryModel = model<ICreditRecovery>('CreditRecovery', creditRecoverySchema);
