import { Schema, model, Document, Types } from 'mongoose';

/**
 * A rider handing collected money back to the company — spec §6.
 *
 * ONE BALANCE RULE FOR BOTH MODES: a settlement reduces the rider's balance iff
 * `status === 'received'`. The spec's asymmetry (online = one step, cash = two) is expressed
 * entirely at CREATE time — an online settlement is born `received` with `autoReceived: true`,
 * a cash one is born `pending` and only an admin PATCH flips it. Encoding the asymmetry here
 * instead of in the balance aggregation keeps the money maths branch-free, which is the part
 * nobody will remember to update in six months.
 */

export interface ISettlementCorrection {
  at: Date;
  by: Types.ObjectId;
  from: { amount: number };
  to: { amount: number };
  reason?: string;
}

export interface ISettlement extends Document {
  _id: Types.ObjectId;
  riderId: Types.ObjectId;
  /** Display label, original casing. Snapshot of the RIDER's city at submit time. */
  city: string;
  /** normalizeCityKey(city) — the only field city filters and $groups touch. */
  cityKey: string;
  mode: 'cash' | 'online';
  /**
   * What this settlement IS.
   *
   * `handover` — the rider gave the money to the company. The normal case.
   * `writeoff`  — an admin cleared a confirmed shortfall the rider is not going to hand over.
   *
   * Recorded as a settlement rather than as its own document on purpose: a write-off reduces
   * what the rider owes in exactly the way a handover does, so the balance aggregation in
   * `collection-reports.service.ts` needs no change and cannot drift from it. Only the
   * accounting differs — a handover debits office cash, a write-off debits Cash Difference.
   */
  kind: 'handover' | 'writeoff';
  /** Required for a write-off. Nobody clears a shortfall without saying why. */
  writeoffReason?: string;
  amount: number;
  status: 'pending' | 'received';
  /** Optional proof for an online transfer. Rejected for `mode: 'cash'`. */
  screenshotUrl?: string;
  note?: string;
  submittedAt: Date;
  receivedBy?: Types.ObjectId;
  receivedAt?: Date;
  /** True when the system set `received` at submit (online). Separates it from a real admin click. */
  autoReceived: boolean;
  corrections: ISettlementCorrection[];
  lastCorrectedAt?: Date;
  lastCorrectedBy?: Types.ObjectId;
  voidedAt?: Date;
  voidedBy?: Types.ObjectId;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const settlementAmountSchema = new Schema(
  { amount: { type: Number, required: true, min: 0 } },
  { _id: false },
);

const correctionSchema = new Schema<ISettlementCorrection>(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    from: { type: settlementAmountSchema, required: true },
    to: { type: settlementAmountSchema, required: true },
    reason: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const settlementSchema = new Schema<ISettlement>(
  {
    riderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    city: { type: String, required: true },
    cityKey: { type: String, required: true },
    mode: { type: String, enum: ['cash', 'online'], required: true },
    kind: { type: String, enum: ['handover', 'writeoff'], default: 'handover' },
    writeoffReason: { type: String, maxlength: 500 },
    amount: { type: Number, required: true, min: 0.01 },
    status: { type: String, enum: ['pending', 'received'], default: 'pending' },
    screenshotUrl: { type: String },
    note: { type: String, maxlength: 500 },
    submittedAt: { type: Date, required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    receivedAt: { type: Date },
    autoReceived: { type: Boolean, default: false },
    corrections: { type: [correctionSchema], default: [] },
    lastCorrectedAt: { type: Date },
    lastCorrectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidedAt: { type: Date },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidReason: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

// The balance pipeline and the `availableToSettle` ceiling both read this exact shape.
settlementSchema.index({ riderId: 1, mode: 1, status: 1 });
// The admin's "pending cash receipts" queue.
settlementSchema.index({ status: 1, submittedAt: -1 });
// City-filtered reporting.
settlementSchema.index({ cityKey: 1, submittedAt: -1 });

export const SettlementModel = model<ISettlement>('Settlement', settlementSchema);
