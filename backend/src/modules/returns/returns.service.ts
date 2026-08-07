import { Types } from 'mongoose';
import { ReturnModel, IReturn } from '../../models/return.model';
import { DealerModel } from '../../models/dealer.model';
import { DamageClaimModel } from '../../models/damage-claim.model';
import { badRequest, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  applyStockMovements,
  StockMovementLine,
} from '../warehouse/stock-ledger.service';
import { resolveWarehouseForUser } from '../warehouse/warehouse-resolver';
import { allocateNextDocumentNo } from '../warehouse/warehouse-counters';

interface ReturnProductInput {
  productId: string;
  quantity: number;
  price: number;
}

/**
 * Which warehouse do returned goods come back into?
 *
 * Stamped on the document at create time so the credit lands where the goods physically went, not
 * wherever the person who raised it happens to be assigned months later.
 */
async function warehouseOfReturn(returnDoc: {
  warehouseId?: Types.ObjectId;
  createdBy: Types.ObjectId;
}): Promise<string> {
  if (returnDoc.warehouseId) return String(returnDoc.warehouseId);
  const resolved = await resolveWarehouseForUser(String(returnDoc.createdBy));
  return String(resolved.warehouseId);
}

/**
 * Credit a completed return back to warehouse stock.
 *
 * A plain `return` (nothing wrong with the goods) goes straight back to SELLABLE — spec §5. A
 * `damage` return credits the DAMAGED bucket instead, with no sellable leg, because the goods came
 * back from the client and were never in our sellable stock to begin with.
 *
 * Replaces a bare `bulkWrite($inc)` that had no guard, no audit trail and no idempotency: completing
 * a return twice used to credit the stock twice.
 */
async function creditReturnedStock(returnDoc: IReturn, actorId?: string) {
  if (!returnDoc.products.length) return;

  const warehouseId = await warehouseOfReturn(returnDoc);
  const isDamage = returnDoc.returnType === 'damage';

  const lines: StockMovementLine[] = returnDoc.products.map((p, index) => ({
    warehouseId,
    productId: String(p.productId),
    bucket: isDamage ? 'damaged' : 'sellable',
    delta: p.quantity || 0,
    type: isDamage ? 'damage_marked' : 'customer_return_in',
    refLine: index,
  }));

  await applyStockMovements(lines, {
    refType: 'return',
    refId: String(returnDoc._id),
    actorId,
    reason: returnDoc.returnReason,
    // Idempotent by document: `updateReturn` can pass through the completed branch more than once.
    idempotencyScope: 'complete',
  });

  if (isDamage) {
    await createLinkedDamageClaim(returnDoc, warehouseId, actorId);
  }
}

/**
 * A completed damage-type return is a client claim in everything but name, so it also creates an
 * already-approved `DamageClaim`. That is what makes the warehouse damage report complete — without
 * it, client damage would only ever appear in the returns module and never in the damage/claim
 * report the spec asks for (§14 report 4).
 */
async function createLinkedDamageClaim(
  returnDoc: IReturn,
  warehouseId: string,
  actorId?: string,
) {
  const existing = await DamageClaimModel.findOne({ linkedReturnId: returnDoc._id })
    .select('_id')
    .lean();
  if (existing) return;

  const dealer = await DealerModel.findById(returnDoc.dealerId).select('name shopName').lean();

  try {
    const claim = await DamageClaimModel.create({
      documentNo: await allocateNextDocumentNo('damageClaimNo'),
      warehouseId: new Types.ObjectId(warehouseId),
      products: returnDoc.products.map((p) => ({
        productId: p.productId,
        quantity: p.quantity,
      })),
      source: 'client_claim',
      clientName: dealer?.shopName || dealer?.name || 'Unknown client',
      dealerId: returnDoc.dealerId,
      linkedReturnId: returnDoc._id,
      reason: returnDoc.returnReason || 'Damaged goods returned by the client',
      // Already approved: the stock movement has just been applied by `creditReturnedStock`, so
      // leaving it pending would invite a second write-off of the same pieces.
      status: 'approved',
      ...(actorId
        ? { approvedBy: new Types.ObjectId(actorId), approvedAt: new Date() }
        : { approvedAt: new Date() }),
      createdBy: returnDoc.createdBy,
    });

    logActivityAsync({
      employeeId: actorId,
      module: 'damage_claim',
      entityId: String(claim._id),
      action: 'created',
      meta: {
        documentNo: claim.documentNo,
        source: 'client_claim',
        linkedReturnId: String(returnDoc._id),
        autoCreated: true,
      },
    });
  } catch (err) {
    // The stock has already moved and is recorded in the ledger; a missing claim document is a
    // reporting gap, not a stock error, so do not fail the return over it.
    console.error('Failed to create the damage claim linked to a return', err);
  }
}

