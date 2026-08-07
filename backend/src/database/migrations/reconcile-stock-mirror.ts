/**
 * Stock integrity check and repair.
 *
 * Two equalities must hold at all times once the warehouse module is live:
 *   A. `Product.quantity === Σ WarehouseStock.sellable`   (the mirror)
 *   B. `WarehouseStock[bucket] === Σ StockMovement.delta`  (the ledger)
 *
 * A violation means some write path bypassed `stock-ledger.service.ts`. A is repairable — the
 * mirror is derived, so it can simply be recomputed. B is NOT auto-repaired: a balance that
 * disagrees with its own ledger is a real discrepancy that needs a human, and quietly overwriting
 * one of the two numbers would destroy the evidence.
 *
 * Run from backend/:
 *   npm run reconcile:stock              # report only
 *   npm run reconcile:stock -- --apply   # rebuild the mirror (A only)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { ProductModel } from '../../models/product.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { getIntegrityReport, resyncMirror } from '../../modules/warehouse/stock-ledger.service';

const APPLY = process.argv.includes('--apply');

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking';
  await mongoose.connect(uri);
  log(`Connected to MongoDB${APPLY ? '' : ' (report only — pass --apply to repair the mirror)'}`);

  const rows = await getIntegrityReport();
  const mirrorDrift = rows.filter((r) => r.kind === 'mirror_drift');
  const ledgerDrift = rows.filter((r) => r.kind === 'ledger_drift');

  log(`\nProducts: ${await ProductModel.countDocuments({})}`);
  log(`Balance rows: ${await WarehouseStockModel.countDocuments({})}`);
  log(`Ledger rows: ${await StockMovementModel.countDocuments({})}`);

  log(`\nA. mirror drift (Product.quantity vs Σ sellable): ${mirrorDrift.length}`);
  for (const row of mirrorDrift.slice(0, 25)) {
    log(`   ${row.productName ?? row.productId}: mirror ${row.actual} → should be ${row.expected}`);
  }
  if (mirrorDrift.length > 25) log(`   … and ${mirrorDrift.length - 25} more`);

  log(`\nB. ledger drift (balance vs Σ movements): ${ledgerDrift.length}`);
  for (const row of ledgerDrift.slice(0, 25)) {
    log(
      `   product ${row.productId} @ warehouse ${row.warehouseId} [${row.bucket}]: ` +
        `balance ${row.actual}, ledger says ${row.expected}`,
    );
  }
  if (ledgerDrift.length > 25) log(`   … and ${ledgerDrift.length - 25} more`);

  if (mirrorDrift.length === 0 && ledgerDrift.length === 0) {
    log('\nBoth integrity checks are clean.');
    return;
  }

  if (APPLY && mirrorDrift.length > 0) {
    const result = await resyncMirror(mirrorDrift.map((r) => r.productId));
    log(`\nMirror rebuilt for ${result.updated} product(s).`);
    const after = (await getIntegrityReport()).filter((r) => r.kind === 'mirror_drift');
    log(`Remaining mirror drift: ${after.length}`);
  } else if (mirrorDrift.length > 0) {
    log('\nRe-run with --apply to rebuild the mirror from the balance documents.');
  }

  if (ledgerDrift.length > 0) {
    log(
      '\nLedger drift is NOT repaired automatically. A balance that disagrees with its own ledger\n' +
        'means stock was written outside stock-ledger.service.ts — find that write path first.\n' +
        'Correct the stock with a Stock Count (which leaves an auditable adjustment) rather than\n' +
        'editing the balance by hand.',
    );
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
