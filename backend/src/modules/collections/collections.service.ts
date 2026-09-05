import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { notFound, badRequest, forbidden, conflict } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  normalizeCityKey,
  regionLabel,
  round2,
  UNASSIGNED_REGION_KEY,
  REPORT_TIMEZONE,
} from '../region-sales/region-sales.rules';
import {
  validateCollectionSplit,
  deriveOrderPaymentType,
  derivePaidAmount,
  CollectionSplit,
} from './collections.rules';
import { getRiderBalance, resolveDay, windowToUtc } from './collection-reports.service';
import {
  postCollectionCorrection,
  postCollectionVoid,
  postDelivery,
} from '../finance/sales-posting.service';

/**
 * Rider-facing delivery flow: the assigned order list, `packed`, and `delivered` + the
 * three-way collection split.
 *
 * NO STOCK MOVEMENT HAPPENS HERE, DELIBERATELY. Spec §4 says delivery "auto-deducts stock", and
 * it already has: `orders.service.createOrder` posts the `sale_out` movement at order-create
 * time (see `reserveWarehouseStock`). Adding a second deduction on delivery would double-deduct
 * every order. If you are reading this because the module looks like it is missing a call to
 * `applyStockMovements` — it is not. Leave it out.
 */

/** Statuses a rider is allowed to see on their own list. */
const RIDER_VISIBLE_STATUSES = ['approved', 'packed', 'dispatched', 'delivered'] as const;

export interface RiderCity {
  city: string;
  cityKey: string;
}

/**
 * The rider's city, refusing to proceed when there isn't one.
 *
 * `resolveCityScope` fails OPEN for a city-less user, which is right for narrowing a client list
 * and catastrophic for money: every entry would land in an untraceable "Unassigned" bucket and
 * spec §4's "strictly city-wise segregated, no mixing" would be quietly false. This is the
 * belt-and-braces check; the primary one is at assignment time in `orders.service`.
 */
export async function resolveRiderCity(riderId: string): Promise<RiderCity> {
  const rider = await UserModel.findOne({ _id: riderId, isTrashed: { $ne: true } })
    .select('_id fullName username address.city')
    .lean()
    .exec();

  if (!rider) throw notFound('Rider not found');

  const cityKey = normalizeCityKey(rider.address?.city);
  if (cityKey === UNASSIGNED_REGION_KEY) {
    const name = rider.fullName || rider.username;
    throw badRequest(
      `No city is set for ${name}. An admin must set a city before this rider can record collections.`,
    );
  }
  return { city: (rider.address!.city as string).trim(), cityKey };
}

/**
 * Refuse a collection whose shop is in a different city from the rider.
 *
 * A blank dealer city is tolerated — that is legacy data, not a cross-city delivery — and gets
 * recorded as '' so the mismatch is still visible in the data. A non-blank mismatch is a hard
 * error: §4 says "no mixing across cities", and a warning nobody reads is not segregation.
 */
function assertSameCity(
  dealer: { shopName?: string; name?: string; address?: { city?: string } },
  rider: RiderCity,
): string {
  const dealerCityKey = normalizeCityKey(dealer.address?.city);
  if (dealerCityKey !== UNASSIGNED_REGION_KEY && dealerCityKey !== rider.cityKey) {
    const shop = dealer.shopName || dealer.name || 'This client';
    throw badRequest(
      `"${shop}" is in ${regionLabel(dealer.address?.city)} but you work in ${rider.city}. ` +
        'Collections cannot cross cities — ask an admin to reassign this order.',
    );
  }
  return dealerCityKey;
}

/**
 * Turn a failed guarded update into the specific reason it failed.
 *
 * Worth the extra read: riders on bad connections tap twice constantly, and a generic 400 here
 * generates support tickets. Called only on the failure path.
 */
async function explainTransitionFailure(
  orderId: string,
  riderId: string,
  expectedStatus: string,
): Promise<never> {
  const order = await OrderModel.findById(orderId).select('status assignedRiderId isTrashed').lean();

  if (!order || order.isTrashed) throw notFound('Order not found');
  if (String(order.assignedRiderId ?? '') !== riderId) {
    throw forbidden('This order is not assigned to you.');
  }
  if (order.status === expectedStatus) {
    // The CAS matched nothing yet the state looks right — only reachable if another request won
    // the race between our update and this read.
    throw conflict('That order was just updated by another request. Pull to refresh and try again.');
  }
  if (expectedStatus === 'approved') {
    if (order.status === 'packed') throw conflict('This order is already marked packed.');
    if (order.status === 'delivered') throw conflict('This order has already been delivered.');
    if (order.status === 'cancelled') throw badRequest('This order has been cancelled.');
    throw badRequest(`This order is "${order.status}" and cannot be marked packed.`);
  }
  if (order.status === 'approved') throw badRequest('Mark the order packed before delivering it.');
  if (order.status === 'delivered') throw conflict('This order has already been delivered.');
  if (order.status === 'cancelled') throw badRequest('This order has been cancelled.');
  throw badRequest(`This order is "${order.status}" and cannot be delivered.`);
}

