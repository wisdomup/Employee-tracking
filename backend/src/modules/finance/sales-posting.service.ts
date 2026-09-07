import { Types } from 'mongoose';
import {
  FinanceSettingsModel,
  PostingEventKey,
  POSTING_EVENT_KEYS,
} from '../../models/finance-settings.model';
import { PostingFailureModel } from '../../models/posting-failure.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { OrderModel } from '../../models/order.model';
import { ProductModel } from '../../models/product.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { CreditRecoveryModel } from '../../models/credit-recovery.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { badRequest } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { postEntry, reverseEntry, ledgerIdForRole } from './posting.service';
import { JournalLineInput, buildIdempotencyKey, round2 } from './finance.rules';

/**
 * Auto-posting for the sales side: an order leaving the warehouse, a delivery, the money
 * collected against it, and recovery of old credit.
 *
 * ## The timing correction this module is built around
 *
 * The written specification posts cost of goods at DELIVERY. That is wrong for this platform:
 * `orders.service.createOrder` deducts stock at ORDER CREATE, and `collections.service` posts no
 * stock movement at all — it says so in its own header. Posting the inventory reduction at
 * delivery would leave the ledger showing stock on the shelf that the warehouse had already
 * given away, for as long as the order stayed open, and the nightly inventory check would report
 * drift on every open order.
 *
 * So the value moves in two steps, following the goods:
 *
 *   order created    Inventory — Sellable  →  Inventory — Out for Delivery
 *   delivered        Inventory — Out for Delivery  →  Cost of Goods Sold
 *   cancelled first  Inventory — Out for Delivery  →  Inventory — Sellable
 *
 * At every instant the ledger's inventory equals the warehouse's.
 *
 * ## Nothing here may break an operational flow
 *
 * Every entry point is wrapped so a posting failure is recorded and swallowed. A rider pressing
 * Delivered must not be refused because head office mis-mapped an account.
 */

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

/**
 * Auto-posting is off until somebody turns it on, one event at a time.
 *
 * This is what lets the whole module be merged and deployed long before it touches a real
 * ledger, then switched on with the nightly reconciliation watched between each event.
 */
export async function postingEnabled(event: PostingEventKey): Promise<boolean> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('postingEnabled')
    .lean()
    .exec();
  if (!settings) return false;
  const map = settings.postingEnabled as unknown as Record<string, boolean> | undefined;
  return map?.[event] === true;
}

/**
 * Run a posting, and never let it break the caller.
 *
 * Exported so every auto-posting module shares ONE failure path. A second copy of this would
 * eventually differ from the first, and the difference would be invisible until a month came
 * out short.
 *
 * A failure is recorded against its idempotency key so the nightly job can retry it, and so it
 * shows up somewhere a person will look. A bare `catch {}` here would mean a month quietly
 * short by an amount nobody could trace.
 */
