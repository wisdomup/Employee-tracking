import { Types } from 'mongoose';
import { StockTransferModel, IStockTransfer } from '../../models/stock-transfer.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { ProductModel } from '../../models/product.model';
import { badRequest, forbidden, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  postTransferOut,
  postTransferIn,
  postTransferReturned,
} from '../finance/inventory-posting.service';
import { applyStockMovements, StockMovementLine, getStockBalance } from './stock-ledger.service';
import { allocateNextDocumentNo } from './warehouse-counters';
import {
  resolveWarehouseScope,
  assertWarehouseAccessEither,
  assertWarehouseAccess,
} from './warehouse-scope';
import {
  notifyTransferPending,
  notifyTransferApproved,
  notifyTransferMismatch,
} from './warehouse-notifications';

/**
 * Moving stock between warehouses (spec §8).
 *
 * The one design decision worth restating: **stock leaves the source at APPROVAL, into the source's
 * own `inTransit` bucket** — not at receipt. Between approval and arrival the goods are on a truck
 * and must not be sellable anywhere. If the source only decremented at receipt, an order routed
 * there could consume pieces that had physically gone.
 *
 * A shortfall is never absorbed silently: only what arrived is credited, and the difference stays
 * parked in the source's `inTransit` bucket until an admin writes it off or returns it, which makes
 * unresolved losses a queryable list rather than a rounding error.
 */

interface TransferLineInput {
  productId: string;
  sentQty: number;
}

/** Guard: only these statuses may still be edited or acted on in the given way. */
function assertStatus(transfer: IStockTransfer, allowed: string[], action: string) {
  if (!allowed.includes(transfer.status)) {
    throw badRequest(
      `Cannot ${action} a transfer that is "${transfer.status}". Allowed from: ${allowed.join(', ')}.`,
    );
  }
}

export async function createTransfer(
  data: { fromWarehouseId?: string; toWarehouseId: string; notes?: string; products: TransferLineInput[] },
  actor: { userId: string; role: string },
) {
  const scope = await resolveWarehouseScope(actor.userId, actor.role);

  // A scoped caller always sends from their own warehouse; an admin must say which.
  const fromWarehouseId = scope ? String(scope) : data.fromWarehouseId;
  if (!fromWarehouseId) {
    throw badRequest('Choose the warehouse the stock is coming from');
  }
  if (scope && data.fromWarehouseId && String(scope) !== data.fromWarehouseId) {
    throw forbidden('You can only send stock from your own warehouse');
  }

  if (fromWarehouseId === data.toWarehouseId) {
    // Both legs would hit the same balance document; there is also no business meaning to it.
    throw badRequest('The source and destination warehouses must be different');
  }

  const warehouses = await WarehouseModel.find({
    _id: { $in: [fromWarehouseId, data.toWarehouseId] },
    isTrashed: { $ne: true },
  })
    .select('_id name isActive')
    .lean();
  if (warehouses.length !== 2) throw notFound('One or both warehouses could not be found');
  const inactive = warehouses.find((w) => w.isActive === false);
  if (inactive) throw badRequest(`Warehouse "${inactive.name}" is inactive`);

  const productIds = data.products.map((p) => p.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw badRequest('The same product appears on more than one line — combine them into one');
  }
  const found = await ProductModel.find({ _id: { $in: productIds }, isTrashed: { $ne: true } })
    .select('_id name')
    .lean();
  if (found.length !== productIds.length) throw notFound('One or more products could not be found');

  // Check availability now so the sender sees the problem immediately, even though nothing moves
  // until approval. The authoritative guard is the ledger at approval time.
  for (const line of data.products) {
    const balance = await getStockBalance(fromWarehouseId, line.productId);
    if (line.sentQty > balance.sellable) {
      const name = found.find((p) => String(p._id) === line.productId)?.name ?? line.productId;
      throw badRequest(
        `Not enough sellable stock for "${name}" at the sending warehouse. Available: ${balance.sellable}, requested: ${line.sentQty}.`,
      );
    }
  }

  const transfer = await StockTransferModel.create({
    documentNo: await allocateNextDocumentNo('stockTransferNo'),
    fromWarehouseId: new Types.ObjectId(fromWarehouseId),
    toWarehouseId: new Types.ObjectId(data.toWarehouseId),
    products: data.products.map((p) => ({
      productId: new Types.ObjectId(p.productId),
      sentQty: p.sentQty,
    })),
    status: 'pending',
    notes: data.notes,
    createdBy: new Types.ObjectId(actor.userId),
  });

  logActivityAsync({
    employeeId: actor.userId,
    module: 'stock_transfer',
    entityId: String(transfer._id),
    action: 'created',
    meta: {
      documentNo: transfer.documentNo,
      fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      lines: data.products.length,
    },
  });

  notifyTransferPending(transfer);

  return findTransferById(String(transfer._id));
}