export async function createReturn(
  data: {
    dealerId: string;
    returnType: 'return' | 'damage';
    products: ReturnProductInput[];
    invoiceImage?: string;
    amount?: number;
    returnReason?: string;
  },
  userId: string,
) {
  const { dealerId, products, ...rest } = data;

  // Stamped now so the credit lands where the goods actually go back in, even if the person who
  // raised it moves warehouse later.
  const resolved = await resolveWarehouseForUser(userId);

  const returnDoc = await ReturnModel.create({
    ...rest,
    dealerId: new Types.ObjectId(dealerId),
    products: products.map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      price: p.price,
    })),
    warehouseId: resolved.warehouseId,
    createdBy: new Types.ObjectId(userId),
  });

  if (returnDoc.status === 'completed') {
    await creditReturnedStock(returnDoc, userId);
  }

  logActivityAsync({
    employeeId: userId,
    module: 'return',
    entityId: String(returnDoc._id),
    action: 'created',
    meta: { returnType: returnDoc.returnType, status: returnDoc.status, productCount: returnDoc.products.length },
  });

  return returnDoc;
}

export async function findAll(filters?: {
  dealerId?: string;
  returnType?: string;
  status?: string;
  createdBy?: string;
}) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.dealerId) query.dealerId = new Types.ObjectId(filters.dealerId);
  if (filters?.returnType) query.returnType = filters.returnType;
  if (filters?.status) query.status = filters.status;
  if (filters?.createdBy) query.createdBy = new Types.ObjectId(filters.createdBy);

  return ReturnModel.find(query)
    .populate('dealerId')
    .populate('products.productId')
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const returnDoc = await ReturnModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('dealerId')
    .populate('products.productId')
    .populate('createdBy', '-password')
    .exec();

  if (!returnDoc) {
    throw notFound('Return not found');
  }

  return returnDoc;
}

export async function updateReturn(id: string, data: Record<string, unknown>, actorId?: string) {
  const returnDoc = await ReturnModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!returnDoc) {
    throw notFound('Return not found');
  }

  if (returnDoc.status === 'completed') {
    throw badRequest('Completed returns are locked and cannot be edited');
  }

  const previousStatus = returnDoc.status;
  const nextStatus = typeof data.status === 'string' ? data.status : undefined;

  if (data.dealerId) data.dealerId = new Types.ObjectId(data.dealerId as string);

  if (Array.isArray(data.products)) {
    data.products = (data.products as ReturnProductInput[]).map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      price: p.price,
    }));
  }

  Object.assign(returnDoc, data);
  await returnDoc.save();

  // A `damage` return now credits the DAMAGED bucket and mints a linked client-claim entry, where
  // before it changed no stock at all and only showed up in reports.
  if (nextStatus === 'completed') {
    await creditReturnedStock(returnDoc, actorId);
  }

  const statusChanged = nextStatus !== undefined && previousStatus !== nextStatus;
  logActivityAsync({
    employeeId: actorId,
    module: 'return',
    entityId: String(returnDoc._id),
    action: statusChanged ? 'status_changed' : 'updated',
    changes: statusChanged ? { status: { from: previousStatus, to: nextStatus } } : undefined,
    meta: { returnType: returnDoc.returnType, status: returnDoc.status },
  });

  return returnDoc;
}

export async function deleteReturn(id: string, actorId?: string) {
  const returnDoc = await ReturnModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!returnDoc) {
    throw notFound('Return not found');
  }

  returnDoc.isTrashed = true;
  returnDoc.trashedAt = new Date();
  returnDoc.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await returnDoc.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'return',
    entityId: String(returnDoc._id),
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { returnType: returnDoc.returnType, status: returnDoc.status },
  });

  return { message: 'Return moved to trash successfully' };
}

export async function restoreReturn(id: string, actorId?: string) {
  const returnDoc = await ReturnModel.findOne({ _id: id, isTrashed: true });
  if (!returnDoc) throw notFound('Return not found in trash');
  returnDoc.isTrashed = false;
  returnDoc.trashedAt = undefined;
  returnDoc.trashedBy = undefined;
  await returnDoc.save();
  logActivityAsync({
    employeeId: actorId,
    module: 'return',
    entityId: String(returnDoc._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { returnType: returnDoc.returnType, status: returnDoc.status },
  });
  return returnDoc;
}

export async function permanentlyDeleteReturn(id: string, actorId?: string) {
  const returnDoc = await ReturnModel.findOne({ _id: id, isTrashed: true });
  if (!returnDoc) throw notFound('Return not found in trash');
  await ReturnModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'return',
    entityId: String(returnDoc._id),
    action: 'deleted',
    meta: { returnType: returnDoc.returnType, status: returnDoc.status, permanent: true },
  });
  return { message: 'Return permanently deleted successfully' };
}
