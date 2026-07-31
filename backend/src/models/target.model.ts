import { Schema, model, Document, Types } from 'mongoose';

/**
 * A monthly performance target for one field-staff user.
 *
 * Keyed by `periodMonth` in `YYYY-MM` form, which matches the `%Y-%m` grouping the
 * analytics aggregations already use — so a target joins directly onto a monthly bucket
 * without any date maths.
 *
 * Note this is distinct from the legacy free-text `target` / `achivedTarget` strings on
 * the User document, which are decorative and not used in any calculation.
 */
export interface ITarget extends Document {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  /** Canonical month key, e.g. "2026-07". */
  periodMonth: string;
  /** Money target measured against delivered order value. */
  salesAmount?: number;
  /** Number of orders booked in the month. */
  orderCount?: number;
  /** Number of visits completed (checked in and checked out) in the month. */
  visitCount?: number;
  notes?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const targetSchema = new Schema<ITarget>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    periodMonth: {
      type: String,
      required: true,
      match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth must be in YYYY-MM format'],
    },
    salesAmount: { type: Number, min: 0 },
    orderCount: { type: Number, min: 0 },
    visitCount: { type: Number, min: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One target row per employee per month — the upsert key.
targetSchema.index({ employeeId: 1, periodMonth: 1 }, { unique: true });
// Listing every target for a given month (admin/manager overview).
targetSchema.index({ periodMonth: 1 });

export const TargetModel = model<ITarget>('Target', targetSchema);
