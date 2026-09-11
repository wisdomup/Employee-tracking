import { Types } from 'mongoose';
import { FinanceLockModel } from '../../models/finance-lock.model';
import { conflict } from '../../utils/app-error';

/**
 * Hold leases on a set of finance documents for the length of one operation.
 *
 * See `finance-lock.model.ts` for why these exist at all. The short version: idempotency keys
 * stop one request running twice; these stop two different requests spending the same money.
 */

/**
 * How long a lease lasts.
 *
 * Long enough for any single posting by a wide margin — they take milliseconds — and short
 * enough that a crash mid-post leaves the document blocked for about a minute rather than until
 * somebody notices.
 */
const LEASE_MS = 60_000;

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

/**
 * Run `fn` while holding every lease in `keys`, or refuse at once if any is already held.
 *
 * Refuses rather than waits. Waiting would need a retry loop and a timeout, and would turn a
 * rare collision into a slow request; refusing turns it into a message, and the person simply
 * presses the button again a moment later — by which time the other operation has finished and
 * the normal validation will say whether there is anything left to claim.
 *
 * Keys are taken in sorted order and released in `finally`, including when `fn` throws.
 */
export async function withFinanceLocks<T>(
  keys: string[],
  fn: () => Promise<T>,
  message = 'Somebody else is working on this right now. Try again in a moment.',
): Promise<T> {
  const holder = new Types.ObjectId().toHexString();
  const ordered = [...new Set(keys)].sort();
  const held: string[] = [];

  try {
    for (const key of ordered) {
      const now = new Date();
      try {
        /*
         * One atomic write. The filter matches only a lease that has expired — a live one held
         * by anybody else does not match, so the upsert tries to INSERT a second document with
         * the same `_id`, and the unique index refuses it. That refusal is the whole mechanism.
         */
        await FinanceLockModel.findOneAndUpdate(
          { _id: key, expiresAt: { $lt: now } },
          { $set: { holder, expiresAt: new Date(now.getTime() + LEASE_MS) } },
          { upsert: true, new: true },
        ).exec();
        held.push(key);
      } catch (err) {
        if (isDuplicateKey(err)) throw conflict(message);
        throw err;
      }
    }

    return await fn();
  } finally {
    if (held.length > 0) {
      // Scoped to this holder, so a lease that expired and was taken over by somebody else while
      // `fn` overran is left alone rather than pulled out from under them.
      await FinanceLockModel.deleteMany({ _id: { $in: held }, holder })
        .exec()
        .catch(() => undefined);
    }
  }
}
