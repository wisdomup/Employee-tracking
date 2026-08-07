import { Types } from 'mongoose';
import { DamageClaimModel } from '../../models/damage-claim.model';
import { ProductModel } from '../../models/product.model';
import { DealerModel } from '../../models/dealer.model';
import { badRequest, forbidden, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  applyStockMovements,
  findPostedMovementIds,
  StockMovementLine,
} from './stock-ledger.service';
import { allocateNextDocumentNo } from './warehouse-counters';
import { resolveWarehouseScope, assertWarehouseAccess } from './warehouse-scope';
import { notifyDamageClaimPending } from './warehouse-notifications';

/**
 * Damaged / claimed stock (spec §7).
 *
 * The sequence matters and is the whole point of the feature: staff record what they found, an admin
 * approves, and ONLY then do pieces move from Sellable to Damaged/Claim. A rejection changes nothing.
 * That keeps a write-off — the one operation that makes stock disappear without a sale — behind a
 * second pair of eyes.
 */

interface DamageClaimInput {
  warehouseId?: string;
  source: 'internal_damage' | 'client_claim';
  clientName?: string;
  dealerId?: string;
  reason: string;
  products: { productId: string; quantity: number }[];
}

export async function createDamageClaim(
  data: DamageClaimInput,
  actor: { userId: string; role: string },
) {
  const scope = await resolveWarehouseScope(actor.userId, actor.role);
  const warehouseId = scope ? String(scope) : data.warehouseId;
  if (!warehouseId) throw badRequest('Choose the warehouse the stock is at');
  if (scope && data.warehouseId && String(scope) !== data.warehouseId) {
    throw forbidden('You can only raise entries for your own warehouse');
  }

  if (data.source === 'client_claim' && !data.clientName?.trim()) {
    // Without the client, the damage/claim report can't answer "who returned it" — which is the
    // one thing a claim is for.
    throw badRequest('A client claim needs the client name');
  }

  const productIds = data.products.map((p) => p.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('The same product appears on more than one line — combine them into one');
  }
  const found = await ProductModel.find({ _id: { $in: productIds }, isTrashed: { $ne: true } })
    .select('_id')
    .lean();
  if (found.length !== productIds.length) throw notFound('One or more products could not be found');

  if (data.dealerId) {
    const dealer = await DealerModel.findOne({ _id: data.dealerId, isTrashed: { $ne: true } })
      .select('_id')
      .lean();
    if (!dealer) throw notFound('Client not found');
  }

  const claim = await DamageClaimModel.create({
    documentNo: await allocateNextDocumentNo('damageClaimNo'),
    warehouseId: new Types.ObjectId(warehouseId),
    products: data.products.map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
    })),
    source: data.source,
    ...(data.clientName?.trim() ? { clientName: data.clientName.trim() } : {}),
    ...(data.dealerId ? { dealerId: new Types.ObjectId(data.dealerId) } : {}),
    reason: data.reason,
    status: 'pending',
    createdBy: new Types.ObjectId(actor.userId),
  });

  logActivityAsync({
    employeeId: actor.userId,
    module: 'damage_claim',
    entityId: String(claim._id),
    action: 'created',
    meta: {
      documentNo: claim.documentNo,
      warehouseId,
      source: data.source,
      clientName: data.clientName,
      // No stock moved — that is the defining property of a pending entry.
      stockMoved: false,
    },
  });

  notifyDamageClaimPending({
    _id: claim._id,
    documentNo: claim.documentNo,
    warehouseId: claim.warehouseId,
    source: claim.source,
    clientName: claim.clientName,
    totalPieces: data.products.reduce((sum, p) => sum + p.quantity, 0),
  });

  return findDamageClaimById(String(claim._id));
}

export interface DamageClaimFilters {
  status?: string;
  source?: string;
  warehouseId?: string;
  productId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export async function findAllDamageClaims(
  filters: DamageClaimFilters,
  viewer: { userId: string; role: string },
) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  const scope = await resolveWarehouseScope(viewer.userId, viewer.role);
  if (scope !== null) query.warehouseId = scope;
  else if (filters.warehouseId) query.warehouseId = new Types.ObjectId(filters.warehouseId);