// ---------------------------------------------------------------------------
// §1-2 The rider's own list, grouped client-wise
// ---------------------------------------------------------------------------

export async function getRiderOrders(riderId: string, params: { date?: string; status?: string }) {
  const date = resolveDay(params.date);
  const { start, end } = windowToUtc(date, date);
  const rider = await UserModel.findById(riderId)
    .select('_id fullName username address.city')
    .lean()
    .exec();
  if (!rider) throw notFound('Rider not found');

  const statusFilter =
    params.status && (RIDER_VISIBLE_STATUSES as readonly string[]).includes(params.status)
      ? [params.status]
      : null;

  const match: Record<string, unknown> = {
    assignedRiderId: new Types.ObjectId(riderId),
    isTrashed: { $ne: true },
  };

  if (statusFilter) {
    match.status = { $in: statusFilter };
    // A day filter only makes sense for completed work; open orders roll over.
    if (statusFilter[0] === 'delivered') match.deliveredAt = { $gte: start, $lte: end };
  } else {
    // Open orders are NOT date-filtered: an order assigned on Tuesday and still sitting
    // undelivered on Wednesday is exactly the work the rider has to do today. Only delivered
    // orders are scoped to the requested day, so yesterday's completed work stops cluttering
    // the screen.
    match.$or = [
      { status: { $in: ['approved', 'packed', 'dispatched'] } },
      { status: 'delivered', deliveredAt: { $gte: start, $lte: end } },
    ];
  }

  const orders = await OrderModel.find(match)
    .select(
      '_id invoiceNumber status grandTotal totalPrice paidAmount orderDate deliveryDate products dealerId assignedAt packedAt deliveredAt',
    )
    .populate('dealerId', 'name shopName phone address latitude longitude')
    .sort({ assignedAt: 1, createdAt: 1 })
    .lean()
    .exec();

  const collections = await DeliveryCollectionModel.find({
    orderId: { $in: orders.map((o) => o._id) },
    voidedAt: { $exists: false },
  })
    .select('orderId cash online credit orderAmount deliveredAt')
    .lean()
    .exec();
  const collectionByOrder = new Map(collections.map((c) => [String(c.orderId), c]));

  // Group client-wise (spec §1). A rider works shop by shop, not order by order.
  const groups = new Map<
    string,
    { dealer: Record<string, unknown>; orders: Record<string, unknown>[]; totalAmount: number }
  >();

  for (const order of orders) {
    const dealer = order.dealerId as unknown as {
      _id: Types.ObjectId;
      name?: string;
      shopName?: string;
      phone?: string;
      address?: Record<string, unknown>;
      latitude?: number;
      longitude?: number;
    } | null;
    if (!dealer?._id) continue;

    const key = String(dealer._id);
    if (!groups.has(key)) {
      groups.set(key, {
        dealer: {
          _id: key,
          name: dealer.name ?? '',
          shopName: dealer.shopName ?? '',
          phone: dealer.phone ?? '',
          address: dealer.address ?? {},
          latitude: dealer.latitude ?? null,
          longitude: dealer.longitude ?? null,
          hasLocation: dealer.latitude != null && dealer.longitude != null,
        },
        orders: [],
        totalAmount: 0,
      });
    }

    const group = groups.get(key)!;
    const collection = collectionByOrder.get(String(order._id));
    group.orders.push({
      _id: String(order._id),
      invoiceNumber: order.invoiceNumber ?? null,
      status: order.status,
      grandTotal: round2(order.grandTotal ?? order.totalPrice ?? 0),
      paidAmount: order.paidAmount ?? 0,
      productCount: order.products?.length ?? 0,
      orderDate: order.orderDate ?? null,
      deliveryDate: order.deliveryDate ?? null,
      assignedAt: order.assignedAt ?? null,
      packedAt: order.packedAt ?? null,
      deliveredAt: order.deliveredAt ?? null,
      collection: collection
        ? {
            cash: round2(collection.cash),
            online: round2(collection.online),
            credit: round2(collection.credit),
          }
        : null,
    });
    group.totalAmount = round2(group.totalAmount + (order.grandTotal ?? 0));
  }

  const counts = {
    assigned: orders.length,
    packed: orders.filter((o) => o.status === 'packed').length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
    pending: orders.filter((o) => o.status !== 'delivered').length,
  };

  return {
    date,
    timezone: REPORT_TIMEZONE,
    rider: {
      id: String(rider._id),
      name: rider.fullName || rider.username,
      city: regionLabel(rider.address?.city),
      cityKey: normalizeCityKey(rider.address?.city),
    },
    counts,
    groups: [...groups.values()],
  };
}

