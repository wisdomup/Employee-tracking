import { Types } from 'mongoose';
import { LedgerModel } from '../../models/ledger.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { CreditRecoveryModel } from '../../models/credit-recovery.model';
import { SettlementModel } from '../../models/settlement.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { ProductModel } from '../../models/product.model';
import { OrderModel } from '../../models/order.model';
import { ReturnModel } from '../../models/return.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { ControlReconciliationModel } from '../../models/control-reconciliation.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { localDayKey } from '../region-sales/region-sales.rules';
import { MONEY_EPSILON, round2 } from './finance.rules';

/**
 * The check that makes this whole module worth having.
 *
 * A control account holds the total of something the business already tracks somewhere else:
 * what shops owe, what riders are carrying, what is on the shelf. Every night each one is proved
 * against that other record. Without this the ledger is a second opinion; with it, it is
 * evidence.
 *
 * ## Failing is the useful outcome
 *
 * A drift means the two sides disagree, and the point is to find out on the day it starts rather
 * than at year end when it is large and untraceable. So each check reports the arithmetic it
 * used, not merely a verdict — a difference with no breakdown is a dead end.
 *
 * ## Nothing here repairs anything
 *
 * These checks read. A drift is a symptom of a bug or a missed posting, and silently correcting
 * the ledger to match would hide the cause and destroy the evidence.
 */

const NOT_VOID = { voidedAt: { $exists: false } };

export interface ControlCheck {
  checkId: string;
  label: string;
  ledgerCode: string;
  ledgerBalance: number;
  operationalValue: number;
  drift: number;
  ok: boolean;
  breakdown: Record<string, number>;
  note?: string;
}

/** A ledger's balance by the engine role it plays, so a renamed account still resolves. */
async function balanceOfRole(role: string): Promise<{ code: string; balance: number } | null> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('ledgerMap')
    .lean()
    .exec();
  const map = settings?.ledgerMap as unknown as Record<string, Types.ObjectId> | undefined;
  const id = map?.[role];
  if (!id) return null;

  const ledger = await LedgerModel.findById(id).select('code cachedBalance').lean().exec();
  if (!ledger) return null;
  return { code: ledger.code, balance: round2(ledger.cachedBalance) };
}

function makeCheck(
  checkId: string,
  label: string,
  ledger: { code: string; balance: number },
  operationalValue: number,
  breakdown: Record<string, number>,
  note?: string,
): ControlCheck {
  const drift = round2(ledger.balance - operationalValue);
  return {
    checkId,
    label,
    ledgerCode: ledger.code,
    ledgerBalance: ledger.balance,
    operationalValue: round2(operationalValue),
    drift,
    ok: Math.abs(drift) < MONEY_EPSILON,
    breakdown,
    note,
  };
}