  if (filters.status) query.status = filters.status;
  if (filters.source) query.source = filters.source;
  if (filters.productId) query['products.productId'] = new Types.ObjectId(filters.productId);
  if (filters.search) query.clientName = { $regex: filters.search, $options: 'i' };

  if (filters.startDate || filters.endDate) {
    const range: Record<string, Date> = {};
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      start.setUTCHours(0, 0, 0, 0);
      range.$gte = start;
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setUTCHours(23, 59, 59, 999);
      range.$lte = end;
    }
    query.createdAt = range;
  }

  return DamageClaimModel.find(query)
    .populate('warehouseId', 'name city isMain')
    .populate('products.productId', 'name barcode')
    .populate('dealerId', 'name shopName phone')
    .populate('createdBy', 'username fullName userID')
    .populate('approvedBy', 'username fullName userID')
    .populate('rejectedBy', 'username fullName userID')
    .populate('cancelledBy', 'username fullName userID')
    .sort({ createdAt: -1 })
    .lean();
}

export async function findDamageClaimById(id: string) {
  const claim = await DamageClaimModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('warehouseId', 'name city address isMain')
    .populate('products.productId', 'name barcode')
    .populate('dealerId', 'name shopName phone')
    .populate('createdBy', 'username fullName userID')
    .populate('approvedBy', 'username fullName userID')
    .populate('rejectedBy', 'username fullName userID')
    .populate('cancelledBy', 'username fullName userID')
    .lean();
  if (!claim) throw notFound('Damage / claim entry not found');
  return claim;
}

/**
 * Approve: move the quantity from Sellable to Damaged/Claim at that warehouse.
 *
 * The two legs are one ledger call, so the total (sellable + damaged) is conserved or nothing
 * happens at all — a partial application would quietly destroy pieces.
 */
export async function approveDamageClaim(id: string, actorId: string) {
  const claim = await DamageClaimModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!claim) throw notFound('Damage / claim entry not found');
  if (claim.status !== 'pending') {
    throw badRequest(`Only a pending entry can be approved. This one is "${claim.status}".`);
  }

  // Approval is the only control on a write-off: raising an entry for 500 pieces and approving it
  // yourself would be a straight route to making stock disappear.
  if (String(claim.createdBy) === actorId) {
    throw forbidden('You cannot approve an entry you created — ask another admin');
  }

  const claimed = await DamageClaimModel.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'approved', approvedBy: new Types.ObjectId(actorId), approvedAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw badRequest('This entry was already actioned by someone else');

  const lines: StockMovementLine[] = [];
  claim.products.forEach((line, index) => {
    lines.push({
      warehouseId: String(claim.warehouseId),
      productId: String(line.productId),
      bucket: 'sellable',
      delta: -line.quantity,
      type: 'damage_marked',
      refLine: index,
    });
    lines.push({
      warehouseId: String(claim.warehouseId),
      productId: String(line.productId),
      bucket: 'damaged',
      delta: line.quantity,
      type: 'damage_marked',
      refLine: index,
    });
  });

  try {
    await applyStockMovements(lines, {
      refType: 'damage_claim',
      refId: id,
      actorId,
      reason: claim.reason,
      idempotencyScope: 'approve',
    });
  } catch (err) {
    // Not enough sellable stock: leave the entry pending so it can be approved once stock arrives.
    await DamageClaimModel.updateOne(
      { _id: id },
      { $set: { status: 'pending' }, $unset: { approvedBy: '', approvedAt: '' } },
    );
    throw err;
  }

  logActivityAsync({
    employeeId: actorId,
    module: 'damage_claim',
    entityId: id,
    action: 'approved',
    changes: { status: { from: 'pending', to: 'approved' } },
    meta: { documentNo: claim.documentNo, source: claim.source, clientName: claim.clientName },
  });

  return findDamageClaimById(id);
}

/** Reject: nothing changes, by design (spec §7 step 4). */
export async function rejectDamageClaim(id: string, reason: string, actorId: string) {
  const claim = await DamageClaimModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!claim) throw notFound('Damage / claim entry not found');
  if (claim.status !== 'pending') {
    throw badRequest(`Only a pending entry can be rejected. This one is "${claim.status}".`);
  }

  claim.status = 'rejected';
  claim.rejectedBy = new Types.ObjectId(actorId);
  claim.rejectedAt = new Date();
  claim.rejectionReason = reason;
  await claim.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'damage_claim',
    entityId: id,
    action: 'rejected',
    changes: { status: { from: 'pending', to: 'rejected' } },
    meta: { documentNo: claim.documentNo, reason, stockMoved: false },
  });

  return findDamageClaimById(id);
}