export interface TransferFilters {
  status?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  startDate?: string;
  endDate?: string;
  hasMismatch?: string;
}

export async function findAllTransfers(
  filters: TransferFilters,
  viewer: { userId: string; role: string },
) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  const scope = await resolveWarehouseScope(viewer.userId, viewer.role);
  if (scope !== null) {
    // Visible from EITHER end: a receiving storekeeper needs to see an inbound transfer they did
    // not create.
    query.$or = [{ fromWarehouseId: scope }, { toWarehouseId: scope }];
  }

  if (filters.status) query.status = filters.status;
  if (filters.fromWarehouseId) query.fromWarehouseId = new Types.ObjectId(filters.fromWarehouseId);
  if (filters.toWarehouseId) query.toWarehouseId = new Types.ObjectId(filters.toWarehouseId);
  if (filters.hasMismatch === 'true') query.status = 'mismatch';

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

  return StockTransferModel.find(query)
    .populate('fromWarehouseId', 'name city isMain')
    .populate('toWarehouseId', 'name city isMain')
    .populate('products.productId', 'name barcode')
    .populate('createdBy', 'username fullName userID')
    .populate('approvedBy', 'username fullName userID')
    .populate('receivedBy', 'username fullName userID')
    .populate('rejectedBy', 'username fullName userID')
    .populate('cancelledBy', 'username fullName userID')
    .populate('mismatchResolvedBy', 'username fullName userID')
    .sort({ createdAt: -1 })
    .lean();
}

export async function findTransferById(id: string) {
  const transfer = await StockTransferModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('fromWarehouseId', 'name city address isMain')
    .populate('toWarehouseId', 'name city address isMain')
    .populate('products.productId', 'name barcode')
    .populate('createdBy', 'username fullName userID')
    .populate('approvedBy', 'username fullName userID')
    .populate('receivedBy', 'username fullName userID')
    .populate('rejectedBy', 'username fullName userID')
    .populate('cancelledBy', 'username fullName userID')
    .populate('mismatchResolvedBy', 'username fullName userID')
    .lean();
  if (!transfer) throw notFound('Transfer not found');
  return transfer;
}

/**
 * Admin approval. Stock leaves the source here: `sellable −q` and `inTransit +q`, one guarded pair
 * per line, all in a single ledger call so a shortfall on one line applies nothing at all.
 *
 * The status flip is a compare-and-set inside the same query, not a read-then-write, so two
 * simultaneous approvals cannot both move stock.
 */
export async function approveTransfer(id: string, actorId: string) {
  const transfer = await StockTransferModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!transfer) throw notFound('Transfer not found');
  assertStatus(transfer, ['pending'], 'approve');

  // Approval is the only control on stock leaving a warehouse — the person who raised it must not
  // also be the person who waves it through.
  if (String(transfer.createdBy) === actorId) {
    throw forbidden('You cannot approve a transfer you created — ask another admin');
  }

  const claimed = await StockTransferModel.findOneAndUpdate(
    { _id: id, status: 'pending' },
    {
      $set: {
        status: 'approved',
        approvedBy: new Types.ObjectId(actorId),
        approvedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!claimed) throw badRequest('This transfer was already actioned by someone else');

  const lines: StockMovementLine[] = [];
  transfer.products.forEach((line, index) => {
    lines.push({
      warehouseId: String(transfer.fromWarehouseId),
      productId: String(line.productId),
      bucket: 'sellable',
      delta: -line.sentQty,
      type: 'transfer_out',
      refLine: index,
    });
    lines.push({
      warehouseId: String(transfer.fromWarehouseId),
      productId: String(line.productId),
      bucket: 'in_transit',
      delta: line.sentQty,
      type: 'transfer_out',
      refLine: index,
    });
  });

  try {
    await applyStockMovements(lines, {
      refType: 'transfer',
      refId: String(transfer._id),
      actorId,
      idempotencyScope: 'approve',
    });
  } catch (err) {
    // Put the transfer back so it can be approved again once the stock is there.
    await StockTransferModel.updateOne(
      { _id: id },
      { $set: { status: 'pending' }, $unset: { approvedBy: '', approvedAt: '' } },
    );
    throw err;
  }

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_transfer',
    entityId: id,
    action: 'approved',
    changes: { status: { from: 'pending', to: 'approved' } },
    meta: { documentNo: transfer.documentNo },
  });

  notifyTransferApproved(transfer);

  // Stock left the source warehouse and is now in transit.
  await postTransferOut(id, actorId);

  return findTransferById(id);
}

