/**
 * Bootstrap the warehouse module against existing data.
 *
 * Before this runs, all stock in the system is a single number per product (`Product.quantity`).
 * After it runs, that number is a DERIVED MIRROR of per-warehouse balances, and every product's
 * current stock sits in a Main warehouse with a matching opening ledger entry.
 *
 * Fully idempotent — safe to re-run. The unique `idempotencyKey` on the opening movements and
 * `$setOnInsert` on the balance documents mean a second run applies nothing.
 *
 * Run from backend/:
 *   npm run migrate:warehouse-bootstrap              # dry run — reports, changes nothing
 *   npm run migrate:warehouse-bootstrap -- --apply   # actually write
 *   npm run migrate:warehouse-bootstrap -- --apply --assign-users
 *
 * TAKE A DATABASE SNAPSHOT FIRST. The migration is re-runnable but not undoable: the opening
 * movements it writes are the audit trail, and deleting them later is worse than keeping them.
 */
import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import { ProductModel } from '../../models/product.model';
import { OrderModel } from '../../models/order.model';
import { ReturnModel } from '../../models/return.model';
import { UserModel } from '../../models/user.model';
import { CounterModel } from '../../models/counter.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockMovementModel } from '../../models/stock-movement.model';
import { WAREHOUSE_DOCUMENT_KINDS } from '../../modules/warehouse/warehouse-counters';
import { syncProductQuantityMirror } from '../../modules/warehouse/stock-ledger.service';
import { normalizeCityKey } from '../../modules/region-sales/region-sales.rules';
import { ROLES } from '../../constants/global';

const APPLY = process.argv.includes('--apply');
const ASSIGN_USERS = process.argv.includes('--assign-users');
const FORCE = process.argv.includes('--force');

const MAIN_NAME = process.env.MAIN_WAREHOUSE_NAME || 'Main Warehouse';
const MAIN_CITY = process.env.MAIN_WAREHOUSE_CITY || '';

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

/**
 * Pre-flight census. Every row here is a decision the migration has to make, so it is printed
 * before anything is written and the operator gets to see it in a dry run first.
 */
async function census() {
  const [
    totalProducts,
    trashedProducts,
    nullQty,
    negativeQty,
    fractionalQty,
    noPurchasePrice,
    openOrders,
    openReturns,
    damageReturns,
    existingBalances,
    existingMovements,
  ] = await Promise.all([
    ProductModel.countDocuments({}),
    ProductModel.countDocuments({ isTrashed: true }),
    ProductModel.countDocuments({ $or: [{ quantity: { $exists: false } }, { quantity: null }] }),
    ProductModel.countDocuments({ quantity: { $lt: 0 } }),
    ProductModel.countDocuments({ $expr: { $ne: ['$quantity', { $trunc: '$quantity' }] } }),
    ProductModel.countDocuments({
      $or: [{ purchasePrice: { $exists: false } }, { purchasePrice: null }, { purchasePrice: 0 }],
    }),
    OrderModel.countDocuments({
      isTrashed: { $ne: true },
      status: { $in: ['pending', 'approved', 'packed', 'dispatched'] },
    }),
    ReturnModel.countDocuments({
      isTrashed: { $ne: true },
      returnType: 'return',
      status: { $ne: 'completed' },
    }),
    ReturnModel.countDocuments({ isTrashed: { $ne: true }, returnType: 'damage' }),
    WarehouseStockModel.countDocuments({}),
    StockMovementModel.countDocuments({}),
  ]);

  log('\n--- Pre-flight census -------------------------------------------------');
  log(`Products total ................................ ${totalProducts}`);
  log(`  of which trashed (stock still migrated) ..... ${trashedProducts}`);
  log(`  quantity null/absent   → treated as 0 ....... ${nullQty}`);
  log(`  quantity NEGATIVE      → clamped to 0 ....... ${negativeQty}`);
  log(`  quantity fractional    → truncated .......... ${fractionalQty}`);
  log(`  no purchase price      → cost basis unknown . ${noPurchasePrice}`);
  log(`Open orders (stock ALREADY consumed) .......... ${openOrders}`);
  log(`Returns awaiting completion ................... ${openReturns}`);
  log(`Damage-type returns (NOT migrated, see below) .. ${damageReturns}`);
  log(`Existing warehouse balance rows ................ ${existingBalances}`);
  log(`Existing stock movements ....................... ${existingMovements}`);
  log('-----------------------------------------------------------------------\n');

  if (negativeQty > 0) {
    log(
      `!! ${negativeQty} product(s) already have NEGATIVE stock. They will be clamped to 0 and the\n` +
        '   shortfall recorded as an auditable manual_adjustment movement, so the loss is visible\n' +
        '   rather than silently absorbed.\n',
    );
  }

  log(
    'Rules this migration applies:\n' +
      '  • Main.sellable = max(0, trunc(Product.quantity)) — the POST-decrement figure, so the\n' +
      '    open orders above are treated as already consumed. They are stamped with the Main\n' +
      '    warehouse and write NO movement; only orders created after the Phase 3 cutover do.\n' +
      '  • Damage-type returns are NOT backfilled into the damaged bucket. They have never touched\n' +
      '    Product.quantity (returns.service.ts credits `return` only), so those pieces do not\n' +
      '    exist in stock — creating them would invent inventory. They stay as report history.\n' +
      '  • purchasePrice is NOT rewritten. It is the live COGS basis for the P&L report and\n' +
      '    retro-editing it would change every historical figure.\n',
  );

  return { totalProducts, negativeQty };
}