// ---------------------------------------------------------------------------
// §3 Packed
// ---------------------------------------------------------------------------

export async function markPacked(orderId: string, riderId: string) {
  // Guarded compare-and-set: only the assigned rider, only from `approved`, only once.
  const order = await OrderModel.findOneAndUpdate(
    {
      _id: orderId,
      assignedRiderId: new Types.ObjectId(riderId),
      status: 'approved',
      isTrashed: { $ne: true },
    },
    { $set: { status: 'packed', packedAt: new Date() } },
    { new: true },
  );

  if (!order) await explainTransitionFailure(orderId, riderId, 'approved');

  logActivityAsync({
    employeeId: riderId,
    module: 'order',
    entityId: String(order!._id),
    action: 'status_changed',
    changes: { status: { from: 'approved', to: 'packed' } },
    meta: { status: 'packed', dealerId: String(order!.dealerId) },
  });

  return order!;
}

// ---------------------------------------------------------------------------
// §4 Delivered + Collection
// ---------------------------------------------------------------------------

export async function deliverOrder(
  orderId: string,
  riderId: string,
  body: { cash: unknown; online: unknown; credit: unknown; note?: string },
) {
  const riderCity = await resolveRiderCity(riderId);

  const existing = await OrderModel.findOne({ _id: orderId, isTrashed: { $ne: true } })
    .select('_id status assignedRiderId dealerId grandTotal invoiceNumber paidAmount')
    .lean()
    .exec();
  if (!existing) throw notFound('Order not found');
  if (String(existing.assignedRiderId ?? '') !== riderId) {
    throw forbidden('This order is not assigned to you.');
  }

  const dealer = await DealerModel.findById(existing.dealerId)
    .select('name shopName address.city')
    .lean()
    .exec();
  if (!dealer) throw notFound('Client not found for this order');
  const dealerCityKey = assertSameCity(dealer, riderCity);

  // Validate the money BEFORE touching the order, so a bad split leaves the order packed and
  // re-deliverable rather than half-transitioned.
  const split: CollectionSplit = validateCollectionSplit(body, existing.grandTotal);

  const deliveredAt = new Date();

  // The status CAS is the primary mutex against a double-tap: only one request can move
  // packed -> delivered.
  const order = await OrderModel.findOneAndUpdate(
    {
      _id: orderId,
      assignedRiderId: new Types.ObjectId(riderId),
      status: 'packed',
      isTrashed: { $ne: true },
    },
    {
      $set: {
        status: 'delivered',
        deliveredAt,
        // Legacy single-value fields, written so the pre-existing analytics KPIs keep working.
        // Lossy: see deriveOrderPaymentType. The DeliveryCollection doc is authoritative.
        paidAmount: derivePaidAmount(split),
        paymentType: deriveOrderPaymentType(split),
      },
    },
    { new: true },
  );

  if (!order) await explainTransitionFailure(orderId, riderId, 'packed');

  let collection;
  try {
    collection = await DeliveryCollectionModel.create({
      orderId: order!._id,
      invoiceNumber: order!.invoiceNumber,
      dealerId: order!.dealerId,
      riderId: new Types.ObjectId(riderId),
      city: riderCity.city,
      cityKey: riderCity.cityKey,
      dealerCityKey,
      orderAmount: round2(existing.grandTotal ?? 0),
      cash: split.cash,
      online: split.online,
      credit: split.credit,
      ...(body.note ? { note: String(body.note).slice(0, 500) } : {}),
      deliveredAt,
      createdBy: new Types.ObjectId(riderId),
    });
  } catch (err) {
    const e = err as { code?: number };
    if (e.code === 11000) {
      // The unique index on orderId caught a retry that got past the CAS (status already
      // flipped by a previous attempt whose insert landed). Report it readably — the global
      // handler's generic "Duplicate value" tells the rider nothing.
      throw conflict('A collection has already been recorded for this order.');
    }
    // Compensate: the order says delivered but no money was recorded. Put it back so the rider
    // can retry, rather than stranding an order that can never be collected against.
    await OrderModel.updateOne(
      { _id: orderId },
      { $set: { status: 'packed' }, $unset: { deliveredAt: '' } },
    ).catch((revertErr) =>
      console.error('Failed to revert order status after a failed collection insert', revertErr),
    );
    throw err;
  }

  logActivityAsync({
    employeeId: riderId,
    module: 'collection',
    entityId: String(collection._id),
    action: 'created',
    meta: {
      orderId: String(order!._id),
      invoiceNumber: order!.invoiceNumber,
      dealerId: String(order!.dealerId),
      cityKey: riderCity.cityKey,
      orderAmount: round2(existing.grandTotal ?? 0),
      cash: split.cash,
      online: split.online,
      credit: split.credit,
    },
  });

  // The accounting side of the delivery: the sale, the cost, and the money taken.
  //
  // Deliberately awaited but never allowed to throw — `postDelivery` records its own failures
  // for the nightly retry. A rider standing in a shop must not be refused because head office
  // mis-mapped a ledger account; the delivery is real whether or not the books can record it
  // yet, and refusing it would lose the sale AND the cash.
  await postDelivery(String(collection._id), riderId);

  const balance = await getRiderBalance(riderId);
  return { order: order!, collection, balance };
}