export async function rejectTransfer(id: string, reason: string, actorId: string) {
  const transfer = await StockTransferModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!transfer) throw notFound('Transfer not found');
  assertStatus(transfer, ['pending'], 'reject');

  // No stock has moved yet, so rejection is purely a status change.
  transfer.status = 'rejected';
  transfer.rejectedBy = new Types.ObjectId(actorId);
  transfer.rejectedAt = new Date();
  transfer.rejectionReason = reason;
  await transfer.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_transfer',
    entityId: id,
    action: 'rejected',
    changes: { status: { from: 'pending', to: 'rejected' } },
    meta: { documentNo: transfer.documentNo, reason },
  });

  return findTransferById(id);
}

/**
 * The receiving warehouse confirms what actually arrived.
 *
 * Matching quantities complete the transfer. A shortfall flags it for admin review and credits ONLY
 * what arrived (spec §8, explicitly). An over-receipt is rejected outright — accepting it would
 * create stock from nothing; a genuine surplus is a counting error at the source, corrected by a
 * stock count, not by a transfer field.
 */
export async function receiveTransfer(
  id: string,
  lines: { productId: string; receivedQty: number; receiveNote?: string }[],
  actor: { userId: string; role: string },
) {
  const transfer = await StockTransferModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!transfer) throw notFound('Transfer not found');
  assertStatus(transfer, ['approved'], 'receive');

  // Only the destination (or an admin) may confirm receipt.
  await assertWarehouseAccess(actor.userId, actor.role, String(transfer.toWarehouseId));

  const sentByProduct = new Map(transfer.products.map((p) => [String(p.productId), p.sentQty]));

  for (const line of lines) {
    const sent = sentByProduct.get(line.productId);
    if (sent === undefined) {
      throw badRequest('A line was submitted for a product that is not on this transfer');
    }
    if (!Number.isInteger(line.receivedQty) || line.receivedQty < 0) {
      throw badRequest('Received quantities must be whole pieces, zero or more');
    }
    if (line.receivedQty > sent) {
      throw badRequest(
        'Received quantity cannot exceed the quantity sent. If more pieces genuinely arrived, ' +
          'correct it with a stock count at the receiving warehouse.',
      );
    }
  }

  const receivedByProduct = new Map(lines.map((l) => [l.productId, l.receivedQty]));
  // A line left out of the payload counts as nothing received, not as fully received.
  const resolved = transfer.products.map((p) => ({
    productId: String(p.productId),
    sentQty: p.sentQty,
    receivedQty: receivedByProduct.get(String(p.productId)) ?? 0,
    receiveNote: lines.find((l) => l.productId === String(p.productId))?.receiveNote,
  }));

  const shortfall = resolved.reduce((sum, r) => sum + (r.sentQty - r.receivedQty), 0);
  const nextStatus = shortfall === 0 ? 'completed' : 'mismatch';

  const claimed = await StockTransferModel.findOneAndUpdate(
    { _id: id, status: 'approved' },
    {
      $set: {
        status: nextStatus,
        receivedBy: new Types.ObjectId(actor.userId),
        receivedAt: new Date(),
        products: resolved.map((r) => ({
          productId: new Types.ObjectId(r.productId),
          sentQty: r.sentQty,
          receivedQty: r.receivedQty,
          ...(r.receiveNote ? { receiveNote: r.receiveNote } : {}),
        })),
      },
    },
    { new: true },
  );
  if (!claimed) throw badRequest('This transfer was already received by someone else');

  const movements: StockMovementLine[] = [];
  resolved.forEach((line, index) => {
    if (line.receivedQty <= 0) return;
    // Clear what arrived out of the source's in-transit bucket…
    movements.push({
      warehouseId: String(transfer.fromWarehouseId),
      productId: line.productId,
      bucket: 'in_transit',
      delta: -line.receivedQty,
      type: 'transfer_in',
      refLine: index,
    });
    // …and put it on the destination's shelf.
    movements.push({
      warehouseId: String(transfer.toWarehouseId),
      productId: line.productId,
      bucket: 'sellable',
      delta: line.receivedQty,
      type: 'transfer_in',
      refLine: index,
    });
  });

  if (movements.length > 0) {
    try {
      await applyStockMovements(movements, {
        refType: 'transfer',
        refId: id,
        actorId: actor.userId,
        idempotencyScope: 'receive',
      });
    } catch (err) {
      await StockTransferModel.updateOne(
        { _id: id },
        { $set: { status: 'approved' }, $unset: { receivedBy: '', receivedAt: '' } },
      );
      throw err;
    }
  }

  logActivityAsync({
    employeeId: actor.userId,
    module: 'stock_transfer',
    entityId: id,
    action: 'received',
    changes: { status: { from: 'approved', to: nextStatus } },
    meta: { documentNo: transfer.documentNo, shortfall },
  });

  if (shortfall > 0) {
    notifyTransferMismatch({
      _id: transfer._id,
      documentNo: transfer.documentNo,
      toWarehouseId: transfer.toWarehouseId,
      shortfall,
    });
  }

  // Received at the destination, plus any shortfall between sent and received.
  await postTransferIn(id, actor.userId);

  return findTransferById(id);
}