export async function attemptPosting(
  event: string,
  idempotencyKey: string,
  meta: { sourceType: string; sourceId?: string; sourceModel?: string; payload?: Record<string, unknown> },
  run: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await run();
    await PostingFailureModel.updateOne(
      { idempotencyKey },
      { $set: { resolvedAt: new Date() } },
    ).exec();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[finance] ${event} failed for ${idempotencyKey}: ${message}`);

    await PostingFailureModel.updateOne(
      { idempotencyKey },
      {
        $set: {
          event,
          sourceType: meta.sourceType,
          sourceId: meta.sourceId ? new Types.ObjectId(meta.sourceId) : undefined,
          sourceModel: meta.sourceModel,
          payload: meta.payload ?? {},
          lastError: message.slice(0, 2000),
          lastAttemptAt: new Date(),
        },
        $unset: { resolvedAt: '' },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    ).exec();

    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface OrderCostLine {
  productId: Types.ObjectId;
  quantity: number;
  unitCost?: number;
}

/**
 * What the goods on an order cost.
 *
 * Prefers the `unitCost` SNAPSHOT taken when the stock actually moved. Falling back to the live
 * `Product.purchasePrice` is only for legacy lines written before that field existed — the
 * weighted average shifts on every goods receipt, so using it for a historical order would
 * restate a closed period every time new stock arrived. The existing profit report makes the
 * same choice for the same reason.
 */
async function costOfGoods(lines: OrderCostLine[]): Promise<number> {
  const missing = lines.filter((l) => l.unitCost === undefined || l.unitCost === null);
  let fallback = new Map<string, number>();

  if (missing.length > 0) {
    const products = await ProductModel.find({ _id: { $in: missing.map((l) => l.productId) } })
      .select('_id purchasePrice')
      .lean()
      .exec();
    fallback = new Map(products.map((p) => [String(p._id), p.purchasePrice ?? 0]));
  }

  return round2(
    lines.reduce((sum, line) => {
      const cost = line.unitCost ?? fallback.get(String(line.productId)) ?? 0;
      return sum + cost * line.quantity;
    }, 0),
  );
}

/** The warehouse subledger an inventory line belongs to, and the city stamped on the entry. */
async function warehouseContext(warehouseId?: Types.ObjectId | null) {
  if (!warehouseId) return { warehouseId: undefined, cityKey: undefined };
  const warehouse = await WarehouseModel.findById(warehouseId).select('cityKey').lean().exec();
  return { warehouseId: String(warehouseId), cityKey: warehouse?.cityKey };
}

// ---------------------------------------------------------------------------
// Stock leaving the warehouse, at order create
// ---------------------------------------------------------------------------

export async function postOrderStockOut(orderId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('orderCogs'))) return false;

  const key = buildIdempotencyKey('order', orderId, 'stock_out');

  return attemptPosting(
    'order.stock_out',
    key,
    { sourceType: 'order_cogs', sourceId: orderId, sourceModel: 'Order' },
    async () => {
      const order = await OrderModel.findById(orderId)
        .select('products warehouseId orderDate createdAt invoiceNumber')
        .lean()
        .exec();
      if (!order) throw new Error('Order not found');

      const value = await costOfGoods(order.products as OrderCostLine[]);
      // An order of free samples or zero-cost legacy lines has nothing to move. Skipping is
      // correct; posting a zero-value entry would be noise in every day book from now on.
      if (value <= 0) return;

      const context = await warehouseContext(order.warehouseId);
      const [outForDelivery, sellable] = await Promise.all([
        ledgerIdForRole('inventoryOutForDelivery'),
        ledgerIdForRole('inventorySellable'),
      ]);

      const subledger = context.warehouseId
        ? { type: 'warehouse', id: context.warehouseId }
        : null;

      await postEntry(
        {
          date: order.orderDate ?? order.createdAt,
          narration: `Stock out for order #${order.invoiceNumber ?? orderId}`,
          sourceType: 'order_cogs',
          sourceId: orderId,
          sourceModel: 'Order',
          idempotencyKey: key,
          warehouseId: context.warehouseId,
          cityKey: context.cityKey,
          lines: [
            { ledgerId: outForDelivery, debit: value, subledgerRef: subledger },
            { ledgerId: sellable, credit: value, subledgerRef: subledger },
          ],
        },
        actorId,
      );
    },
  );
}

/** Order cancelled before delivery — the warehouse took the stock back, so the value follows. */
export async function postOrderStockReturned(orderId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('orderCogs'))) return false;

  const key = buildIdempotencyKey('order', orderId, 'stock_out');
  const original = await JournalEntryModel.findOne({ idempotencyKey: key }).select('_id status').lean().exec();
  // Nothing was posted when the order was raised — posting is switched on mid-flight, or the
  // order carried no cost. Either way there is nothing to give back.
  if (!original || original.status !== 'posted') return false;

  return attemptPosting(
    'order.stock_returned',
    `${key}:reversal`,
    { sourceType: 'order_cogs', sourceId: orderId, sourceModel: 'Order' },
    () => reverseEntry(String(original._id), { reason: 'Order cancelled before delivery' }, actorId),
  );
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * A delivery: the sale, the cost, and the money taken — three linked entries.
 *
 * Kept as three rather than one so each can be reversed on its own. A voided collection undoes
 * the money without touching the sale, which is exactly what this platform's void means: the
 * goods stayed delivered and the shop still owes for them.
 */
