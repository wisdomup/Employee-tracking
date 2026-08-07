import {
  runWarehouseBootstrap,
  BootstrapStatus,
} from './migrations/warehouse-stock-bootstrap';

/**
 * Run the warehouse bootstrap as part of server startup, before the HTTP port is bound.
 *
 * Why here rather than as a deploy step: the migration snapshots `Product.quantity` into
 * per-warehouse balances and then rebuilds the mirror from those balances. If the previous build
 * were still serving orders while that happened, a decrement landing between the snapshot and the
 * rebuild would be overwritten — stock would silently inflate, and the integrity check would still
 * report zero because the mirror and the balances agree with each other. Running inside `bootstrap()`
 * means pm2 has already stopped the old process, so nothing is writing.
 *
 * After the first successful run this costs one indexed `countDocuments` per boot and returns.
 *
 * Env:
 *   WAREHOUSE_BOOTSTRAP_ON_START=false   skip entirely (the CLI migration still works)
 *   MAIN_WAREHOUSE_NAME / MAIN_WAREHOUSE_CITY   seed values for the Main warehouse
 */
function parseBoolEnv(value: string | undefined, defaultTrue: boolean): boolean {
  if (value === undefined || value === '') return defaultTrue;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

export async function runWarehouseBootstrapOnStart(): Promise<void> {
  if (!parseBoolEnv(process.env.WAREHOUSE_BOOTSTRAP_ON_START, true)) {
    console.log('Warehouse bootstrap skipped (WAREHOUSE_BOOTSTRAP_ON_START=false)');
    return;
  }

  try {
    const status: BootstrapStatus = await runWarehouseBootstrap({
      apply: true,
      // Never rewrite user records on a restart — assigning staff to warehouses is a deliberate
      // admin action, not something a boot sequence should decide.
      assignUsers: false,
      skipIfDone: true,
    });

    if (status === 'already-bootstrapped') return;
    console.log(`Warehouse bootstrap: ${status}`);
  } catch (err) {
    // Deliberately not fatal. A failure here breaks order creation (no Main warehouse to draw
    // stock from) but everything else — attendance, visits, tasks, dealers — still works, and a
    // restart loop would take the whole API down instead of one feature. The error is loud enough
    // to find, and `npm run migrate:warehouse-bootstrap` will report the same fault in detail.
    console.error(
      'WAREHOUSE BOOTSTRAP FAILED — order creation will fail until this is resolved.\n' +
        'Run "npm run migrate:warehouse-bootstrap" for the full report.',
      err,
    );
  }
}
