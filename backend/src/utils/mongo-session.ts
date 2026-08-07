import mongoose, { ClientSession } from 'mongoose';

/**
 * Opportunistic transaction support.
 *
 * Production runs on Atlas (a replica set), where multi-document transactions work. But dev
 * boxes and `mongodb-memory-server` are standalone nodes, where `startSession().withTransaction`
 * throws `IllegalOperation`. So transactions here are a bonus, never load-bearing:
 * `applyStockMovements` is correct in both modes because every apply is idempotent by key and
 * compensates its own partial work.
 *
 * Do not add code that only works inside a transaction — it will be untestable.
 */
let cachedSupport: boolean | undefined;

/** True when the connected deployment can open a transaction (replica set or mongos). */
export async function supportsTransactions(): Promise<boolean> {
  if (cachedSupport !== undefined) return cachedSupport;
  try {
    const db = mongoose.connection.db;
    if (!db) {
      cachedSupport = false;
      return cachedSupport;
    }
    const hello = (await db.admin().command({ hello: 1 })) as { setName?: string; msg?: string };
    cachedSupport = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

/** Test-only: forget the cached probe result (the connection changes between test files). */
export function resetTransactionSupportCache(): void {
  cachedSupport = undefined;
}

/**
 * Run `fn` inside a transaction when the deployment allows one, otherwise run it plainly.
 * `fn` receives the session (or `undefined`) and must thread it through every write it makes.
 */
export async function withOptionalTransaction<T>(
  fn: (session?: ClientSession) => Promise<T>,
): Promise<T> {
  if (!(await supportsTransactions())) {
    return fn(undefined);
  }

  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } catch (err) {
    // A deployment can lose transaction capability (failover to standalone, permissions).
    // Rather than fail the write outright, fall back to the compensating path once.
    if (isTransactionUnsupportedError(err)) {
      cachedSupport = false;
      return fn(undefined);
    }
    throw err;
  } finally {
    await session.endSession().catch(() => undefined);
  }
}

function isTransactionUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /transaction numbers are only allowed|Transactions are not supported|IllegalOperation/i.test(
    message,
  );
}