export async function postDelivery(collectionId: string, actorId?: string): Promise<boolean> {
  const [saleOn, collectionOn] = await Promise.all([
    postingEnabled('orderDelivery'),
    postingEnabled('collection'),
  ]);
  if (!saleOn && !collectionOn) return false;

  const collection = await DeliveryCollectionModel.findById(collectionId).lean().exec();
  if (!collection) return false;

  const order = await OrderModel.findById(collection.orderId)
    .select('products warehouseId invoiceNumber discount totalPrice grandTotal')
    .lean()
    .exec();
  if (!order) return false;

  const context = await warehouseContext(order.warehouseId);
  const dealerRef = { type: 'dealer', id: String(collection.dealerId) };
  const riderRef = { type: 'rider', id: String(collection.riderId) };

  let ok = true;

  // ---- The sale ----------------------------------------------------------
  if (saleOn) {
    const key = buildIdempotencyKey('collection', collectionId, 'sale');
    ok = await attemptPosting(
      'delivery.sale',
      key,
      { sourceType: 'order_delivery', sourceId: String(collection.orderId), sourceModel: 'Order' },
      async () => {
        const total = round2(collection.orderAmount);
        if (total <= 0) return;

        // Gross list value before any discount, recovered from the line items. The platform
        // records both a per-line and an order-level discount and then loses the distinction in
        // its totals; posting the discount to its own account gets "how much did we give away"
        // back for free.
        const gross = round2(
          (order.products ?? []).reduce(
            (sum: number, p: any) => sum + (p.price ?? 0) * (p.quantity ?? 0),
            0,
          ),
        );
        const discount = round2(Math.max(gross - total, 0));

        const [ar, sales, discounts] = await Promise.all([
          ledgerIdForRole('arTrade'),
          ledgerIdForRole('salesGoods'),
          ledgerIdForRole('salesDiscounts'),
        ]);

        const lines: JournalLineInput[] = [
          { ledgerId: ar, debit: total, subledgerRef: dealerRef },
          { ledgerId: sales, credit: round2(gross > 0 ? gross : total) },
        ];
        if (discount > 0) lines.push({ ledgerId: discounts, debit: discount });

        // Orders carry no tax field today, so there is no output-tax leg. When tax is added to
        // the order document this is where it goes — the entry already balances without it.

        await postEntry(
          {
            date: collection.deliveredAt,
            narration: `Sale on delivery of order #${order.invoiceNumber ?? collection.orderId}`,
            sourceType: 'order_delivery',
            sourceId: String(collection.orderId),
            sourceModel: 'Order',
            idempotencyKey: key,
            warehouseId: context.warehouseId,
            cityKey: collection.cityKey,
            lines,
          },
          actorId,
        );
      },
    );

    // ---- The cost --------------------------------------------------------
    const cogsKey = buildIdempotencyKey('collection', collectionId, 'cogs');
    const cogsOk = await attemptPosting(
      'delivery.cogs',
      cogsKey,
      { sourceType: 'order_cogs', sourceId: String(collection.orderId), sourceModel: 'Order' },
      async () => {
        const value = await costOfGoods(order.products as OrderCostLine[]);
        if (value <= 0) return;

        /*
         * Which account gives the value up depends on whether this order's stock-out was ever
         * posted.
         *
         * Normally it was, at order create, and the cost comes out of the holding account. But
         * posting is switched on one event at a time on a live system, so on the day it is
         * enabled there are orders already open whose stock left the warehouse while the ledger
         * was not watching. Their holding account never received anything, and crediting it here
         * would drive it negative and strand the value — the books would show stock out for
         * delivery that is not, forever.
         *
         * For those, the value comes straight off the shelf account instead, which is where the
         * opening balance put it.
         */
        const stockOutKey = buildIdempotencyKey('order', String(collection.orderId), 'stock_out');
        const stockOutPosted = await JournalEntryModel.exists({
          idempotencyKey: stockOutKey,
          status: 'posted',
        });

        const [cogs, relieved] = await Promise.all([
          ledgerIdForRole('cogs'),
          ledgerIdForRole(stockOutPosted ? 'inventoryOutForDelivery' : 'inventorySellable'),
        ]);
        const outForDelivery = relieved;
        const subledger = context.warehouseId
          ? { type: 'warehouse', id: context.warehouseId }
          : null;

        await postEntry(
          {
            date: collection.deliveredAt,
            narration: `Cost of goods for order #${order.invoiceNumber ?? collection.orderId}`,
            sourceType: 'order_cogs',
            sourceId: String(collection.orderId),
            sourceModel: 'Order',
            idempotencyKey: cogsKey,
            warehouseId: context.warehouseId,
            cityKey: collection.cityKey,
            lines: [
              { ledgerId: cogs, debit: value },
              { ledgerId: outForDelivery, credit: value, subledgerRef: subledger },
            ],
          },
          actorId,
        );
      },
    );
    ok = ok && cogsOk;
  }

  // ---- The money ---------------------------------------------------------
  if (collectionOn) {
    const key = buildIdempotencyKey('collection', collectionId, 'receipt');
    const receiptOk = await attemptPosting(
      'delivery.collection',
      key,
      { sourceType: 'collection', sourceId: collectionId, sourceModel: 'DeliveryCollection' },
      () => postCollectionReceipt(collection, dealerRef, riderRef, key, actorId),
    );
    ok = ok && receiptOk;
  }

  return ok;
}

