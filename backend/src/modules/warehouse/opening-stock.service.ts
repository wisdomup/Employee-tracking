import { Types } from 'mongoose';
import { OpeningStockModel } from '../../models/opening-stock.model';
import { badRequest, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  applyStockMovements,
  findPostedMovementIds,
  StockMovementLine,
} from './stock-ledger.service';

/**
 * One-time starting stock (spec §11): "when the module goes live, existing physical stock is
 * entered once — per warehouse, per product, split as Sellable / Damaged / Claim, with quantity
 * and rate".
 *
 * The rate matters: opening stock is stock you paid for, so it seeds the weighted-average cost.
 * Both the sellable and the damaged pieces are weighted — damage is a value writedown reported
 * separately, not a change to what the goods cost.
 *
 * "One-time" is enforced by a unique partial index on posted rows. A wrong entry is cancelled
 * (which reverses the movement and frees the slot), never edited.
 */

interface OpeningStockLineInput {
  productId: string;
  sellableQty: number;
  damagedQty?: number;
  rate?: number;
}

export async function postOpeningStock(
  data: { warehouseId: string; effectiveAt?: Date; lines: OpeningStockLineInput[] },
  userId: string,
) {
  const effectiveAt = data.effectiveAt ?? new Date();

  const usable = data.lines.filter(
    (l) => (l.sellableQty ?? 0) > 0 || (l.damagedQty ?? 0) > 0,
  );
  if (usable.length === 0) {
    throw badRequest('Enter a quantity for at least one product');
  }

  const productIds = usable.map((l) => l.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('The same product appears more than once');
  }

  const alreadyPosted = await OpeningStockModel.find({
    warehouseId: data.warehouseId,
    productId: { $in: productIds },
    status: 'posted',
  })
    .populate('productId', 'name')
    .lean();

  if (alreadyPosted.length > 0) {
    const names = alreadyPosted
      .map((r) => (r.productId as unknown as { name?: string })?.name ?? String(r.productId))
      .join(', ');
    throw badRequest(
      `Opening stock has already been entered at this warehouse for: ${names}. Cancel those entries first, or use Stock In.`,
    );
  }

  // Write the documents first so each has an id to hang its movements off, then move the stock in
  // ONE call — a failure part-way through leaves no stock applied.
  const docs = await OpeningStockModel.create(
    usable.map((l) => ({
      warehouseId: new Types.ObjectId(data.warehouseId),
      productId: new Types.ObjectId(l.productId),
      sellableQty: l.sellableQty ?? 0,
      damagedQty: l.damagedQty ?? 0,
      rate: l.rate ?? 0,
      effectiveAt,
      status: 'posted',
      createdBy: new Types.ObjectId(userId),
    })),
  );

  const lines: StockMovementLine[] = [];
  docs.forEach((doc, index) => {
    if (doc.sellableQty > 0) {
      lines.push({
        warehouseId: data.warehouseId,
        productId: String(doc.productId),
        bucket: 'sellable',
        delta: doc.sellableQty,
        type: 'opening_stock',
        ...(doc.rate > 0 ? { unitCost: doc.rate } : {}),
        refLine: index * 2,
      });
    }
    if (doc.damagedQty > 0) {
      lines.push({
        warehouseId: data.warehouseId,
        productId: String(doc.productId),
        bucket: 'damaged',
        delta: doc.damagedQty,
        type: 'opening_stock',
        ...(doc.rate > 0 ? { unitCost: doc.rate } : {}),
        refLine: index * 2 + 1,
      });
    }
  });

  try {
    await applyStockMovements(lines, {
      refType: 'opening_stock',
      refId: String(data.warehouseId),
      actorId: userId,
      occurredAt: effectiveAt,
      idempotencyScope: String(docs[0]._id),
    });
  } catch (err) {
    await OpeningStockModel.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
    throw err;
  }

  logActivityAsync({
    employeeId: userId,
    module: 'opening_stock',
    entityId: String(data.warehouseId),
    action: 'created',
    meta: { warehouseId: data.warehouseId, lines: docs.length },
  });

  return { message: `Opening stock posted for ${docs.length} product(s)`, count: docs.length };
}

export async function findAllOpeningStock(filters: { warehouseId?: string; status?: string } = {}) {
  const query: Record<string, unknown> = {};
  if (filters.warehouseId) query.warehouseId = new Types.ObjectId(filters.warehouseId);
  query.status = filters.status ?? 'posted';

  return OpeningStockModel.find(query)
    .populate('warehouseId', 'name city isMain')
    .populate('productId', 'name barcode')
    .populate('createdBy', 'username fullName userID')
    .sort({ createdAt: -1 })
    .lean();
}

/** Has this warehouse had its opening stock entered? Drives the locked state on the setup screen. */
export async function getOpeningStockStatus(warehouseId: string) {
  const posted = await OpeningStockModel.find({ warehouseId, status: 'posted' })
    .select('createdAt createdBy productId')
    .populate('createdBy', 'username fullName userID')
    .sort({ createdAt: 1 })
    .lean();

  return {
    warehouseId,
    locked: posted.length > 0,
    productCount: posted.length,
    submittedAt: posted[0]?.createdAt ?? null,
    submittedBy: posted[0]?.createdBy ?? null,
    /** Products already covered — the setup screen greys these rows out. */
    postedProductIds: posted.map((p) => String(p.productId)),
  };
}

/** Cancel an opening-stock entry: reverse the movement and free the one-time slot. */
export async function cancelOpeningStock(id: string, reason: string, actorId: string) {
  const doc = await OpeningStockModel.findById(id);
  if (!doc) throw notFound('Opening stock entry not found');
  if (doc.status === 'cancelled') throw badRequest('This entry has already been cancelled');

  // Opening stock is cost-bearing, so each reversing line has to name the row it undoes — otherwise
  // the cancelled rate keeps weighting the product's average cost.
  const posted = await findPostedMovementIds('opening_stock', String(doc._id), ['opening_stock']);
  const productId = String(doc.productId);

  const lines: StockMovementLine[] = [];
  if (doc.sellableQty > 0) {
    lines.push({
      warehouseId: String(doc.warehouseId),
      productId,
      bucket: 'sellable',
      delta: -doc.sellableQty,
      type: 'manual_adjustment',
      ...(posted.get(`${productId}:sellable`)
        ? { reversalOf: posted.get(`${productId}:sellable`) }
        : {}),
      refLine: 0,
    });
  }
  if (doc.damagedQty > 0) {
    lines.push({
      warehouseId: String(doc.warehouseId),
      productId,
      bucket: 'damaged',
      delta: -doc.damagedQty,
      type: 'manual_adjustment',
      ...(posted.get(`${productId}:damaged`)
        ? { reversalOf: posted.get(`${productId}:damaged`) }
        : {}),
      refLine: 1,
    });
  }

  if (lines.length > 0) {
    await applyStockMovements(lines, {
      refType: 'opening_stock',
      refId: String(doc._id),
      actorId,
      reason,
      idempotencyScope: 'cancel',
    });
  }

  doc.status = 'cancelled';
  doc.cancelledBy = new Types.ObjectId(actorId);
  doc.cancelledAt = new Date();
  doc.cancelReason = reason;
  await doc.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'opening_stock',
    entityId: String(doc._id),
    action: 'cancelled',
    meta: { warehouseId: String(doc.warehouseId), productId: String(doc.productId), reason },
  });

  return doc;
}
