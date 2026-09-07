import { Types } from 'mongoose';
import { ProductModel } from '../../models/product.model';
import { ReturnModel } from '../../models/return.model';
import { DamageClaimModel } from '../../models/damage-claim.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { StockTransferModel } from '../../models/stock-transfer.model';
import { StockCountModel } from '../../models/stock-count.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { postEntry, reverseEntry, ledgerIdForRole } from './posting.service';
import { attemptPosting, postingEnabled } from './sales-posting.service';
import { JournalLineInput, buildIdempotencyKey, round2 } from './finance.rules';

/**
 * Auto-posting for everything that moves stock without selling it: goods received, customer
 * returns, damage, transfers between warehouses, and stock-count corrections.
 *
 * ## Three traps, all silent
 *
 * Each of these would leave the books looking right and the inventory value wrong. They were
 * found by reading the operational code, not by reading the specification.
 *
 *  1. A damage-type RETURN automatically creates an already-approved `DamageClaim`
 *     (`createLinkedDamageClaim`). Posting both writes the same goods off twice. A claim
 *     carrying `linkedReturnId` therefore posts NOTHING — the return already did.
 *
 *  2. `OpeningStock` movements are the warehouse's starting position, not an accounting event.
 *     Posting them would count the same inventory twice: once in the opening balance and again
 *     as a movement. They are never posted, at all.
 *
 *  3. Transfers have SIX states, not two. `mismatch` is where stock genuinely goes missing, and
 *     it is the only one that produces a loss.
 *
 * ## Damaged stock carries no book value
 *
 * The damaged bucket holds pieces but no money: damage is expensed when it is approved, which is
 * the treatment the existing profit report already uses. So nothing here ever debits an
 * "Inventory — Damaged" asset. If that decision is ever reversed, this is the file to change.
 */

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

interface CostLine {
  productId: Types.ObjectId | string;
  quantity: number;
}

/**
 * What a set of pieces is worth, at the product's running weighted-average cost.
 *
 * Order lines carry a `unitCost` snapshot and must use it. These movements do not: a transfer or
 * a stock count has no sale behind it, so the current average is the only basis there is. That is
 * also what `stock-costing.ts` uses to value the same movements on the warehouse side, so the two
 * agree by construction.
 */
async function valueAtCost(lines: CostLine[]): Promise<number> {
  if (lines.length === 0) return 0;

  const products = await ProductModel.find({ _id: { $in: lines.map((l) => l.productId) } })
    .select('_id purchasePrice')
    .lean()
    .exec();
  const costById = new Map(products.map((p) => [String(p._id), p.purchasePrice ?? 0]));

  return round2(
    lines.reduce(
      (sum, line) => sum + (costById.get(String(line.productId)) ?? 0) * (line.quantity || 0),
      0,
    ),
  );
}

async function cityOf(warehouseId?: Types.ObjectId | null): Promise<string | undefined> {
  if (!warehouseId) return undefined;
  const warehouse = await WarehouseModel.findById(warehouseId).select('cityKey').lean().exec();
  return warehouse?.cityKey;
}

function warehouseRef(warehouseId?: Types.ObjectId | string | null) {
  return warehouseId ? { type: 'warehouse', id: String(warehouseId) } : null;
}

// ---------------------------------------------------------------------------
// Goods received
// ---------------------------------------------------------------------------

/**
 * Stock arriving from a supplier.
 *
 * Uses the receipt's own rates, not the product average — the rate on the receipt IS what these
 * particular pieces cost, and it is what shifts the average for everything after.
 *
 * The idempotency scope carries `updatedAt`, following `updateStockReceipt`: an edited receipt
 * fully reverses and re-posts underneath, and the stamp is what separates one correction from
 * the next while still letting a genuine retry reuse its key.
 */