/**
 * Cash and online land with the rider; the credit portion simply stays in receivables.
 *
 * `validateCollectionSplit` already forces cash + online + credit to equal the order total, so
 * after the sale entry above this leaves the shop owing EXACTLY the credit portion, with no
 * further arithmetic and nothing to reconcile.
 */
async function postCollectionReceipt(
  collection: { _id: Types.ObjectId; cash: number; online: number; deliveredAt: Date; cityKey: string; orderId: Types.ObjectId },
  dealerRef: { type: string; id: string },
  riderRef: { type: string; id: string },
  key: string,
  actorId?: string,
): Promise<void> {
  const cash = round2(collection.cash);
  const online = round2(collection.online);
  const received = round2(cash + online);
  // An entirely-on-credit delivery moves no money. The receivable is already correct from the
  // sale entry, so there is nothing to post.
  if (received <= 0) return;

  const [riderCash, onlineInTransit, ar] = await Promise.all([
    ledgerIdForRole('riderCash'),
    ledgerIdForRole('onlineInTransit'),
    ledgerIdForRole('arTrade'),
  ]);

  const lines: JournalLineInput[] = [];
  if (cash > 0) lines.push({ ledgerId: riderCash, debit: cash, subledgerRef: riderRef });
  if (online > 0) lines.push({ ledgerId: onlineInTransit, debit: online, subledgerRef: riderRef });
  lines.push({ ledgerId: ar, credit: received, subledgerRef: dealerRef });

  await postEntry(
    {
      date: collection.deliveredAt,
      narration: 'Collected on delivery',
      sourceType: 'collection',
      sourceId: String(collection._id),
      sourceModel: 'DeliveryCollection',
      idempotencyKey: key,
      cityKey: collection.cityKey,
      lines,
    },
    actorId,
  );
}

/**
 * An admin corrected the split. Reverse the money entry and re-post it at the new figures.
 *
 * The sale entry is untouched, because a correction must keep cash + online + credit equal to
 * the order total — so the total never moves, only how it was taken.
 */
export async function postCollectionCorrection(
  collectionId: string,
  actorId?: string,
): Promise<boolean> {
  if (!(await postingEnabled('collection'))) return false;

  const collection = await DeliveryCollectionModel.findById(collectionId).lean().exec();
  if (!collection) return false;

  const stamp = collection.lastCorrectedAt ?? collection.updatedAt;
  const originalKey = buildIdempotencyKey('collection', collectionId, 'receipt');
  const correctionKey = buildIdempotencyKey('collection', collectionId, 'receipt', stamp);

  return attemptPosting(
    'collection.correction',
    correctionKey,
    { sourceType: 'collection_correction', sourceId: collectionId, sourceModel: 'DeliveryCollection' },
    async () => {
      const live = await JournalEntryModel.findOne({
        idempotencyKey: originalKey,
        status: 'posted',
      }).select('_id').lean().exec();

      if (live) {
        await reverseEntry(String(live._id), { reason: 'Collection split corrected' }, actorId);
      }

      const dealerRef = { type: 'dealer', id: String(collection.dealerId) };
      const riderRef = { type: 'rider', id: String(collection.riderId) };
      await postCollectionReceipt(collection as never, dealerRef, riderRef, correctionKey, actorId);
    },
  );
}

/**
 * The collection was voided.
 *
 * Only the money entry is reversed. This platform's void leaves the order `delivered` and moves
 * no stock back — `voidCollection` sets `paidAmount` to zero and nothing else — so the goods are
 * still with the shop and the shop still owes for them. Reversing the sale as well would erase a
 * sale that really happened and leave the inventory reduction with nothing to match.
 */
