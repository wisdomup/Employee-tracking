import { Schema, model, Document, Types } from 'mongoose';

/**
 * A monetary fine raised against an employee, today only ever by the rider late-start rule.
 *
 * ## Why a document and not a number on the user
 *
 * A running `finesOwed` total on the user would answer "how much" and nothing else — not which
 * day, not why, not whether an admin already let one off. The first dispute ("I was on leave on
 * the 9th, why am I fined for it?") is unanswerable from a total. One row per offence keeps the
 * freeze, the flag and the money telling the same story.
 *
 * ## Why it is NOT a finance/accounting document
 *
 * A fine is deliberately kept out of the journal. It is a disciplinary record, not a posting: it
 * is not money that moved, and inventing an entry for it would put an unpaid, frequently waived
 * figure into the trial balance where it has to be reconciled by somebody. If fines are ever
 * recovered from pay, that recovery is a payroll deduction and is posted there, once, when it
 * actually happens.
 *
 * ## Idempotency
 *
 * `{ employeeId, type, fineDate }` is unique. Both freeze paths (the check-in guard and the daily
 * sweep) raise the fine, and the manual "Run late-start check now" button can fire the sweep any
 * number of times — a rider must be fined once for one day's offence however many times the rule
 * looks at them.
 */

/** Fine categories. Adding one is a product decision, not a config change. */
export const FINE_TYPES = ['late_start_freeze'] as const;
export type FineType = (typeof FINE_TYPES)[number];

/**
 * `outstanding` — owed. `waived` — an admin cancelled it; the row survives so the fact that a
 * fine was raised and forgiven is still readable. There is no `paid`: nothing here collects
 * money, and a status nobody can move a row into is a lie in the schema.
 */
export const FINE_STATUSES = ['outstanding', 'waived'] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];

/** How the fine came to be raised — the two automatic paths, or an admin by hand. */
export const FINE_SOURCES = ['check_in_guard', 'sweep', 'manual'] as const;
export type FineSource = (typeof FINE_SOURCES)[number];

export interface IRiderFine extends Document {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  type: FineType;
  /**
   * UTC midnight of the day the offence falls on — the same day boundary the freeze, the
   * `late_start` performance flag and the visit queries all use. Bucketing by local day here
   * would let a rider be fined twice for one day near the boundary.
   */
  fineDate: Date;
  amount: number;
  /** What the rider is told. Copied at the time so an env change cannot rewrite history. */
  reason: string;
  status: FineStatus;
  source: FineSource;

  /** Absent means the rule raised it automatically rather than an admin. */
  issuedBy?: Types.ObjectId;
  issuedAt: Date;

  waivedAt?: Date;
  waivedBy?: Types.ObjectId;
  waiveNote?: string;

  /**
   * The amount this fine was first raised at, kept when an admin re-prices it. Without it
   * "why is his fine 500 when the rule says 200" has no answer on the record.
   */
  originalAmount?: number;
  amountChangedAt?: Date;
  amountChangedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const riderFineSchema = new Schema<IRiderFine>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: FINE_TYPES, required: true },
    fineDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: FINE_STATUSES, default: 'outstanding' },
    source: { type: String, enum: FINE_SOURCES, default: 'sweep' },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    issuedAt: { type: Date, required: true },
    waivedAt: { type: Date },
    waivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    waiveNote: { type: String, trim: true, maxlength: 500 },
    originalAmount: { type: Number, min: 0 },
    amountChangedAt: { type: Date },
    amountChangedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/** One fine per rider per day per type — the whole idempotency story, enforced by the database. */
riderFineSchema.index({ employeeId: 1, type: 1, fineDate: 1 }, { unique: true });
/** The rider's own "what do I owe" banner, and the admin's per-rider history. */
riderFineSchema.index({ employeeId: 1, status: 1, fineDate: -1 });
/** The admin's day view: what was raised today, newest first. */
riderFineSchema.index({ fineDate: -1, status: 1 });

export const RiderFineModel = model<IRiderFine>('RiderFine', riderFineSchema);