/**
 * Decide what happens to a shortfall still parked in the source's in-transit bucket.
 * `write_off` accepts the loss; `return_to_source` puts the pieces back on the source's shelf.
 */
export async function resolveTransferMismatch(
  id: string,
  resolution: 'write_off' | 'return_to_source',
  reason: string,
  actorId: string,
) {
  const transfer = await StockTransferModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!transfer) throw notFound('Transfer not found');
  assertStatus(transfer, ['mismatch'], 'resolve');

  const movements: StockMovementLine[] = [];
  transfer.products.forEach((line, index) => {
    const missing = line.sentQty - (line.receivedQty ?? 0);
    if (missing <= 0) return;

    movements.push({
      warehouseId: String(transfer.fromWarehouseId),
      productId: String(line.productId),
      bucket: 'in_transit',
      delta: -missing,
      type: resolution === 'write_off' ? 'transfer_shrinkage' : 'transfer_out_reversal',
      refLine: index,
    });

    if (resolution === 'return_to_source') {
      movements.push({
        warehouseId: String(transfer.fromWarehouseId),
        productId: String(line.productId),
        bucket: 'sellable',
        delta: missing,
        type: 'transfer_out_reversal',
        refLine: index,
      });
    }
  });

  if (movements.length > 0) {
    await applyStockMovements(movements, {
      refType: 'transfer',
      refId: id,
      actorId,
      reason,
      idempotencyScope: `resolve:${resolution}`,
    });
  }

  transfer.status = 'completed';
  transfer.mismatchResolution = resolution;
  transfer.mismatchResolutionNote = reason;
  transfer.mismatchResolvedBy = new Types.ObjectId(actorId);
  transfer.mismatchResolvedAt = new Date();
  await transfer.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_transfer',
    entityId: id,
    action: 'status_changed',
    changes: { status: { from: 'mismatch', to: 'completed' } },
    meta: { documentNo: transfer.documentNo, resolution, reason },
  });

  // Mismatch resolved: whatever never arrived leaves in-transit as a loss.
  await postTransferIn(id, actorId);

  return findTransferById(id);
}

/**
 * Cancel with a reason and reverse whatever was posted. Never a delete.
 *
 * Cancelling a completed transfer takes the goods back off the destination's shelf, which is guarded
 * — if the destination has already sold them the cancellation is refused rather than driving their
 * stock negative.
 */