export async function postStockReceipt(receiptId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('stockReceipt'))) return false;

  const receipt = await StockReceiptModel.findById(receiptId).lean().exec();
  if (!receipt) return false;
  if (receipt.status !== 'posted') return false;

  const key = buildIdempotencyKey('stock_receipt', receiptId, 'goods_in', receipt.updatedAt);

  return attemptPosting(
    'stock_receipt.goods_in',
    key,
    { sourceType: 'stock_receipt', sourceId: receiptId, sourceModel: 'StockReceipt' },
    async () => {
      // Reverse whatever the previous version of this receipt posted, if it was edited.
      await reverseLivePosting(
        { sourceType: 'stock_receipt', sourceId: receiptId, exceptKey: key },
        'Stock receipt corrected',
        actorId,
      );

      const value = round2(
        (receipt.products ?? []).reduce((sum, p) => sum + p.rate * p.quantity, 0),
      );
      if (value <= 0) return;

      const [sellable, grni] = await Promise.all([
        ledgerIdForRole('inventorySellable'),
        ledgerIdForRole('grni'),
      ]);

      await postEntry(
        {
          date: receipt.receiptDate,
          narration: `Goods received${receipt.supplierName ? ` from ${receipt.supplierName}` : ''}`,
          referenceNo: receipt.documentNo ? String(receipt.documentNo) : undefined,
          sourceType: 'stock_receipt',
          sourceId: receiptId,
          sourceModel: 'StockReceipt',
          idempotencyKey: key,
          warehouseId: String(receipt.warehouseId),
          cityKey: await cityOf(receipt.warehouseId),
          lines: [
            {
              ledgerId: sellable,
              debit: value,
              subledgerRef: warehouseRef(receipt.warehouseId),
            },
            // No supplier breakdown yet — see the seed's note on 2115. It is a clearing account
            // that drains as bills are matched, so it does not need one until bills exist.
            { ledgerId: grni, credit: value },
          ],
        },
        actorId,
      );
    },
  );
}

/** A receipt was cancelled or deleted — the stock went back out, so the value follows. */
export async function postStockReceiptReversal(
  receiptId: string,
  actorId?: string,
): Promise<boolean> {
  if (!(await postingEnabled('stockReceipt'))) return false;

  return attemptPosting(
    'stock_receipt.reversal',
    // Stable, NOT a timestamp. This key is what a failure is recorded against, so a moving one
    // would file a fresh failure row on every retry instead of bumping the existing one, and the
    // health screen would fill with duplicates of a single problem.
    //
    // The reversal itself is idempotent regardless: it looks for entries still `posted`, and a
    // second call finds none because the first already marked them `reversed`.
    buildIdempotencyKey('stock_receipt', receiptId, 'cancel'),
    { sourceType: 'stock_receipt_reversal', sourceId: receiptId, sourceModel: 'StockReceipt' },
    () =>
      reverseLivePosting(
        { sourceType: 'stock_receipt', sourceId: receiptId },
        'Stock receipt cancelled',
        actorId,
      ),
  );
}

// ---------------------------------------------------------------------------
// Customer returns
// ---------------------------------------------------------------------------

/**
 * Goods coming back from a shop.
 *
 * Two legs, and the second one depends on what came back:
 *
 *   money  — Sales Returns is debited and the shop's receivable falls. Always.
 *   goods  — a plain return puts sellable stock back and un-does its cost. A DAMAGE return does
 *            not: `creditReturnedStock` credits the DAMAGED bucket, which carries no book value,
 *            so the cost moves from Cost of Goods Sold to the damage write-off instead.
 *
 * Getting that second leg wrong would inflate inventory by the value of every damaged item ever
 * returned, with nothing on the warehouse side to disagree with.
 */
