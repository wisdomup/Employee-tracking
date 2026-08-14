import { Types } from 'mongoose';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { ProductModel } from '../../models/product.model';
import { badRequest, notFound, conflict } from '../../utils/app-error';
import { applyStockMovements, StockMovementLine } from './stock-ledger.service';

/**
 * Direct stock correction — the "edit the figures in place" path used by the Products table on a
 * warehouse's detail page.
 *
 * This is the ONLY write path in the module without a document and an approval behind it, so it is
 * deliberately narrow:
 *
 *   • admin only (the route gate), matching who may approve a stock count
 *   • a reason is mandatory and lands on every ledger row it writes
 *   • sellable and damaged only — `in_transit` belongs to the transfer documents, and editing it
 *     by hand would leave a transfer that can never be received
 *   • it still goes through `applyStockMovements`, so the ledger, the `Product.quantity` mirror
 *     and the negative-stock guard all apply exactly as they do everywhere else
 *
 * The normal monthly correction is still a stock count: this is for fixing an obvious data error
 * without waiting for one.
 */

export interface AdjustStockLineInput {
  productId: string;
  /** New absolute figure for the bucket. Omit a bucket to leave it alone. */
  sellable?: number;
  damaged?: number;
  /**
   * Optimistic-concurrency baseline: the figure the CLIENT was showing when the operator typed.
   *
   * Optional, and omitting it gives byte-for-byte the old behaviour — the per-warehouse adjust
   * screen passes nothing and is unaffected. Sent, the correction is refused when the warehouse
   * no longer holds that figure, which is what stops a screen left open from silently reversing
   * someone else's sale.
   */
  expectedSellable?: number;
  expectedDamaged?: number;
}

export interface AdjustStockInput {
  warehouseId: string;
  reason: string;
  lines: AdjustStockLineInput[];
}

export interface AdjustStockResult {
  warehouseId: string;
  /** Products whose figures actually moved. */
  adjustedProducts: number;
  movements: number;
  changes: {
    productId: string;
    productName: string;
    bucket: 'sellable' | 'damaged';
    from: number;
    to: number;
    delta: number;
  }[];
}

/**
 * Apply a set of absolute bucket figures at one warehouse.
 *
 * Lines that already match the stored figure are dropped rather than posted as zero deltas, which
 * is also what makes a double-submitted form harmless: the second attempt finds nothing to change.
 */
export async function adjustStock(
  input: AdjustStockInput,
  actorId: string,
): Promise<AdjustStockResult> {
  const productIds = input.lines.map((l) => l.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('The same product appears more than once');
  }

  const products = await ProductModel.find({
    _id: { $in: productIds },
    isTrashed: { $ne: true },
  })
    .select('_id name')
    .lean();

  if (products.length !== productIds.length) {
    throw notFound('One or more products could not be found');
  }
  const productNames = new Map(products.map((p) => [String(p._id), p.name]));

  const balances = await WarehouseStockModel.find({
    warehouseId: new Types.ObjectId(input.warehouseId),
    productId: { $in: productIds.map((id) => new Types.ObjectId(id)) },
  }).lean();

  const currentByProduct = new Map(
    balances.map((b) => [String(b.productId), { sellable: b.sellable, damaged: b.damaged }]),
  );

  const movementLines: StockMovementLine[] = [];
  const changes: AdjustStockResult['changes'] = [];
  const conflicts: string[] = [];

  input.lines.forEach((line, index) => {
    // No balance row yet is a real state (a product the warehouse has never held), and it means
    // zero in every bucket — the ledger upserts the row when the delta is positive.
    const current = currentByProduct.get(line.productId) ?? { sellable: 0, damaged: 0 };

    for (const bucket of ['sellable', 'damaged'] as const) {
      const target = line[bucket];
      if (target === undefined) continue;

      // The figures posted here are ABSOLUTE, so a screen opened before someone else sold a piece
      // would quietly put that piece back — a reversal nobody reviewed, and invisible afterwards
      // because the ledger stays perfectly consistent with it. When the caller tells us what it
      // was showing, refuse rather than overwrite.
      const expected = bucket === 'sellable' ? line.expectedSellable : line.expectedDamaged;
      if (expected !== undefined && expected !== current[bucket]) {
        conflicts.push(
          `${productNames.get(line.productId) ?? line.productId} — ${bucket}: you were shown ` +
            `${expected}, it is now ${current[bucket]}`,
        );
        continue;
      }

      const delta = target - current[bucket];
      if (delta === 0) continue;

      movementLines.push({
        warehouseId: input.warehouseId,
        productId: line.productId,
        bucket,
        delta,
        type: 'manual_adjustment',
        refLine: index,
      });
      changes.push({
        productId: line.productId,
        productName: productNames.get(line.productId) ?? '',
        bucket,
        from: current[bucket],
        to: target,
        delta,
      });
    }
  });

  // Ordered before the no-op check on purpose: a stale screen whose every line conflicts would
  // otherwise be told "nothing to change", which reads as success and hides the reason.
  // All-or-nothing per call — `adjustStock`'s atomicity is what the ledger's compensation
  // guarantees, and partially applying would make "what actually landed" a long question.
  if (conflicts.length > 0) {
    const shown = conflicts.slice(0, 5).join('; ');
    const more = conflicts.length > 5 ? ` …and ${conflicts.length - 5} more` : '';
    throw conflict(
      'The stock moved while you were editing, so NOTHING was corrected. Reload and check the ' +
        `figures: ${shown}${more}`,
    );
  }

  if (movementLines.length === 0) {
    throw badRequest('Nothing to change — every figure already matches the current stock');
  }

  // No document to key replays on, so each request gets its own reference id. The "already matches"
  // check above is what actually protects against a double submit.
  const refId = String(new Types.ObjectId());

  // `applyStockMovements` writes the activity log itself (`stock_moved`, carrying the reason and
  // every line), so there is nothing to add here.
  const result = await applyStockMovements(movementLines, {
    refType: 'adjustment',
    refId,
    actorId,
    reason: input.reason,
  });

  return {
    warehouseId: input.warehouseId,
    adjustedProducts: new Set(changes.map((c) => c.productId)).size,
    movements: result.movementIds.length,
    changes,
  };
}
