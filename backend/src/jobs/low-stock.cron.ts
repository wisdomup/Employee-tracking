import cron, { type ScheduledTask } from 'node-cron';
import { getLowStockProducts } from '../modules/warehouse/warehouse-reports.service';
import { notifyLowStock } from '../modules/warehouse/warehouse-notifications';
import { getIntegrityReport } from '../modules/warehouse/stock-ledger.service';

/**
 * Daily stock watch: low-stock alerts (spec §10 and §13) plus a stock-integrity check.
 *
 * The integrity check is the important half. Two equalities must hold at all times —
 * `Product.quantity === Σ sellable` and `balance === Σ ledger` — and a violation means some write
 * path bypassed the stock ledger service. Catching that the morning after beats catching it in a
 * stock count three weeks later.
 *
 * Env-gated the same way as the visit cron, so it can be turned off per environment.
 */
function parseBoolEnv(value: string | undefined, defaultTrue: boolean): boolean {
  if (value === undefined || value === '') return defaultTrue;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

let task: ScheduledTask | undefined;

export async function runLowStockCheck(): Promise<{ lowCount: number; driftCount: number }> {
  const low = await getLowStockProducts();
  if (low.length > 0) {
    // The notification carries a per-day event key, so re-running the check does not re-spam.
    notifyLowStock(low);
  }

  const drift = await getIntegrityReport();
  if (drift.length > 0) {
    console.error(
      `STOCK INTEGRITY DRIFT: ${drift.length} row(s) disagree. Run "npm run reconcile:stock" to inspect.`,
      drift.slice(0, 10),
    );
  }

  return { lowCount: low.length, driftCount: drift.length };
}

export function startLowStockCron(): void {
  if (!parseBoolEnv(process.env.LOW_STOCK_CRON_ENABLED, true)) {
    console.log('Low-stock cron disabled (LOW_STOCK_CRON_ENABLED=false)');
    return;
  }

  const expression = process.env.LOW_STOCK_CRON_SCHEDULE?.trim() || '30 7 * * *';
  const timezone = process.env.LOW_STOCK_CRON_TIMEZONE?.trim()
    || process.env.REPORT_TIMEZONE?.trim()
    || 'Asia/Karachi';

  if (!cron.validate(expression)) {
    console.error(`Invalid LOW_STOCK_CRON_SCHEDULE "${expression}" — low-stock cron not started`);
    return;
  }

  task?.stop();
  task = cron.schedule(
    expression,
    () => {
      runLowStockCheck()
        .then(({ lowCount, driftCount }) => {
          console.log(`Low-stock check: ${lowCount} product(s) low, ${driftCount} drift row(s)`);
        })
        .catch((err) => console.error('Low-stock check failed:', err));
    },
    { timezone },
  );

  console.log(`Low-stock cron scheduled: "${expression}" (${timezone})`);
}