export async function postCustomerReturn(returnId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('customerReturn'))) return false;

  const returnDoc = await ReturnModel.findById(returnId).lean().exec();
  if (!returnDoc) return false;
  if (returnDoc.status !== 'completed') return false;

  const key = buildIdempotencyKey('return', returnId, 'completed');

  return attemptPosting(
    'return.completed',
    key,
    { sourceType: 'customer_return', sourceId: returnId, sourceModel: 'Return' },
    async () => {
      const isDamage = returnDoc.returnType === 'damage';
      const cost = await valueAtCost(returnDoc.products as CostLine[]);
      const credited = round2(returnDoc.amount ?? 0);

      const [salesReturns, ar, cogs, sellable, damageWriteOff] = await Promise.all([
        ledgerIdForRole('salesReturns'),
        ledgerIdForRole('arTrade'),
        ledgerIdForRole('cogs'),
        ledgerIdForRole('inventorySellable'),
        ledgerIdForRole('damageWriteOff'),
      ]);

      const lines: JournalLineInput[] = [];

      if (credited > 0) {
        lines.push({ ledgerId: salesReturns, debit: credited });
        lines.push({
          ledgerId: ar,
          credit: credited,
          subledgerRef: { type: 'dealer', id: String(returnDoc.dealerId) },
        });
      }

      if (cost > 0) {
        if (isDamage) {
          // The goods are back but worthless to us. The cost stops being a cost of SALE and
          // becomes a write-off — same effect on profit, honest about which it was.
          lines.push({ ledgerId: damageWriteOff, debit: cost });
        } else {
          lines.push({
            ledgerId: sellable,
            debit: cost,
            subledgerRef: warehouseRef(returnDoc.warehouseId),
          });
        }
        lines.push({ ledgerId: cogs, credit: cost });
      }

      if (lines.length === 0) return;

      await postEntry(
        {
          date: returnDoc.updatedAt ?? returnDoc.createdAt,
          narration: isDamage ? 'Damaged goods returned by a client' : 'Goods returned by a client',
          sourceType: 'customer_return',
          sourceId: returnId,
          sourceModel: 'Return',
          idempotencyKey: key,
          warehouseId: returnDoc.warehouseId ? String(returnDoc.warehouseId) : undefined,
          cityKey: await cityOf(returnDoc.warehouseId),
          lines,
        },
        actorId,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * A damage claim approved in the warehouse.
 *
 * TRAP 1. A claim carrying `linkedReturnId` was created automatically by a completed damage-type
 * return, already approved, moving no stock of its own — `createLinkedDamageClaim` says so in its
 * comment. The return posted the write-off. Posting again here would write the same goods off
 * twice, and the inventory control would drift by the value of every client damage claim with
 * nothing to point at.
 */
export async function postDamageClaim(claimId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('damageClaim'))) return false;

  const claim = await DamageClaimModel.findById(claimId).lean().exec();
  if (!claim) return false;
  if (claim.status !== 'approved') return false;

  // The trap, guarded.
  if (claim.linkedReturnId) return false;

  const key = buildIdempotencyKey('damage_claim', claimId, 'approved');

  return attemptPosting(
    'damage_claim.approved',
    key,
    { sourceType: 'damage_claim', sourceId: claimId, sourceModel: 'DamageClaim' },
    async () => {
      const value = await valueAtCost(claim.products as CostLine[]);
      if (value <= 0) return;

      const [writeOff, sellable] = await Promise.all([
        ledgerIdForRole('damageWriteOff'),
        ledgerIdForRole('inventorySellable'),
      ]);

      await postEntry(
        {
          date: claim.approvedAt ?? claim.createdAt,
          narration: `Stock written off as damaged: ${claim.reason}`,
          referenceNo: claim.documentNo ? String(claim.documentNo) : undefined,
          sourceType: 'damage_claim',
          sourceId: claimId,
          sourceModel: 'DamageClaim',
          idempotencyKey: key,
          warehouseId: String(claim.warehouseId),
          cityKey: await cityOf(claim.warehouseId),
          lines: [
            { ledgerId: writeOff, debit: value },
            {
              ledgerId: sellable,
              credit: value,
              subledgerRef: warehouseRef(claim.warehouseId),
            },
          ],
        },
        actorId,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

/** Stock leaving the source warehouse on an approved transfer. */
export async function postTransferOut(transferId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('stockTransfer'))) return false;

  const transfer = await StockTransferModel.findById(transferId).lean().exec();
  if (!transfer) return false;

  const key = buildIdempotencyKey('transfer', transferId, 'out');

  return attemptPosting(
    'transfer.out',
    key,
    { sourceType: 'transfer_out', sourceId: transferId, sourceModel: 'StockTransfer' },
    async () => {
      const value = await valueAtCost(
        (transfer.products ?? []).map((p: any) => ({ productId: p.productId, quantity: p.sentQty })),
      );
      if (value <= 0) return;

      const [inTransit, sellable] = await Promise.all([
        ledgerIdForRole('inventoryInTransit'),
        ledgerIdForRole('inventorySellable'),
      ]);

      await postEntry(
        {
          date: transfer.updatedAt ?? transfer.createdAt,
          narration: 'Stock sent between warehouses',
          referenceNo: transfer.documentNo ? String(transfer.documentNo) : undefined,
          sourceType: 'transfer_out',
          sourceId: transferId,
          sourceModel: 'StockTransfer',
          idempotencyKey: key,
          warehouseId: String(transfer.fromWarehouseId),
          cityKey: await cityOf(transfer.fromWarehouseId),
          lines: [
            {
              ledgerId: inTransit,
              debit: value,
              subledgerRef: warehouseRef(transfer.fromWarehouseId),
            },
            {
              ledgerId: sellable,
              credit: value,
              subledgerRef: warehouseRef(transfer.fromWarehouseId),
            },
          ],
        },
        actorId,
      );
    },
  );
}

/**
 * Stock arriving at the destination, and whatever failed to arrive with it.
 *
 * TRAP 3. Six states, and this is where the two that matter meet: `completed` means everything
 * sent was received, `mismatch` means it was not. The shortfall is a real loss and has to leave
 * the in-transit account, or value sits there forever with no stock behind it.
 */
export async function postTransferIn(transferId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('stockTransfer'))) return false;

  const transfer = await StockTransferModel.findById(transferId).lean().exec();
  if (!transfer) return false;

  const key = buildIdempotencyKey('transfer', transferId, 'in', transfer.updatedAt);

  return attemptPosting(
    'transfer.in',
    key,
    { sourceType: 'transfer_in', sourceId: transferId, sourceModel: 'StockTransfer' },
    async () => {
      /*
       * Reverse any earlier arrival entry for this transfer before writing a new one.
       *
       * `receiveTransfer` and `resolveTransferMismatch` both land here, and a mismatch is
       * resolved AFTER it was received. Without this, the resolution posts a second arrival
       * under a fresh `updatedAt` scope and the destination warehouse is credited twice for one
       * delivery. The `exceptKey` keeps the entry about to be written from reversing itself.
       */
      await reverseLivePosting(
        { sourceType: 'transfer_in', sourceId: transferId, exceptKey: key },
        'Transfer arrival restated',
        actorId,
      );
      await reverseLivePosting(
        { sourceType: 'transfer_shrinkage', sourceId: transferId, exceptKey: key },
        'Transfer arrival restated',
        actorId,
      );

      const products = (transfer.products ?? []) as any[];

      const receivedValue = await valueAtCost(
        products.map((p) => ({ productId: p.productId, quantity: p.receivedQty ?? p.sentQty })),
      );
      const shortfallValue = await valueAtCost(
        products.map((p) => ({
          productId: p.productId,
          quantity: Math.max((p.sentQty ?? 0) - (p.receivedQty ?? p.sentQty ?? 0), 0),
        })),
      );

      if (receivedValue <= 0 && shortfallValue <= 0) return;

      const [inTransit, sellable, shrinkage] = await Promise.all([
        ledgerIdForRole('inventoryInTransit'),
        ledgerIdForRole('inventorySellable'),
        ledgerIdForRole('transferShrinkage'),
      ]);

      const lines: JournalLineInput[] = [];

      if (receivedValue > 0) {
        lines.push({
          ledgerId: sellable,
          debit: receivedValue,
          subledgerRef: warehouseRef(transfer.toWarehouseId),
        });
      }
      if (shortfallValue > 0) {
        // Sent but never arrived. A real loss, named as one rather than left in transit.
        lines.push({ ledgerId: shrinkage, debit: shortfallValue });
      }

      lines.push({
        ledgerId: inTransit,
        credit: round2(receivedValue + shortfallValue),
        subledgerRef: warehouseRef(transfer.fromWarehouseId),
      });

      await postEntry(
        {
          date: transfer.updatedAt ?? transfer.createdAt,
          narration:
            shortfallValue > 0
              ? 'Stock received between warehouses, short of what was sent'
              : 'Stock received between warehouses',
          referenceNo: transfer.documentNo ? String(transfer.documentNo) : undefined,
          sourceType: shortfallValue > 0 ? 'transfer_shrinkage' : 'transfer_in',
          sourceId: transferId,
          sourceModel: 'StockTransfer',
          idempotencyKey: key,
          warehouseId: String(transfer.toWarehouseId),
          cityKey: await cityOf(transfer.toWarehouseId),
          lines,
        },
        actorId,
      );
    },
  );
}

/** Transfer rejected or cancelled before it arrived — the value comes back to the source shelf. */
export async function postTransferReturned(
  transferId: string,
  actorId?: string,
): Promise<boolean> {
  if (!(await postingEnabled('stockTransfer'))) return false;

  return attemptPosting(
    'transfer.returned',
    // Stable for the same reason as the receipt cancellation above.
    buildIdempotencyKey('transfer', transferId, 'returned'),
    { sourceType: 'transfer_out', sourceId: transferId, sourceModel: 'StockTransfer' },
    () =>
      reverseLivePosting(
        { sourceType: 'transfer_out', sourceId: transferId },
        'Transfer cancelled before arrival',
        actorId,
      ),
  );
}

// ---------------------------------------------------------------------------
// Stock counts
// ---------------------------------------------------------------------------

/**
 * A monthly count approved, correcting the system figure to the counted one.
 *
 * The adjustment can go either way. A surplus is not good news — it means the records were wrong
 * — so both directions land in the same gain-or-loss account rather than a surplus being quietly
 * folded into inventory as if it had always been there.
 */
export async function postStockCount(countId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('stockCount'))) return false;

  const count = await StockCountModel.findById(countId).lean().exec();
  if (!count) return false;
  if (count.status !== 'approved') return false;

  const key = buildIdempotencyKey('stock_count', countId, 'approved');

  return attemptPosting(
    'stock_count.approved',
    key,
    { sourceType: 'stock_count_adjustment', sourceId: countId, sourceModel: 'StockCount' },
    async () => {
      const lines = (count.lines ?? []) as any[];

      // Only the SELLABLE delta carries value. The damaged bucket holds no book value, so a
      // correction to it changes pieces and not money.
      const deltas = lines.map((l) => ({
        productId: l.productId,
        quantity: (l.countedSellable ?? 0) - (l.systemSellable ?? 0),
      }));

      const surplus = await valueAtCost(
        deltas.filter((d) => d.quantity > 0),
      );
      const shortfall = await valueAtCost(
        deltas.filter((d) => d.quantity < 0).map((d) => ({ ...d, quantity: -d.quantity })),
      );

      const net = round2(surplus - shortfall);
      if (Math.abs(net) < 0.005) return;

      const [sellable, adjustment] = await Promise.all([
        ledgerIdForRole('inventorySellable'),
        ledgerIdForRole('countAdjustment'),
      ]);

      const subledger = warehouseRef(count.warehouseId);

      await postEntry(
        {
          date: count.approvedAt ?? count.updatedAt ?? count.createdAt,
          narration: `Stock count correction for ${count.periodMonth ?? 'the period'}`,
          referenceNo: count.documentNo ? String(count.documentNo) : undefined,
          sourceType: 'stock_count_adjustment',
          sourceId: countId,
          sourceModel: 'StockCount',
          idempotencyKey: key,
          warehouseId: String(count.warehouseId),
          cityKey: await cityOf(count.warehouseId),
          lines:
            net > 0
              ? [
                  { ledgerId: sellable, debit: net, subledgerRef: subledger },
                  { ledgerId: adjustment, credit: net },
                ]
              : [
                  { ledgerId: adjustment, debit: round2(-net) },
                  { ledgerId: sellable, credit: round2(-net), subledgerRef: subledger },
                ],
        },
        actorId,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Reverse whatever this source document currently has posted.
 *
 * Used by every correction and cancellation path here. `exceptKey` protects the entry about to
 * be written from reversing itself when a re-post and a reversal share a call.
 */
async function reverseLivePosting(
  where: { sourceType: string; sourceId: string; exceptKey?: string },
  reason: string,
  actorId?: string,
): Promise<void> {
  const query: Record<string, unknown> = {
    sourceType: where.sourceType,
    sourceId: new Types.ObjectId(where.sourceId),
    status: 'posted',
  };
  if (where.exceptKey) query.idempotencyKey = { $ne: where.exceptKey };

  const live = await JournalEntryModel.find(query).select('_id').lean().exec();
  for (const entry of live) {
    await reverseEntry(String(entry._id), { reason }, actorId);
  }
}
