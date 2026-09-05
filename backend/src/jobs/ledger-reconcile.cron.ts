import cron from 'node-cron';
import {
  completeInterruptedPostings,
  reconcileLedgerBalances,
} from '../modules/finance/posting.service';
import { retryFailedPostings } from '../modules/finance/sales-posting.service';

/**
 * Nightly proof that every cached ledger balance still equals the lines it came from.
 *
 * The `reconcile-stock-mirror` analogue. `Ledger.cachedBalance` is a materialised convenience
 * over the `JournalLine` collection, exactly as `WarehouseStock` is over `StockMovement`, and a
 * materialised number that nothing checks is a number that quietly stops being true.
 *
 * Deliberately does NOT repair by default. Drift means something wrote to a balance outside the
 * posting service, and silently correcting it would hide the bug that caused it. The job reports;
 * an admin repairs from the account page or the reconcile endpoint once they know why.
 *
 * Env:
 *   LEDGER_RECONCILE_CRON            schedule, default '30 1 * * *' (01:30 local)
 *   LEDGER_RECONCILE_CRON_TIMEZONE   defaults to REPORT_TIMEZONE, then Asia/Karachi
 *   LEDGER_RECONCILE_ENABLED=false   turn it off
 */
export function startLedgerReconcileCron(): void {
  const enabled = (process.env.LEDGER_RECONCILE_ENABLED ?? 'true').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(enabled)) {
    console.log('[ledger-reconcile-cron] Disabled (LEDGER_RECONCILE_ENABLED=false)');
    return;
  }

  const expression = process.env.LEDGER_RECONCILE_CRON?.trim() || '30 1 * * *';
  const timezone = process.env.LEDGER_RECONCILE_CRON_TIMEZONE?.trim()
    || process.env.REPORT_TIMEZONE?.trim()
    || 'Asia/Karachi';

  cron.schedule(
    expression,
    async () => {
      try {
        // Finish anything left half-posted before measuring, or an interrupted entry reads as
        // drift when it is really just an unstamped header.
        const swept = await completeInterruptedPostings();
        if (swept.completed > 0) {
          console.log(`[ledger-reconcile-cron] Completed ${swept.completed} interrupted posting(s)`);
        }

        // Retry anything the operational modules could not post. Safe because every posting is
        // idempotent by key — a retry either writes the entry or finds it already written.
        const retried = await retryFailedPostings();
        if (retried.retried > 0) {
          console.log(
            `[ledger-reconcile-cron] Retried ${retried.retried} failed posting(s), `
              + `${retried.recovered} recovered`,
          );
        }

        const result = await reconcileLedgerBalances();

        if (result.drifted.length === 0) {
          console.log(`[ledger-reconcile-cron] ${result.checked} accounts checked, all agree`);
          return;
        }

        console.error(
          `[ledger-reconcile-cron] ${result.drifted.length} of ${result.checked} accounts have `
            + 'drifted from their posted lines. Something wrote a balance outside the posting '
            + 'service:\n'
            + result.drifted.map((d) => `  ${d.code} ${d.name}: ${d.drift}`).join('\n'),
        );
      } catch (err) {
        console.error('[ledger-reconcile-cron] Failed:', err);
      }
    },
    { timezone },
  );

  console.log(
    `[ledger-reconcile-cron] Scheduled "${expression}" (${timezone}) — proves every ledger `
      + 'balance against its posted lines',
  );
}
