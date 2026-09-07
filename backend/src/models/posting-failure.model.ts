import { Schema, model, Document, Types } from 'mongoose';

/**
 * An auto-posting that could not be written, kept so it can be retried.
 *
 * ## Why this exists rather than throwing
 *
 * The operational modules come first. A rider standing in a shop pressing Delivered must not be
 * refused because a ledger account was misconfigured in head office — the delivery is real
 * whether or not the books can record it yet, and refusing it would lose the sale AND the money.
 *
 * So every auto-posting is attempted, and a failure is recorded here instead of propagating.
 * Because postings are idempotent by key, a retry is always safe: it either writes the entry or
 * finds it already written.
 *
 * The nightly job retries these. Anything still failing after that is a real misconfiguration
 * and appears on the finance health screen, where somebody can see it — as against a silent
 * `catch {}`, which is how a month ends up short by an amount nobody can explain.
 */
export interface IPostingFailure extends Document {
  _id: Types.ObjectId;
  /** The idempotency key the posting would have used. Unique, so retries collapse. */
  idempotencyKey: string;
  event: string;
  sourceType: string;
  sourceId?: Types.ObjectId;
  sourceModel?: string;
  /** Enough to rebuild the attempt without re-reading half the app. */
  payload: Record<string, unknown>;
  lastError: string;
  attempts: number;
  lastAttemptAt: Date;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const postingFailureSchema = new Schema<IPostingFailure>(
  {
    idempotencyKey: { type: String, required: true },
    event: { type: String, required: true },
    sourceType: { type: String, required: true },
    sourceId: { type: Schema.Types.ObjectId },
    sourceModel: { type: String },
    payload: { type: Schema.Types.Mixed, default: {} },
    lastError: { type: String, required: true, maxlength: 2000 },
    attempts: { type: Number, default: 1 },
    lastAttemptAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

/** One record per failed posting. A repeated failure bumps `attempts` rather than piling up. */
postingFailureSchema.index({ idempotencyKey: 1 }, { unique: true });
postingFailureSchema.index({ resolvedAt: 1, lastAttemptAt: 1 });

export const PostingFailureModel = model<IPostingFailure>('PostingFailure', postingFailureSchema);
