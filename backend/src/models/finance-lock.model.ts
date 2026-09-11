import { Schema, model } from 'mongoose';

/**
 * A short lease on one finance document, held while something that must not run twice at once
 * is running.
 *
 * ## Why this exists, in a codebase that deliberately has no transactions
 *
 * Almost everything in the finance module is made safe by idempotency keys: a retried posting
 * collides with itself and writes nothing. That covers the SAME request arriving twice. It does
 * not cover two DIFFERENT requests competing for the same limited thing — two bills both
 * claiming the last 5,000 of one goods receipt, or two payments both settling the same invoice.
 * Each passes its own validation because neither can see the other yet, and both post.
 *
 * A lease closes that gap without a transaction. Taking one is a single atomic write against a
 * unique `_id`, so exactly one caller can hold `receipt:<id>` at a time; the other gets a
 * duplicate-key error and is told to try again. Nobody waits, so nothing can deadlock.
 *
 * ## Why it expires
 *
 * A process that dies while holding a lease would otherwise lock that document forever. The
 * expiry is the recovery: an expired lease is simply taken over by the next caller. The TTL
 * index only tidies up afterwards — correctness never depends on when MongoDB gets round to it.
 */
export interface IFinanceLock {
  /** `bill:<id>`, `receipt:<id>`, `payment:<id>`. */
  _id: string;
  /** Unique per attempt, so a second attempt from the same user is refused rather than admitted. */
  holder: string;
  expiresAt: Date;
}

const financeLockSchema = new Schema<IFinanceLock>(
  {
    _id: { type: String, required: true },
    holder: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

financeLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FinanceLockModel = model<IFinanceLock>('FinanceLock', financeLockSchema);