/** Both invariants that must hold once the module is live. Printed after the run. */
async function verify() {
  const mirrorDrift = await WarehouseStockModel.aggregate([
    { $group: { _id: '$productId', sellable: { $sum: '$sellable' } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $match: { $expr: { $ne: ['$sellable', { $ifNull: ['$product.quantity', 0] }] } } },
    { $project: { name: '$product.name', sellable: 1, mirror: { $ifNull: ['$product.quantity', 0] } } },
  ]);

  const ledgerTotals = await StockMovementModel.aggregate([
    {
      $group: {
        _id: { warehouseId: '$warehouseId', productId: '$productId', bucket: '$bucket' },
        net: { $sum: '$delta' },
      },
    },
  ]);
  const balances = await WarehouseStockModel.find({}).lean();
  const balanceMap = new Map<string, Record<string, number>>();
  for (const b of balances) {
    balanceMap.set(`${String(b.warehouseId)}:${String(b.productId)}`, {
      sellable: b.sellable,
      damaged: b.damaged,
      in_transit: b.inTransit,
    });
  }
  const ledgerDrift = ledgerTotals.filter((row) => {
    const key = `${String(row._id.warehouseId)}:${String(row._id.productId)}`;
    return (balanceMap.get(key)?.[row._id.bucket] ?? 0) !== row.net;
  });

  log('\n--- Verification ------------------------------------------------------');
  log(`A. mirror vs Σ balances  — drift rows: ${mirrorDrift.length} (must be 0)`);
  if (mirrorDrift.length > 0) log(mirrorDrift.slice(0, 10));
  log(`B. balances vs Σ ledger  — drift rows: ${ledgerDrift.length} (must be 0)`);
  if (ledgerDrift.length > 0) log(ledgerDrift.slice(0, 10));
  log('-----------------------------------------------------------------------\n');

  return mirrorDrift.length === 0 && ledgerDrift.length === 0;
}

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking';
  await mongoose.connect(uri);
  log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — nothing will be written)'}`);

  const { negativeQty } = await census();

  if (!APPLY) {
    log('Dry run complete. Re-run with --apply to write these changes.');
    return;
  }

  const alreadyBootstrapped = await StockMovementModel.countDocuments({
    idempotencyKey: { $regex: '^bootstrap:' },
  });
  if (alreadyBootstrapped > 0 && !FORCE) {
    log(
      `Bootstrap has already run (${alreadyBootstrapped} opening movements found). Re-running is\n` +
        'safe and will only fill gaps. Pass --force to acknowledge and continue.',
    );
    return;
  }

  // 1. Indexes FIRST. The unique guards (one Main, one balance row per warehouse+product, one
  //    movement per idempotency key) must exist before any traffic, not whenever autoIndex runs.
  log('Syncing indexes on the new collections...');
  await Promise.all([
    WarehouseModel.syncIndexes(),
    WarehouseStockModel.syncIndexes(),
    StockMovementModel.syncIndexes(),
  ]);

  // 2. The Main warehouse. Upserted, never created — `create()` on a re-run makes a second one.
  const main = await WarehouseModel.findOneAndUpdate(
    { isMain: true },
    {
      $setOnInsert: {
        name: MAIN_NAME,
        city: MAIN_CITY,
        cityKey: normalizeCityKey(MAIN_CITY),
        isMain: true,
        isActive: true,
      },
    },
    { upsert: true, new: true },
  );
  log(`Main warehouse: "${main.name}" (${String(main._id)})`);

  const actor = await UserModel.findOne({ role: ROLES.ADMIN, isTrashed: { $ne: true } })
    .select('_id')
    .lean();

  // 3 + 4. Seed a balance row and an opening movement per product — including trashed ones, whose
  // stock comes back if the product is restored.
  const products = await ProductModel.find({})
    .select('_id name quantity purchasePrice lastPurchaseRate isTrashed')
    .lean();

  let balancesCreated = 0;
  let balancesSkipped = 0;
  let movementsWritten = 0;
  let clamped = 0;

  for (const product of products) {
    const raw = typeof product.quantity === 'number' && Number.isFinite(product.quantity)
      ? product.quantity
      : 0;
    const opening = Math.max(0, Math.trunc(raw));
    const wasClamped = raw !== opening;

    const result = await WarehouseStockModel.updateOne(
      { warehouseId: main._id, productId: product._id },
      {
        // `$setOnInsert` so a re-run can never clobber balances that real movements have changed.
        $setOnInsert: {
          warehouseId: main._id,
          productId: product._id,
          sellable: opening,
          damaged: 0,
          inTransit: 0,
          lastMovementAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) balancesCreated += 1;
    else balancesSkipped += 1;

    if (opening > 0) {
      try {
        await StockMovementModel.create({
          warehouseId: main._id,
          productId: product._id,
          bucket: 'sellable',
          delta: opening,
          balanceAfter: opening,
          type: 'opening_stock',
          refType: 'opening_stock',
          refId: main._id,
          refLine: 0,
          // Seeds the weighted-average cost. Products with no purchase price contribute nothing,
          // which is honest: their cost basis is genuinely unknown.
          ...(product.purchasePrice ? { unitCost: product.purchasePrice } : {}),
          reason: 'Warehouse module bootstrap — existing stock on hand',
          ...(actor ? { actorId: actor._id } : {}),
          occurredAt: new Date(),
          idempotencyKey: `bootstrap:${String(product._id)}`,
        });
        movementsWritten += 1;
      } catch (err) {
        // 11000 = this product was already bootstrapped. That is the idempotency guarantee.
        if (!(err && typeof err === 'object' && (err as { code?: number }).code === 11000)) throw err;
      }
    }

    if (wasClamped) {
      clamped += 1;
      try {
        await StockMovementModel.create({
          warehouseId: main._id,
          productId: product._id,
          bucket: 'sellable',
          delta: 0,
          balanceAfter: opening,
          type: 'manual_adjustment',
          refType: 'adjustment',
          refId: main._id,
          reason: `Bootstrap clamp: source quantity was ${raw}, recorded as ${opening}`,
          ...(actor ? { actorId: actor._id } : {}),
          occurredAt: new Date(),
          idempotencyKey: `bootstrap-clamp:${String(product._id)}`,
        });
      } catch (err) {
        if (!(err && typeof err === 'object' && (err as { code?: number }).code === 11000)) throw err;
      }
    }
  }

  log(`Balance rows created: ${balancesCreated}, already present: ${balancesSkipped}`);
  log(`Opening movements written: ${movementsWritten}`);
  if (clamped > 0) log(`Clamped/truncated quantities recorded as adjustments: ${clamped}`);

  // Rebuild the mirror from the balances for EVERY product, rather than patching the null and
  // negative cases. Patching leaves a fractional source quantity (10.7) sitting in the mirror while
  // the balance holds 10 — drift on day one, from the very script meant to establish the invariant.
  await syncProductQuantityMirror(products.map((p) => String(p._id)));
  log(`Mirror rebuilt from the balances for ${products.length} product(s)`);

  // 5. `lastPurchaseRate` reference. Seeded from purchasePrice; NOT the other way round.
  const rateResult = await ProductModel.updateMany({ lastPurchaseRate: { $exists: false } }, [
    { $set: { lastPurchaseRate: { $ifNull: ['$purchasePrice', 0] } } },
  ]);
  log(`lastPurchaseRate seeded on ${rateResult.modifiedCount} product(s)`);

  // 6. Document counters, so the first receipt is #1 rather than an accident.
  for (const kind of WAREHOUSE_DOCUMENT_KINDS) {
    await CounterModel.updateOne({ _id: kind }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  }
  log(`Document counters seeded: ${WAREHOUSE_DOCUMENT_KINDS.join(', ')}`);

  // Stamp existing open orders with the Main warehouse. No movement is written — their stock was
  // consumed under the old global model and is already reflected in the opening balance.
  const stamped = await OrderModel.updateMany(
    { warehouseId: { $exists: false }, isTrashed: { $ne: true } },
    { $set: { warehouseId: main._id } },
  );
  log(`Existing orders stamped with the Main warehouse: ${stamped.modifiedCount}`);

  const stampedReturns = await ReturnModel.updateMany(
    { warehouseId: { $exists: false }, isTrashed: { $ne: true } },
    { $set: { warehouseId: main._id } },
  );
  log(`Existing returns stamped with the Main warehouse: ${stampedReturns.modifiedCount}`);

  // 7. Optional: attach existing warehouse managers to Main. OFF by default — silently rewriting
  //    user records is not something a stock migration should do without being asked.
  if (ASSIGN_USERS) {
    const assigned = await UserModel.updateMany(
      { role: ROLES.WAREHOUSE_MANAGER, warehouseId: { $exists: false }, isTrashed: { $ne: true } },
      { $set: { warehouseId: main._id } },
    );
    log(`Warehouse managers assigned to Main: ${assigned.modifiedCount}`);
  } else {
    log('Skipped user assignment (pass --assign-users to attach warehouse managers to Main)');
  }

  const clean = await verify();
  log(
    clean
      ? 'Bootstrap complete and both integrity checks are clean.'
      : 'Bootstrap complete BUT integrity checks reported drift — investigate before going live.',
  );
  if (negativeQty > 0) {
    log(
      `Reminder: ${negativeQty} product(s) had negative stock before this ran. Review the clamp\n` +
        'adjustments in the movement history with an admin before trusting the figures.',
    );
  }
}

migrate()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