export async function postCollectionVoid(
  collectionId: string,
  actorId?: string,
): Promise<boolean> {
  if (!(await postingEnabled('collection'))) return false;

  const collection = await DeliveryCollectionModel.findById(collectionId).select('lastCorrectedAt updatedAt').lean().exec();
  if (!collection) return false;

  // Whichever receipt entry is currently live — the original, or the latest correction.
  const keys = [
    buildIdempotencyKey('collection', collectionId, 'receipt'),
    ...(collection.lastCorrectedAt
      ? [buildIdempotencyKey('collection', collectionId, 'receipt', collection.lastCorrectedAt)]
      : []),
  ];

  const live = await JournalEntryModel.findOne({
    idempotencyKey: { $in: keys },
    status: 'posted',
  }).select('_id').lean().exec();
  if (!live) return false;

  return attemptPosting(
    'collection.void',
    `${String(live._id)}:void`,
    { sourceType: 'collection_void', sourceId: collectionId, sourceModel: 'DeliveryCollection' },
    () => reverseEntry(String(live._id), { reason: 'Collection voided' }, actorId),
  );
}

// ---------------------------------------------------------------------------
// Credit recovery
// ---------------------------------------------------------------------------

/** Old credit collected in the field. No sale, no stock — money in, receivable down. */
export async function postCreditRecovery(
  recoveryId: string,
  actorId?: string,
): Promise<boolean> {
  if (!(await postingEnabled('creditRecovery'))) return false;

  const recovery = await CreditRecoveryModel.findById(recoveryId).lean().exec();
  if (!recovery) return false;

  const stamp = recovery.lastCorrectedAt;
  const key = buildIdempotencyKey('credit_recovery', recoveryId, 'receipt', stamp);

  return attemptPosting(
    'credit_recovery.receipt',
    key,
    { sourceType: 'credit_recovery', sourceId: recoveryId, sourceModel: 'CreditRecovery' },
    async () => {
      // A correction reverses the previous entry before the new one goes down.
      if (stamp) {
        const previous = await JournalEntryModel.findOne({
          idempotencyKey: buildIdempotencyKey('credit_recovery', recoveryId, 'receipt'),
          status: 'posted',
        }).select('_id').lean().exec();
        if (previous) {
          await reverseEntry(String(previous._id), { reason: 'Recovery corrected' }, actorId);
        }
      }

      const amount = round2(recovery.amount);
      if (amount <= 0) return;

      const [target, ar] = await Promise.all([
        ledgerIdForRole(recovery.mode === 'cash' ? 'riderCash' : 'onlineInTransit'),
        ledgerIdForRole('arTrade'),
      ]);

      await postEntry(
        {
          date: recovery.collectedAt,
          narration: 'Old credit recovered in the field',
          sourceType: 'credit_recovery',
          sourceId: recoveryId,
          sourceModel: 'CreditRecovery',
          idempotencyKey: key,
          cityKey: recovery.cityKey,
          lines: [
            {
              ledgerId: target,
              debit: amount,
              subledgerRef: { type: 'rider', id: String(recovery.riderId) },
            },
            {
              ledgerId: ar,
              credit: amount,
              subledgerRef: { type: 'dealer', id: String(recovery.dealerId) },
            },
          ],
        },
        actorId,
      );
    },
  );
}

