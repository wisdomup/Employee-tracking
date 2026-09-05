import { Schema, model, Document, Types } from 'mongoose';

/**
 * One night's proof that a control account still equals the operational records behind it.
 *
 * Kept as a record rather than a log line so drift has a first-seen date. "The receivable is out
 * by 4,300" is an argument; "it has been out by 4,300 since the 14th, and by nothing before
 * that" is a lead.
 */
export interface IControlReconciliation extends Document {
  _id: Types.ObjectId;
  /** `YYYY-MM-DD` in the report timezone. One row per check per day. */
  day: string;
  /** Stable id for the check, e.g. `ar-trade`. Survives renaming the account. */
  checkId: string;
  label: string;

  ledgerCode: string;
  ledgerBalance: number;
  operationalValue: number;
  drift: number;
  ok: boolean;

  /**
   * How the operational figure was arrived at, so a person can follow the arithmetic without
   * re-deriving it. A drift with no breakdown is a dead end.
   */
  breakdown: Record<string, number>;
  /** Set when the check knows why it differs and the difference is expected. */
  note?: string;

  createdAt: Date;
  updatedAt: Date;
}

const controlReconciliationSchema = new Schema<IControlReconciliation>(
  {
    day: { type: String, required: true },
    checkId: { type: String, required: true },
    label: { type: String, required: true },

    ledgerCode: { type: String, required: true },
    ledgerBalance: { type: Number, required: true },
    operationalValue: { type: Number, required: true },
    drift: { type: Number, required: true },
    ok: { type: Boolean, required: true },

    breakdown: { type: Schema.Types.Mixed, default: {} },
    note: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);

/** One result per check per day — a re-run replaces the day's row rather than appending. */
controlReconciliationSchema.index({ day: 1, checkId: 1 }, { unique: true });
controlReconciliationSchema.index({ checkId: 1, day: -1 });
controlReconciliationSchema.index({ ok: 1, day: -1 });

export const ControlReconciliationModel = model<IControlReconciliation>(
  'ControlReconciliation',
  controlReconciliationSchema,
);