export async function cancelTransfer(id: string, reason: string, actorId: string) {
  const transfer = await StockTransferModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!transfer) throw notFound('Transfer not found');
  assertStatus(transfer, ['pending', 'approved', 'completed', 'mismatch'], 'cancel');

  const movements: StockMovementLine[] = [];

  if (transfer.status === 'approved') {
    // In transit and untouched: put it all back on the source's shelf.
    transfer.products.forEach((line, index) => {
      movements.push({
        warehouseId: String(transfer.fromWarehouseId),
        productId: String(line.productId),
        bucket: 'in_transit',
        delta: -line.sentQty,
        type: 'transfer_out_reversal',
        refLine: index,
      });
      movements.push({
        warehouseId: String(transfer.fromWarehouseId),
        productId: String(line.productId),
        bucket: 'sellable',
        delta: line.sentQty,
        type: 'transfer_out_reversal',
        refLine: index,
      });
    });
  } else if (transfer.status === 'completed' || transfer.status === 'mismatch') {
    transfer.products.forEach((line, index) => {
      const received = line.receivedQty ?? 0;
      if (received > 0) {
        // Guarded: fails if the destination has already consumed the goods.
        movements.push({
          warehouseId: String(transfer.toWarehouseId),
          productId: String(line.productId),
          bucket: 'sellable',
          delta: -received,
          type: 'transfer_in_reversal',
          refLine: index,
        });
        movements.push({
          warehouseId: String(transfer.fromWarehouseId),
          productId: String(line.productId),
          bucket: 'sellable',
          delta: received,
          type: 'transfer_in_reversal',
          refLine: index,
        });
      }
      // Anything still sitting in transit (an unresolved shortfall) goes back too.
      const stillInTransit = line.sentQty - received;
      if (stillInTransit > 0 && transfer.status === 'mismatch') {
        movements.push({
          warehouseId: String(transfer.fromWarehouseId),
          productId: String(line.productId),
          bucket: 'in_transit',
          delta: -stillInTransit,
          type: 'transfer_out_reversal',
          refLine: index,
        });
        movements.push({
          warehouseId: String(transfer.fromWarehouseId),
          productId: String(line.productId),
          bucket: 'sellable',
          delta: stillInTransit,
          type: 'transfer_out_reversal',
          refLine: index,
        });
      }
    });
  }

  if (movements.length > 0) {
    await applyStockMovements(movements, {
      refType: 'transfer',
      refId: id,
      actorId,
      reason,
      idempotencyScope: 'cancel',
    });
  }

  const previousStatus = transfer.status;
  transfer.status = 'cancelled';
  transfer.cancelledBy = new Types.ObjectId(actorId);
  transfer.cancelledAt = new Date();
  transfer.cancelReason = reason;
  await transfer.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'stock_transfer',
    entityId: id,
    action: 'cancelled',
    changes: { status: { from: previousStatus, to: 'cancelled' } },
    meta: { documentNo: transfer.documentNo, reason },
  });

  // Nothing arrived, so the value comes back to the source shelf.
  await postTransferReturned(id, actorId);

  return findTransferById(id);
}

/** Printable transfer slip. */
export async function getTransferSlip(
  id: string,
  viewer: { userId: string; role: string },
) {
  const transfer = (await findTransferById(id)) as unknown as {
    documentNo?: number;
    createdAt: Date;
    status: string;
    notes?: string;
    cancelReason?: string;
    rejectionReason?: string;
    mismatchResolutionNote?: string;
    fromWarehouseId?: { _id: unknown; name: string; city?: string };
    toWarehouseId?: { _id: unknown; name: string; city?: string };
    createdBy?: { fullName?: string; username?: string };
    approvedBy?: { fullName?: string; username?: string };
    receivedBy?: { fullName?: string; username?: string };
    products: {
      productId?: { name: string; barcode: string };
      sentQty: number;
      receivedQty?: number;
    }[];
  };

  await assertWarehouseAccessEither(viewer.userId, viewer.role, [
    transfer.fromWarehouseId?._id as string,
    transfer.toWarehouseId?._id as string,
  ]);

  return {
    kind: 'transfer' as const,
    documentNo: transfer.documentNo ?? null,
    transferDate: transfer.createdAt,
    status: transfer.status,
    fromWarehouseName: transfer.fromWarehouseId?.name ?? '',
    toWarehouseName: transfer.toWarehouseId?.name ?? '',
    preparedBy: transfer.createdBy?.fullName || transfer.createdBy?.username || '',
    approvedByName: transfer.approvedBy?.fullName || transfer.approvedBy?.username || null,
    receivedByName: transfer.receivedBy?.fullName || transfer.receivedBy?.username || null,
    notes: transfer.notes ?? null,
    cancelReason: transfer.cancelReason ?? null,
    rejectionReason: transfer.rejectionReason ?? null,
    mismatchResolutionNote: transfer.mismatchResolutionNote ?? null,
    totalSent: transfer.products.reduce((sum, p) => sum + p.sentQty, 0),
    totalReceived: transfer.products.reduce((sum, p) => sum + (p.receivedQty ?? 0), 0),
    lines: transfer.products.map((p) => ({
      productName: p.productId?.name ?? '',
      barcode: p.productId?.barcode ?? '',
      sentQty: p.sentQty,
      receivedQty: p.receivedQty ?? null,
      difference: p.receivedQty === undefined ? null : p.sentQty - p.receivedQty,
    })),
  };
}