/** Cancel with a reason. If it was already approved, the write-off is reversed. */
export async function cancelDamageClaim(id: string, reason: string, actorId: string) {
  const claim = await DamageClaimModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!claim) throw notFound('Damage / claim entry not found');
  if (claim.status === 'cancelled') throw badRequest('This entry has already been cancelled');

  // An entry auto-created alongside a damage-type return is born approved but never posted a
  // movement of its own — the return credited the damaged bucket directly. Reversing it would
  // invent sellable pieces out of nothing, so the correction belongs on the return.
  if (claim.linkedReturnId) {
    throw badRequest(
      'This entry mirrors a damage return and holds no stock of its own. Correct the return instead.',
    );
  }

  const posted = await findPostedMovementIds('damage_claim', id, ['damage_marked']);

  if (claim.status === 'approved' && posted.size > 0) {
    const lines: StockMovementLine[] = [];
    claim.products.forEach((line, index) => {
      lines.push({
        warehouseId: String(claim.warehouseId),
        productId: String(line.productId),
        bucket: 'damaged',
        delta: -line.quantity,
        type: 'damage_reversal',
        refLine: index,
      });
      lines.push({
        warehouseId: String(claim.warehouseId),
        productId: String(line.productId),
        bucket: 'sellable',
        delta: line.quantity,
        type: 'damage_reversal',
        refLine: index,
      });
    });

    await applyStockMovements(lines, {
      refType: 'damage_claim',
      refId: id,
      actorId,
      reason,
      idempotencyScope: 'cancel',
    });
  }

  const previousStatus = claim.status;
  claim.status = 'cancelled';
  claim.cancelledBy = new Types.ObjectId(actorId);
  claim.cancelledAt = new Date();
  claim.cancelReason = reason;
  await claim.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'damage_claim',
    entityId: id,
    action: 'cancelled',
    changes: { status: { from: previousStatus, to: 'cancelled' } },
    meta: { documentNo: claim.documentNo, reason },
  });

  return findDamageClaimById(id);
}

/** Printable damage / claim slip. */
export async function getDamageClaimSlip(id: string, viewer: { userId: string; role: string }) {
  const claim = (await findDamageClaimById(id)) as unknown as {
    documentNo?: number;
    createdAt: Date;
    status: string;
    source: string;
    clientName?: string;
    reason: string;
    rejectionReason?: string;
    cancelReason?: string;
    approvedAt?: Date;
    warehouseId?: { _id: unknown; name: string; city?: string };
    createdBy?: { fullName?: string; username?: string };
    approvedBy?: { fullName?: string; username?: string };
    dealerId?: { name?: string; shopName?: string };
    products: { productId?: { name: string; barcode: string }; quantity: number }[];
  };

  await assertWarehouseAccess(viewer.userId, viewer.role, String(claim.warehouseId?._id));

  return {
    kind: 'damage' as const,
    documentNo: claim.documentNo ?? null,
    entryDate: claim.createdAt,
    status: claim.status,
    source: claim.source,
    clientName: claim.clientName ?? claim.dealerId?.shopName ?? claim.dealerId?.name ?? null,
    warehouseName: claim.warehouseId?.name ?? '',
    reason: claim.reason,
    rejectionReason: claim.rejectionReason ?? null,
    cancelReason: claim.cancelReason ?? null,
    raisedBy: claim.createdBy?.fullName || claim.createdBy?.username || '',
    approvedByName: claim.approvedBy?.fullName || claim.approvedBy?.username || null,
    approvedAt: claim.approvedAt ?? null,
    totalPieces: claim.products.reduce((sum, p) => sum + p.quantity, 0),
    lines: claim.products.map((p) => ({
      productName: p.productId?.name ?? '',
      barcode: p.productId?.barcode ?? '',
      quantity: p.quantity,
    })),
  };
}