// ---------------------------------------------------------------------------
// §7 Admin correction and void
// ---------------------------------------------------------------------------

export async function correctCollection(
  id: string,
  adminId: string,
  body: { cash: unknown; online: unknown; credit: unknown; reason?: string },
) {
  const collection = await DeliveryCollectionModel.findById(id);
  if (!collection) throw notFound('Collection entry not found');
  if (collection.voidedAt) {
    throw badRequest('This entry has been voided and can no longer be corrected.');
  }

  // A correction REALLOCATES between the three modes; the total is immutable because it is the
  // order's amount. "The rider logged 5,000 cash but 2,000 of it was a transfer" is the real
  // use case. Changing the total is not a correction — that is a void.
  const split = validateCollectionSplit(body, collection.orderAmount);

  const from = {
    cash: collection.cash,
    online: collection.online,
    credit: collection.credit,
  };

  if (from.cash === split.cash && from.online === split.online && from.credit === split.credit) {
    throw badRequest('The corrected split is identical to the current one.');
  }

  collection.cash = split.cash;
  collection.online = split.online;
  collection.credit = split.credit;
  // Appended BEFORE the ActivityLog write, because logActivityAsync is fire-and-forget and
  // swallows its own errors — an audit trail that can silently vanish is not an audit trail.
  collection.corrections.push({
    at: new Date(),
    by: new Types.ObjectId(adminId),
    from,
    to: { ...split },
    ...(body.reason ? { reason: String(body.reason).slice(0, 500) } : {}),
  });
  collection.lastCorrectedAt = new Date();
  collection.lastCorrectedBy = new Types.ObjectId(adminId);
  await collection.save();

  // Keep the legacy order fields in step, or the analytics KPI drifts from the report.
  await OrderModel.updateOne(
    { _id: collection.orderId },
    { $set: { paidAmount: derivePaidAmount(split), paymentType: deriveOrderPaymentType(split) } },
  );

  logActivityAsync({
    employeeId: adminId,
    module: 'collection',
    entityId: String(collection._id),
    action: 'updated',
    changes: {
      cash: { from: from.cash, to: split.cash },
      online: { from: from.online, to: split.online },
      credit: { from: from.credit, to: split.credit },
    },
    meta: {
      orderId: String(collection.orderId),
      riderId: String(collection.riderId),
      reason: body.reason ?? null,
    },
  });

  // Reverses the money entry and re-posts it at the corrected split. The sale entry is left
  // alone: a correction must keep cash + online + credit equal to the order total, so the
  // total never moves, only how it was taken.
  await postCollectionCorrection(String(collection._id), adminId);

  return collection;
}

export async function voidCollection(id: string, adminId: string, reason: string) {
  const collection = await DeliveryCollectionModel.findById(id);
  if (!collection) throw notFound('Collection entry not found');
  if (collection.voidedAt) throw conflict('This entry has already been voided.');

  collection.voidedAt = new Date();
  collection.voidedBy = new Types.ObjectId(adminId);
  collection.voidReason = String(reason).slice(0, 500);
  await collection.save();

  // The order no longer has money against it, so the legacy fields must not claim it was paid.
  await OrderModel.updateOne(
    { _id: collection.orderId },
    { $set: { paidAmount: 0 }, $unset: { paymentType: '' } },
  );

  logActivityAsync({
    employeeId: adminId,
    module: 'collection',
    entityId: String(collection._id),
    action: 'cancelled',
    meta: {
      orderId: String(collection.orderId),
      riderId: String(collection.riderId),
      amount: collection.orderAmount,
      reason,
    },
  });

  // Only the money entry is reversed. A void here leaves the order delivered and moves no stock
  // back, so the goods are with the shop and the shop still owes for them — the sale and its
  // cost stand, and the receivable goes back up to the full amount.
  await postCollectionVoid(String(collection._id), adminId);

  return collection;
}

export async function getCollectionByOrder(orderId: string) {
  return DeliveryCollectionModel.findOne({ orderId: new Types.ObjectId(orderId) }).lean().exec();
}