/** Total value of a set of piece counts, at each product's running weighted-average cost. */
async function valueOfStock(field: 'sellable' | 'inTransit' | 'damaged'): Promise<number> {
  const rows = await WarehouseStockModel.aggregate<{ _id: Types.ObjectId; qty: number }>([
    { $group: { _id: '$productId', qty: { $sum: `$${field}` } } },
  ]).exec();

  if (rows.length === 0) return 0;

  const products = await ProductModel.find({ _id: { $in: rows.map((r) => r._id) } })
    .select('_id purchasePrice')
    .lean()
    .exec();
  const costById = new Map(products.map((p) => [String(p._id), p.purchasePrice ?? 0]));

  return round2(
    rows.reduce((sum, row) => sum + (costById.get(String(row._id)) ?? 0) * row.qty, 0),
  );
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * What every shop owes.
 *
 * The operational figure is `getDealerOutstanding` summed over all shops: credit issued on
 * deliveries, less everything recovered since.
 *
 * IT DOES NOT SUBTRACT RETURNS. The ledger does — a completed return credits the shop's
 * receivable — so the two differ by exactly the value of returns credited, and the difference
 * grows with every return. That is not a bug in the posting; it is the finance module surfacing
 * one in the operational figure: a shop that returned goods still shows the full amount owing on
 * the rider's screen.
 *
 * The check therefore compares against credit less recoveries less returns, and reports the
 * unadjusted operational figure alongside so the gap is visible rather than absorbed.
 */
async function checkAccountsReceivable(): Promise<ControlCheck | null> {
  const ledger = await balanceOfRole('arTrade');
  if (!ledger) return null;

  const [credit, recovered, returned] = await Promise.all([
    DeliveryCollectionModel.aggregate<{ total: number }>([
      { $match: NOT_VOID },
      { $group: { _id: null, total: { $sum: '$credit' } } },
    ]).exec(),
    CreditRecoveryModel.aggregate<{ total: number }>([
      { $match: NOT_VOID },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).exec(),
    ReturnModel.aggregate<{ total: number }>([
      { $match: { status: 'completed', isTrashed: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).exec(),
  ]);

  const creditTotal = round2(credit[0]?.total ?? 0);
  const recoveredTotal = round2(recovered[0]?.total ?? 0);
  const returnedTotal = round2(returned[0]?.total ?? 0);

  const expected = round2(creditTotal - recoveredTotal - returnedTotal);

  return makeCheck(
    'ar-trade',
    'What shops owe',
    ledger,
    expected,
    {
      creditIssued: creditTotal,
      recovered: recoveredTotal,
      returnsCredited: returnedTotal,
      figureShownToRiders: round2(creditTotal - recoveredTotal),
    },
    returnedTotal > 0
      ? 'The rider-facing outstanding figure does not subtract returns, so it is higher than '
        + `this by ${returnedTotal}. Worth deciding whether a return should reduce what a shop owes.`
      : undefined,
  );
}

/** Cash the riders are carrying. */
async function checkRiderCash(): Promise<ControlCheck | null> {
  const ledger = await balanceOfRole('riderCash');
  if (!ledger) return null;

  const [collected, recovered, settled] = await Promise.all([
    DeliveryCollectionModel.aggregate<{ total: number }>([
      { $match: NOT_VOID },
      { $group: { _id: null, total: { $sum: '$cash' } } },
    ]).exec(),
    CreditRecoveryModel.aggregate<{ total: number }>([
      { $match: { ...NOT_VOID, mode: 'cash' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).exec(),
    SettlementModel.aggregate<{ total: number }>([
      // The one rule again: only a RECEIVED settlement reduces what a rider holds.
      { $match: { ...NOT_VOID, mode: 'cash', status: 'received' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).exec(),
  ]);

  const collectedTotal = round2(collected[0]?.total ?? 0);
  const recoveredTotal = round2(recovered[0]?.total ?? 0);
  const settledTotal = round2(settled[0]?.total ?? 0);

  return makeCheck(
    'rider-cash',
    'Cash held by riders',
    ledger,
    round2(collectedTotal + recoveredTotal - settledTotal),
    { collectedOnDelivery: collectedTotal, recovered: recoveredTotal, handedOver: settledTotal },
  );
}

/** Online payments taken in the field but not yet confirmed in the bank. */
async function checkOnlineInTransit(): Promise<ControlCheck | null> {
  const ledger = await balanceOfRole('onlineInTransit');
  if (!ledger) return null;

  const [collected, recovered, settled] = await Promise.all([
    DeliveryCollectionModel.aggregate<{ total: number }>([
      { $match: NOT_VOID },
      { $group: { _id: null, total: { $sum: '$online' } } },
    ]).exec(),
    CreditRecoveryModel.aggregate<{ total: number }>([
      { $match: { ...NOT_VOID, mode: 'online' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).exec(),
    SettlementModel.aggregate<{ total: number }>([
      { $match: { ...NOT_VOID, mode: 'online', status: 'received' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).exec(),
  ]);

  const collectedTotal = round2(collected[0]?.total ?? 0);
  const recoveredTotal = round2(recovered[0]?.total ?? 0);
  const settledTotal = round2(settled[0]?.total ?? 0);

  return makeCheck(
    'online-in-transit',
    'Online payments not yet in the bank',
    ledger,
    round2(collectedTotal + recoveredTotal - settledTotal),
    { collectedOnDelivery: collectedTotal, recovered: recoveredTotal, confirmed: settledTotal },
  );
}

/** Stock on the shelf, valued the way the warehouse values it. */
async function checkInventory(): Promise<ControlCheck | null> {
  const ledger = await balanceOfRole('inventorySellable');
  if (!ledger) return null;

  const value = await valueOfStock('sellable');
  return makeCheck('inventory-sellable', 'Stock on the shelf', ledger, value, {
    warehouseValuation: value,
  });
}

/** Stock that has left one warehouse and not yet reached another. */
async function checkInTransit(): Promise<ControlCheck | null> {
  const ledger = await balanceOfRole('inventoryInTransit');
  if (!ledger) return null;

  const value = await valueOfStock('inTransit');
  return makeCheck('inventory-in-transit', 'Stock moving between warehouses', ledger, value, {
    warehouseValuation: value,
  });
}

/**
 * Stock that has left the warehouse on an order but has not been delivered.
 *
 * The account this platform needs because it deducts stock at order create rather than at
 * delivery. Its balance should equal the cost of everything currently out with a rider, so an
 * order stuck open is visible as value sitting here rather than as a hole somewhere else.
 */
async function checkOutForDelivery(): Promise<ControlCheck | null> {
  const ledger = await balanceOfRole('inventoryOutForDelivery');
  if (!ledger) return null;

  const open = await OrderModel.aggregate<{ total: number }>([
    {
      $match: {
        status: { $nin: ['delivered', 'cancelled'] },
        isTrashed: { $ne: true },
      },
    },
    { $unwind: '$products' },
    {
      $group: {
        _id: null,
        total: {
          $sum: { $multiply: ['$products.quantity', { $ifNull: ['$products.unitCost', 0] }] },
        },
      },
    },
  ]).exec();

  const value = round2(open[0]?.total ?? 0);

  return makeCheck(
    'inventory-out-for-delivery',
    'Stock out with riders',
    ledger,
    value,
    { openOrdersAtCost: value },
    'Orders raised before automatic posting was switched on have no entry here, so a difference '
      + 'is expected until every such order has been delivered or cancelled.',
  );
}

/**
 * Goods received with no supplier bill against them yet.
 *
 * Received minus billed, and the subtraction is the point: this is a clearing account, so the
 * operational figure it should agree with is what is still OUTSTANDING, not everything that ever
 * arrived. A balance that ages here is a missing invoice; a NEGATIVE one means a bill cleared
 * more than a receipt ever put in, which `bills.service` exists to make impossible.
 *
 * Only posted bills are counted, matching how the bill module itself decides what a receipt has
 * left to bill. A draft has moved nothing.
 */
async function checkGoodsReceivedNotInvoiced(): Promise<ControlCheck | null> {
  const ledger = await balanceOfRole('grni');
  if (!ledger) return null;

  const [received, billed] = await Promise.all([
    StockReceiptModel.aggregate<{ total: number }>([
      { $match: { status: 'posted', isTrashed: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]).exec(),
    PurchaseBillModel.aggregate<{ total: number }>([
      { $match: { status: 'posted' } },
      { $unwind: '$matchedReceipts' },
      { $group: { _id: null, total: { $sum: '$matchedReceipts.amount' } } },
    ]).exec(),
  ]);

  const postedReceipts = round2(received[0]?.total ?? 0);
  const billedAgainstReceipts = round2(billed[0]?.total ?? 0);

  return makeCheck(
    'grni',
    'Goods received, not yet billed',
    ledger,
    round2(postedReceipts - billedAgainstReceipts),
    { postedReceipts, billedAgainstReceipts },
    'Stock that has arrived and has no supplier bill against it yet. An ageing balance here is '
      + 'an invoice nobody has sent.',
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const CHECKS = [
  checkAccountsReceivable,
  checkRiderCash,
  checkOnlineInTransit,
  checkInventory,
  checkInTransit,
  checkOutForDelivery,
  checkGoodsReceivedNotInvoiced,
];

export interface ReconciliationResult {
  day: string;
  checks: ControlCheck[];
  ok: boolean;
  failing: number;
}

/** Run every control check and record the day's result. */
export async function runControlReconciliation(
  options: { persist?: boolean } = {},
): Promise<ReconciliationResult> {
  const day = localDayKey(new Date());
  const checks: ControlCheck[] = [];

  for (const check of CHECKS) {
    // One misconfigured account must not stop the other six from reporting.
    try {
      const result = await check();
      if (result) checks.push(result);
    } catch (err) {
      console.error('[finance] a control check failed to run:', err);
    }
  }

  if (options.persist !== false) {
    for (const check of checks) {
      await ControlReconciliationModel.updateOne(
        { day, checkId: check.checkId },
        {
          $set: {
            label: check.label,
            ledgerCode: check.ledgerCode,
            ledgerBalance: check.ledgerBalance,
            operationalValue: check.operationalValue,
            drift: check.drift,
            ok: check.ok,
            breakdown: check.breakdown,
            note: check.note,
          },
        },
        { upsert: true },
      ).exec();
    }
  }

  const failing = checks.filter((c) => !c.ok).length;
  return { day, checks, ok: failing === 0, failing };
}

/**
 * When each currently-failing check was last seen agreeing.
 *
 * "Out by 4,300" is an argument. "Out by 4,300 since the 14th, and by nothing before" is a lead.
 */
export async function driftHistory(
  checkId: string,
  days = 30,
): Promise<{ day: string; drift: number; ok: boolean }[]> {
  const rows = await ControlReconciliationModel.find({ checkId })
    .sort({ day: -1 })
    .limit(days)
    .select('day drift ok')
    .lean()
    .exec();
  return rows.map((r) => ({ day: r.day, drift: r.drift, ok: r.ok }));
}

/**
 * The blocking form, for period close.
 *
 * Returns only what is wrong, so the caller can put it in front of whoever tried to close the
 * month. Signing a month off against control accounts that disagree with the warehouse is the
 * exact thing this module exists to prevent.
 */
export async function failingControls(): Promise<ControlCheck[]> {
  const result = await runControlReconciliation({ persist: false });
  return result.checks.filter((c) => !c.ok);
}

/**
 * The last recorded run, without re-running it.
 *
 * A full run touches every operational collection, so a screen that refreshes on a timer must
 * not force one. The nightly job is what keeps this current; the manual refresh exists for the
 * moment after somebody has just fixed something.
 */
export async function latestControlChecks(): Promise<ReconciliationResult> {
  const latest = await ControlReconciliationModel.findOne()
    .sort({ day: -1 })
    .select('day')
    .lean()
    .exec();

  if (!latest) {
    // Never run. Run it now rather than showing an empty screen that looks like "all clear".
    return runControlReconciliation();
  }

  const rows = await ControlReconciliationModel.find({ day: latest.day }).lean().exec();
  const checks: ControlCheck[] = rows.map((r) => ({
    checkId: r.checkId,
    label: r.label,
    ledgerCode: r.ledgerCode,
    ledgerBalance: r.ledgerBalance,
    operationalValue: r.operationalValue,
    drift: r.drift,
    ok: r.ok,
    breakdown: (r.breakdown ?? {}) as Record<string, number>,
    note: r.note,
  }));

  const failing = checks.filter((c) => !c.ok).length;
  return { day: latest.day, checks, ok: failing === 0, failing };
}