export async function postCreditRecoveryVoid(
  recoveryId: string,
  actorId?: string,
): Promise<boolean> {
  if (!(await postingEnabled('creditRecovery'))) return false;

  const live = await JournalEntryModel.findOne({
    sourceType: 'credit_recovery',
    sourceId: new Types.ObjectId(recoveryId),
    status: 'posted',
  }).select('_id').lean().exec();
  if (!live) return false;

  return attemptPosting(
    'credit_recovery.void',
    `${String(live._id)}:void`,
    { sourceType: 'credit_recovery', sourceId: recoveryId, sourceModel: 'CreditRecovery' },
    () => reverseEntry(String(live._id), { reason: 'Recovery voided' }, actorId),
  );
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

/**
 * Retry everything that failed. Safe because every posting is idempotent by key: a retry either
 * writes the entry or finds it already there.
 */
export async function retryFailedPostings(): Promise<{ retried: number; recovered: number }> {
  const failures = await PostingFailureModel.find({ resolvedAt: { $exists: false } })
    .sort({ lastAttemptAt: 1 })
    .limit(200)
    .lean()
    .exec();

  let recovered = 0;

  for (const failure of failures) {
    const id = failure.sourceId ? String(failure.sourceId) : undefined;
    if (!id) continue;

    let ok = false;
    switch (failure.event) {
      case 'order.stock_out': ok = await postOrderStockOut(id); break;
      case 'order.stock_returned': ok = await postOrderStockReturned(id); break;
      case 'delivery.sale':
      case 'delivery.cogs':
      case 'delivery.collection': {
        const collection = await DeliveryCollectionModel.findOne({ orderId: id }).select('_id').lean().exec();
        const collectionId = collection ? String(collection._id) : id;
        ok = await postDelivery(collectionId);
        break;
      }
      case 'collection.correction': ok = await postCollectionCorrection(id); break;
      case 'collection.void': ok = await postCollectionVoid(id); break;
      case 'credit_recovery.receipt': ok = await postCreditRecovery(id); break;
      case 'credit_recovery.void': ok = await postCreditRecoveryVoid(id); break;
      default: break;
    }

    if (ok) recovered += 1;
  }

  return { retried: failures.length, recovered };
}

// ---------------------------------------------------------------------------
// Operating the switches
// ---------------------------------------------------------------------------

/** Plain-language names for the events, for whoever is deciding when to turn one on. */
const EVENT_LABELS: Record<string, string> = {
  orderDelivery: 'Record a sale when an order is delivered',
  orderCogs: 'Track the cost of stock leaving the warehouse',
  collection: 'Record money collected at delivery',
  creditRecovery: 'Record old credit recovered in the field',
  settlement: 'Record cash and transfers handed back by riders',
  stockReceipt: 'Record stock arriving from suppliers',
  customerReturn: 'Record goods returned by shops',
  damageClaim: 'Record damaged stock written off',
  stockTransfer: 'Record stock moved between warehouses',
  stockCount: 'Record stock-count corrections',
  expense: 'Record expenses',
  payroll: 'Record salaries',
};

export async function listPostingSwitches(): Promise<
  { event: string; label: string; enabled: boolean }[]
> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('postingEnabled')
    .lean()
    .exec();
  const map = (settings?.postingEnabled ?? {}) as unknown as Record<string, boolean>;

  return POSTING_EVENT_KEYS.map((event) => ({
    event,
    label: EVENT_LABELS[event] ?? event,
    enabled: map[event] === true,
  }));
}

/**
 * Turn one event's posting on or off.
 *
 * One at a time, deliberately. Switching everything on at once is the single riskiest thing
 * anybody can do to this module: if the books then disagree with the warehouse there is no way
 * to tell which of twelve events caused it. Turned on singly, with a night's reconciliation
 * between each, the answer is always obvious.
 */
export async function togglePostingSwitch(
  event: string,
  enabled: boolean,
  actorId?: string,
): Promise<{ event: string; enabled: boolean }> {
  if (!(POSTING_EVENT_KEYS as readonly string[]).includes(event)) {
    throw badRequest(`"${event}" is not something this system posts.`);
  }

  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).exec();
  if (!settings) throw badRequest('Finance settings are missing. Run the chart of accounts seed.');

  settings.postingEnabled.set(event, enabled);
  if (actorId) settings.updatedBy = new Types.ObjectId(actorId);
  await settings.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'period',
    entityId: event,
    action: enabled ? 'status_changed' : 'status_changed',
    meta: { postingEvent: event, enabled },
  });

  return { event, enabled };
}

/** Postings that could not be written, so somebody can see what the books are missing. */
export async function listPostingFailures(includeResolved = false) {
  const query = includeResolved ? {} : { resolvedAt: { $exists: false } };
  const rows = await PostingFailureModel.find(query)
    .sort({ lastAttemptAt: -1 })
    .limit(200)
    .lean()
    .exec();

  return rows.map((r) => ({
    id: String(r._id),
    event: r.event,
    sourceType: r.sourceType,
    sourceId: r.sourceId ? String(r.sourceId) : null,
    lastError: r.lastError,
    attempts: r.attempts,
    lastAttemptAt: r.lastAttemptAt,
    resolved: Boolean(r.resolvedAt),
  }));
}
