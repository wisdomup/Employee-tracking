import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { ProductModel } from '../../models/product.model';
import { DealerModel } from '../../models/dealer.model';
import { UserModel } from '../../models/user.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { ROLES } from '../../constants/global';
import { normalizeCityKey, UNASSIGNED_REGION_KEY } from '../region-sales/region-sales.rules';
import { notFound, badRequest, conflict } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { allocateNextOrderInvoiceNumber } from './order-invoice-counter';
import { sanitizeOrderTermsHtml } from './order-terms-sanitize';
import { computeOrderTotals } from './orders.totals';
import {
  applyStockMovements,
  StockMovementLine,
  getStockBalance,
} from '../warehouse/stock-ledger.service';
import { resolveWarehouseForUser } from '../warehouse/warehouse-resolver';
import { notifyInsufficientStock } from '../warehouse/warehouse-notifications';

function aggregateQuantityByProduct(
  products: { productId: string; quantity: number; price: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of products) {
    const id = p.productId;
    map.set(id, (map.get(id) ?? 0) + p.quantity);
  }
  return map;
}

function aggregateExistingOrderQuantityByProduct(
  products: { productId: Types.ObjectId; quantity: number; price: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of products) {
    const id = String(p.productId);
    map.set(id, (map.get(id) ?? 0) + p.quantity);
  }
  return map;
}

/**
 * Statuses where the stock consequence of an order is already settled: `delivered` goods
 * have physically left, `cancelled` stock was already given back. Restoring stock again
 * for either of these invents inventory. `deleteOrder` and the cancel path share this list.
 */
const STOCK_SETTLED_STATUSES = ['delivered', 'cancelled'];

/**
 * Which warehouse does this order draw from?
 *
 * Every order created after the warehouse cutover carries a `warehouseId`, and the bootstrap
 * migration stamps the Main warehouse onto the ones that pre-date it. The resolver fallback covers
 * the gap in between.
 */
async function warehouseOf(order: {
  warehouseId?: Types.ObjectId;
  createdBy: Types.ObjectId;
}): Promise<string> {
  if (order.warehouseId) return String(order.warehouseId);
  const resolved = await resolveWarehouseForUser(String(order.createdBy));
  return String(resolved.warehouseId);
}

/**
 * Discriminator for an operation an order can perform more than once in its life.
 *
 * Trash and restore alternate, so a fixed scope makes the SECOND trash collide with the first on
 * the ledger's unique idempotency key — the movement is compensated away and reported as
 * `alreadyApplied`, leaving a trashed order still holding its stock. `updatedAt` moves on every
 * save, so it separates the cycles while a genuine retry (where the save never landed) still
 * reuses the same key and stays idempotent. Same idiom as the edit path below.
 *
 * It has to come from persisted state — a fresh timestamp would make a retry look like a new
 * operation and apply the movement twice. The residual gap is two successful saves inside the same
 * millisecond, which needs a whole read-apply-save round trip to fit in under 1ms.
 */
function cycleScope(action: string, order: { updatedAt?: Date }): string {
  return `${action}:${order.updatedAt?.toISOString() ?? ''}`;
}

/**
 * Give an order's stock back to the warehouse it came out of.
 *
 * Used by cancel and by trash. Routed through the ledger so the reversal is auditable and shows up
 * in the product's movement history — the old version was a bare `$inc` with no trail.
 */
async function reverseOrderStock(
  order: {
    _id: Types.ObjectId;
    products: { productId: Types.ObjectId; quantity: number }[];
    warehouseId?: Types.ObjectId;
    createdBy: Types.ObjectId;
  },
  actorId: string | undefined,
  scope: string,
) {
  const warehouseId = await warehouseOf(order);
  const byProduct = aggregateExistingOrderQuantityByProduct(order.products as never);

  const lines: StockMovementLine[] = [...byProduct].map(([productId, qty], index) => ({
    warehouseId,
    productId,
    bucket: 'sellable',
    delta: qty,
    type: 'sale_return_in',
    refLine: index,
  }));

  if (lines.length === 0) return;

  await applyStockMovements(lines, {
    refType: 'order',
    refId: String(order._id),
    actorId,
    idempotencyScope: scope,
  });
}

/**
 * Reserve stock out of one warehouse for a set of order lines.
 *
 * All-or-nothing: the ledger applies every line or none, so a shortfall on the last product can
 * never leave the first one consumed. Returns the unit cost per product at the moment stock moved,
 * which the caller snapshots onto the order lines so the P&L stops restating itself.
 */
async function reserveWarehouseStock(
  warehouseId: string,
  byProduct: Map<string, number>,
  refId: string,
  actorId: string | undefined,
  scope?: string,
): Promise<Map<string, number>> {
  const lines: StockMovementLine[] = [...byProduct].map(([productId, qty], index) => ({
    warehouseId,
    productId,
    bucket: 'sellable',
    delta: -qty,
    type: 'sale_out',
    refLine: index,
  }));

  await applyStockMovements(lines, {
    refType: 'order',
    refId,
    actorId,
    ...(scope ? { idempotencyScope: scope } : {}),
  });

  const costs = await ProductModel.find({ _id: { $in: [...byProduct.keys()] } })
    .select('_id purchasePrice')
    .lean();
  return new Map(costs.map((p) => [String(p._id), p.purchasePrice ?? 0]));
}

/**
 * Pre-flight check with a helpful message, plus the admin notification the spec asks for: "if that
 * warehouse doesn't have enough stock, Admin gets notified" (§9). The authoritative guard is still
 * the ledger's own `$gte` predicate.
 */
async function assertWarehouseHasStock(
  warehouseId: string,
  byProduct: Map<string, number>,
  salesmanId: string,
) {
  for (const [productId, qty] of byProduct) {
    const balance = await getStockBalance(warehouseId, productId);
    if (qty > balance.sellable) {
      const [product, salesman] = await Promise.all([
        ProductModel.findById(productId).select('name').lean(),
        UserModel.findById(salesmanId).select('fullName username').lean(),
      ]);
      notifyInsufficientStock({
        warehouseId,
        productName: product?.name ?? String(productId),
        available: balance.sellable,
        requested: qty,
        salesmanName: salesman?.fullName || salesman?.username || 'A salesman',
      });
      throw badRequest(
        `Insufficient stock for "${product?.name ?? productId}" at the assigned warehouse. Available: ${balance.sellable}, requested: ${qty}.`,
      );
    }
  }
}

/**
 * Validate a rider before an order is handed to them.
 *
 * The city check is the important half. `resolveCityScope` deliberately fails OPEN for a user
 * with no city — right for narrowing a client list, catastrophic for money, because every
 * collection that rider records would land in an untraceable "Unassigned" bucket and spec §4's
 * "strictly city-wise segregated" would be quietly false. Refusing here makes it an admin's
 * one-time data-entry problem instead of a rider's mid-shift blocker.
 */
async function assertAssignableRider(riderId: string) {
  const rider = await UserModel.findOne({ _id: riderId, isTrashed: { $ne: true } })
    .select('_id role isActive fullName username address.city')
    .lean()
    .exec();

  if (!rider) throw notFound('Rider not found');
  if (rider.role !== ROLES.DELIVERY_MAN) {
    throw badRequest('Orders can only be assigned to a delivery boy.');
  }
  if (rider.isActive !== true) {
    throw badRequest('That rider’s account is inactive.');
  }
  if (normalizeCityKey(rider.address?.city) === UNASSIGNED_REGION_KEY) {
    const name = rider.fullName || rider.username;
    throw badRequest(`No city is set for ${name}. Set a city on ${name} before assigning orders.`);
  }
  return rider;
}

/** When `routeId` is omitted from the body, use the dealer's assigned route. Explicit `''` / null clears route. */
async function resolveOrderRouteId(
  dealerId: string,
  routeId: unknown,
  routeIdProvided: boolean,
): Promise<Types.ObjectId | undefined> {
  if (routeIdProvided) {
    if (routeId === '' || routeId === null || routeId === undefined) return undefined;
    const s = String(routeId).trim();
    return s ? new Types.ObjectId(s) : undefined;
  }
  const dealer = await DealerModel.findOne({ _id: dealerId, isTrashed: { $ne: true } }).select('route').lean();
  if (dealer?.route) return new Types.ObjectId(String(dealer.route));
  return undefined;
}

export async function createOrder(
  data: {
    products: { productId: string; quantity: number; price: number; discount?: number }[];
    totalPrice?: number;
    discount?: number;
    grandTotal?: number;
    paidAmount?: number;
    description?: string;
    termsAndConditions?: string;
    status?: string;
    orderDate?: Date;
    deliveryDate?: Date;
    dealerId: string;
    routeId?: string;
    /** Admin-only override of the auto-resolved source warehouse. */
    warehouseId?: string;
  },
  userId: string,
) {
  const { products, dealerId, routeId, discount, termsAndConditions, warehouseId, ...rest } = data;
  const terms = sanitizeOrderTermsHtml(termsAndConditions);
  const routeIdProvided = Object.prototype.hasOwnProperty.call(data, 'routeId');
  const resolvedRouteId = await resolveOrderRouteId(dealerId, routeId, routeIdProvided);

  const { totalPrice, itemsDiscountTotal, grandTotal, lineDiscounts } = computeOrderTotals(
    products,
    discount,
  );

  const byProduct = aggregateQuantityByProduct(products);

  // Spec §9: the warehouse follows the salesman's city, unless an admin has overridden it.
  const resolution = warehouseId
    ? { warehouseId: new Types.ObjectId(warehouseId), source: 'manual' as const }
    : await resolveWarehouseForUser(userId);
  const sourceWarehouseId = String(resolution.warehouseId);

  await assertWarehouseHasStock(sourceWarehouseId, byProduct, userId);

  // The order's id is minted up front so the stock movements can reference it. That lets the
  // reservation happen BEFORE the invoice number is allocated — the invoice series is monotonic and
  // gap-free, so a stock conflict must never consume a number.
  const orderId = new Types.ObjectId();
  const unitCosts = await reserveWarehouseStock(sourceWarehouseId, byProduct, String(orderId), userId);

  let order;
  try {
    const invoiceNumber = await allocateNextOrderInvoiceNumber();

    order = await OrderModel.create({
      ...rest,
      _id: orderId,
      ...(terms ? { termsAndConditions: terms } : {}),
      invoiceNumber,
      discount: discount ?? 0,
      totalPrice,
      grandTotal,
      products: products.map((p, i) => ({
        productId: new Types.ObjectId(p.productId),
        quantity: p.quantity,
        price: p.price,
        // Clamped per-line discount (never negative, never more than the line subtotal).
        discount: lineDiscounts[i],
        // Cost SNAPSHOT at the moment stock moved. Without it the P&L multiplies by the live
        // weighted-average cost, which now shifts on every goods receipt — so a closed period would
        // silently restate itself.
        unitCost: unitCosts.get(p.productId) ?? 0,
      })),
      dealerId: new Types.ObjectId(dealerId),
      ...(resolvedRouteId && { routeId: resolvedRouteId }),
      warehouseId: resolution.warehouseId,
      createdBy: new Types.ObjectId(userId),
    });
  } catch (err) {
    // Put the reserved stock back; the order does not exist.
    await reverseOrderStock(
      {
        _id: orderId,
        products: products.map((p) => ({
          productId: new Types.ObjectId(p.productId),
          quantity: p.quantity,
        })),
        warehouseId: resolution.warehouseId,
        createdBy: new Types.ObjectId(userId),
      },
      userId,
      'create-failed',
    ).catch((reverseErr) =>
      console.error('Failed to release stock after a failed order create', reverseErr),
    );
    throw err;
  }

  logActivityAsync({
    employeeId: userId,
    module: 'order',
    entityId: String(order._id),
    action: 'created',
    meta: {
      warehouseId: sourceWarehouseId,
      // Worth recording: a `main` fallback means the salesman's city matched no warehouse.
      warehouseResolution: resolution.source,
      status: order.status,
      dealerId: String(order.dealerId),
      grandTotal: order.grandTotal,
    },
  });

  return order;
}

export async function findAll(filters?: {
  dealerId?: string;
  routeId?: string;
  status?: string;
  createdBy?: string;
  /** `'unassigned'` matches orders with no rider — the admin's "still to hand out" queue. */
  assignedRiderId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.dealerId) query.dealerId = new Types.ObjectId(filters.dealerId);
  if (filters?.routeId) query.routeId = new Types.ObjectId(filters.routeId);
  if (filters?.status) query.status = filters.status;
  if (filters?.createdBy) query.createdBy = new Types.ObjectId(filters.createdBy);
  if (filters?.assignedRiderId === 'unassigned') {
    query.assignedRiderId = { $in: [null, undefined] };
  } else if (filters?.assignedRiderId) {
    query.assignedRiderId = new Types.ObjectId(filters.assignedRiderId);
  }

  if (filters?.startDate || filters?.endDate) {
    query.createdAt = {} as Record<string, Date>;
    const q = query.createdAt as Record<string, Date>;
    const startOnly = filters.startDate && !filters.endDate;
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      start.setUTCHours(0, 0, 0, 0);
      if (startOnly) {
        start.setUTCDate(start.getUTCDate() - 1);
      }
      q.$gte = start;
    }
    const endDateToUse = filters.endDate ?? (startOnly ? filters.startDate : undefined);
    if (endDateToUse) {
      const end = new Date(endDateToUse);
      end.setUTCHours(23, 59, 59, 999);
      q.$lte = end;
    }
  }

  return OrderModel.find(query)
    .populate('dealerId')
    .populate('routeId')
    .populate('createdBy', '-password')
    .populate('approvedBy', '-password')
    .populate('assignedRiderId', '-password')
    .populate('products.productId')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('dealerId')
    .populate('routeId')
    .populate('createdBy', '-password')
    .populate('approvedBy', '-password')
    .populate('assignedRiderId', '-password')
    .populate('products.productId')
    .exec();

  if (!order) {
    throw notFound('Order not found');
  }

  return order;
}

export async function updateOrder(id: string, data: Record<string, unknown>, actorId?: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!order) {
    throw notFound('Order not found');
  }

  const termsInBody = Object.prototype.hasOwnProperty.call(data, 'termsAndConditions');
  const termsSanitized = termsInBody ? sanitizeOrderTermsHtml(data.termsAndConditions) : undefined;
  delete data.termsAndConditions;

  delete data.invoiceNumber;
  delete data.approvedBy;
  delete data.approvedAt;
  // Rider assignment and the delivery timestamps are owned by the collection module's own
  // guarded transitions. Left writable here, an `employee` could PUT `{ status: 'delivered' }`
  // and skip the collection entry entirely — the money would never be recorded.
  delete data.assignedRiderId;
  delete data.assignedAt;
  delete data.packedAt;
  delete data.deliveredAt;

  const previousStatus = order.status;
  const nextStatus = typeof data.status === 'string' ? data.status : undefined;
  const previousProducts = order.products.map((p) => ({
    productId: p.productId,
    quantity: p.quantity,
    price: p.price,
  }));

  // A cancelled order has already handed its stock back. Re-opening it would leave the order
  // holding quantities it never reserved, so the transition is refused outright.
  if (previousStatus === 'cancelled' && nextStatus && nextStatus !== 'cancelled') {
    throw badRequest('A cancelled order cannot be re-opened. Create a new order instead.');
  }

  // `delivered` is terminal once a rider has collected against it. Moving it anywhere else —
  // including to `cancelled` — would leave a DeliveryCollection holding money for an order that
  // no longer claims to have been delivered. Void the collection entry first.
  if (previousStatus === 'delivered' && nextStatus && nextStatus !== 'delivered') {
    const live = await DeliveryCollectionModel.exists({
      orderId: order._id,
      voidedAt: { $exists: false },
    });
    if (live) {
      throw conflict(
        'This order has a collection entry recorded against it. Void that entry before changing the order status.',
      );
    }
  }

  // `delivered` goods have physically left the building — cancelling afterwards must not
  // credit the stock back. Mirrors the `completedStatuses` check in `deleteOrder`.
  if (nextStatus === 'cancelled' && !STOCK_SETTLED_STATUSES.includes(previousStatus)) {
    await reverseOrderStock(order, actorId, 'cancel');
  }

  // Admin moving the order to a different warehouse: reverse at the old one and take from the new
  // one in a single ledger call, so total stock never changes even if the second leg is short.
  const hasWarehouseId = Object.prototype.hasOwnProperty.call(data, 'warehouseId');
  const nextWarehouseId = hasWarehouseId && data.warehouseId ? String(data.warehouseId) : undefined;
  const previousWarehouseId = order.warehouseId ? String(order.warehouseId) : undefined;
  delete data.warehouseId;

  if (
    nextWarehouseId &&
    nextWarehouseId !== previousWarehouseId &&
    !STOCK_SETTLED_STATUSES.includes(previousStatus) &&
    nextStatus !== 'cancelled'
  ) {
    const fromWarehouseId = await warehouseOf(order);
    const byProduct = aggregateExistingOrderQuantityByProduct(previousProducts);

    const moveLines: StockMovementLine[] = [];
    let line = 0;
    for (const [productId, qty] of byProduct) {
      moveLines.push({
        warehouseId: fromWarehouseId,
        productId,
        bucket: 'sellable',
        delta: qty,
        type: 'sale_return_in',
        refLine: line,
      });
      moveLines.push({
        warehouseId: nextWarehouseId,
        productId,
        bucket: 'sellable',
        delta: -qty,
        type: 'sale_out',
        refLine: line,
      });
      line += 1;
    }

    if (moveLines.length > 0) {
      await applyStockMovements(moveLines, {
        refType: 'order',
        refId: id,
        actorId,
        reason: 'Source warehouse changed by an admin',
        idempotencyScope: `rewarehouse:${nextWarehouseId}`,
      });
    }
    order.warehouseId = new Types.ObjectId(nextWarehouseId);
  }

  const hasRouteId = Object.prototype.hasOwnProperty.call(data, 'routeId');
  const hasDealerId = Object.prototype.hasOwnProperty.call(data, 'dealerId');

  if (data.dealerId) data.dealerId = new Types.ObjectId(data.dealerId as string);

  const UNCHANGED = Symbol('routeUnchanged');
  let nextRouteId: Types.ObjectId | undefined | typeof UNCHANGED = UNCHANGED;
  const dealerIdForRoute =
    hasDealerId && data.dealerId
      ? String(data.dealerId)
      : String(order.dealerId);
  if (hasRouteId) {
    nextRouteId = await resolveOrderRouteId(dealerIdForRoute, data.routeId, true);
  } else if (hasDealerId) {
    nextRouteId = await resolveOrderRouteId(String(data.dealerId), undefined, false);
  }
  delete data.routeId;

  if (data.products) {
    // Keep the existing cost snapshot per product; a line added by this edit gets its snapshot
    // below, once the stock for it has actually moved.
    const existingCosts = new Map(
      previousProducts.map((p) => [String(p.productId), (p as { unitCost?: number }).unitCost]),
    );
    data.products = (data.products as any[]).map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      price: p.price,
      ...(typeof p.discount === 'number' && p.discount > 0 ? { discount: p.discount } : {}),
      ...(existingCosts.get(String(p.productId)) !== undefined
        ? { unitCost: existingCosts.get(String(p.productId)) }
        : {}),
    }));
  }

  Object.assign(order, data);

  if (termsInBody) {
    if (termsSanitized) order.termsAndConditions = termsSanitized;
    else order.set('termsAndConditions', undefined);
  }

  if (nextRouteId !== UNCHANGED) {
    order.routeId = nextRouteId as Types.ObjectId | undefined;
  }

  const totals = computeOrderTotals(order.products, order.discount);
  order.totalPrice = totals.totalPrice;
  order.grandTotal = totals.grandTotal;
  // Store the clamped amounts back so a discount typed past its line subtotal is persisted
  // as the subtotal, matching what grandTotal was computed with.
  order.products = order.products.map((line, i) =>
    line.discount !== totals.lineDiscounts[i]
      ? ({ ...line, discount: totals.lineDiscounts[i] } as typeof line)
      : line,
  ) as typeof order.products;

  if (previousStatus === 'pending' && order.status === 'approved' && actorId) {
    order.approvedBy = new Types.ObjectId(actorId);
    order.approvedAt = new Date();
  }

  if (data.products && previousStatus !== 'cancelled' && order.status !== 'cancelled') {
    const previousByProduct = aggregateExistingOrderQuantityByProduct(previousProducts);
    const nextByProduct = aggregateExistingOrderQuantityByProduct(order.products as any);
    const allProductIds = new Set<string>([
      ...previousByProduct.keys(),
      ...nextByProduct.keys(),
    ]);

    const deltas: Array<{ productId: string; delta: number }> = [];
    for (const productId of allProductIds) {
      const prevQty = previousByProduct.get(productId) ?? 0;
      const nextQty = nextByProduct.get(productId) ?? 0;
      const delta = nextQty - prevQty;
      if (delta !== 0) deltas.push({ productId, delta });
    }

    // One ledger call for the whole edit: increases as `sale_out`, decreases as `sale_return_in`.
    // All-or-nothing, so a shortfall on one line can never leave another line consumed by an edit
    // that was then rejected — and the order document is still unsaved, so nothing diverges.
    const editWarehouseId = order.warehouseId ? String(order.warehouseId) : await warehouseOf(order);

    if (deltas.length > 0) {
      const lines: StockMovementLine[] = deltas.map(({ productId, delta }, index) => ({
        warehouseId: editWarehouseId,
        productId,
        bucket: 'sellable',
        delta: -delta,
        type: delta > 0 ? 'sale_out' : 'sale_return_in',
        refLine: index,
      }));

      await applyStockMovements(lines, {
        refType: 'order',
        refId: id,
        actorId,
        // A retried identical request is idempotent; a genuinely new edit is not blocked, because
        // `updatedAt` has moved on.
        idempotencyScope: `update:${order.updatedAt?.toISOString() ?? ''}`,
      });

      // Snapshot the cost for products added by this edit.
      const addedIds = deltas.filter((d) => d.delta > 0).map((d) => d.productId);
      if (addedIds.length > 0) {
        const costs = await ProductModel.find({ _id: { $in: addedIds } })
          .select('_id purchasePrice')
          .lean();
        const costById = new Map(costs.map((p) => [String(p._id), p.purchasePrice ?? 0]));
        order.products = order.products.map((line) => {
          if (line.unitCost !== undefined) return line;
          const cost = costById.get(String(line.productId));
          return cost === undefined ? line : { ...line, unitCost: cost };
        }) as typeof order.products;
      }
    }
  }

  await order.save();

  const statusChanged = nextStatus && previousStatus !== nextStatus;
  logActivityAsync({
    employeeId: actorId,
    module: 'order',
    entityId: String(order._id),
    action: statusChanged ? 'status_changed' : 'updated',
    changes: statusChanged
      ? { status: { from: previousStatus, to: nextStatus } }
      : undefined,
    meta: {
      status: order.status,
      dealerId: String(order.dealerId),
      grandTotal: order.grandTotal,
    },
  });

  // Return same populated shape as GET /orders/:id
  return findById(id);
}

export async function approveOrder(
  id: string,
  actorId?: string,
  body: { termsAndConditions?: string; assignedRiderId?: string | null } = {},
) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!order) {
    throw notFound('Order not found');
  }

  if (order.status !== 'pending') {
    throw badRequest(`Only pending orders can be approved. Current status is "${order.status}".`);
  }

  // Validate the rider BEFORE the approval is saved, so a bad rider id leaves the order
  // pending and re-approvable rather than approved-but-unassigned.
  const riderProvided = Object.prototype.hasOwnProperty.call(body, 'assignedRiderId');
  const riderId = riderProvided && body.assignedRiderId ? String(body.assignedRiderId) : undefined;
  if (riderId) await assertAssignableRider(riderId);

  order.status = 'approved';
  if (actorId) {
    order.approvedBy = new Types.ObjectId(actorId);
    order.approvedAt = new Date();
  }
  if (riderId) {
    order.assignedRiderId = new Types.ObjectId(riderId);
    order.assignedAt = new Date();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'termsAndConditions')) {
    const t = sanitizeOrderTermsHtml(body.termsAndConditions);
    if (t) order.termsAndConditions = t;
    else order.set('termsAndConditions', undefined);
  }
  await order.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'order',
    entityId: String(order._id),
    action: 'status_changed',
    changes: { status: { from: 'pending', to: 'approved' } },
    meta: {
      status: order.status,
      dealerId: String(order.dealerId),
      ...(riderId ? { assignedRiderId: riderId } : {}),
    },
  });

  // Return same populated shape as GET /orders/:id (client, route, products, etc.)
  return findById(id);
}

/**
 * Hand an order to a rider, move it between riders, or take it back (`riderId` null/'').
 *
 * Separate from `approveOrder` because reassignment is routine — a rider goes sick, a route is
 * rebalanced at 11am — and must not require re-approving anything.
 */
export async function assignRider(id: string, riderId: string | null, actorId?: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!order) throw notFound('Order not found');

  if (order.status === 'pending') {
    throw badRequest('Approve the order before assigning it to a rider.');
  }
  if (order.status === 'cancelled') {
    throw badRequest('A cancelled order cannot be assigned to a rider.');
  }
  // The DeliveryCollection already recorded WHICH rider collected the money. Moving the order
  // to someone else afterwards would make the order disagree with its own collection entry.
  if (order.status === 'delivered') {
    throw conflict('This order has already been delivered and cannot be reassigned.');
  }

  const nextRiderId = riderId ? String(riderId) : null;
  if (nextRiderId) await assertAssignableRider(nextRiderId);

  const previous = order.assignedRiderId ? String(order.assignedRiderId) : null;
  if (nextRiderId) {
    order.assignedRiderId = new Types.ObjectId(nextRiderId);
    order.assignedAt = new Date();
  } else {
    order.set('assignedRiderId', undefined);
    order.set('assignedAt', undefined);
  }
  await order.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'order',
    entityId: String(order._id),
    action: 'updated',
    changes: { assignedRiderId: { from: previous, to: nextRiderId } },
    meta: { status: order.status, dealerId: String(order.dealerId) },
  });

  return findById(id);
}

export async function deleteOrder(id: string, actorId?: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!order) {
    throw notFound('Order not found');
  }

  // Money outlives the order document. The collection report reads DeliveryCollection directly
  // and never joins through Order, so trashing a delivered order does not erase the cash the
  // rider is holding — it just hides the order behind it. Force the void first so the two
  // records cannot disagree.
  const liveCollection = await DeliveryCollectionModel.exists({
    orderId: order._id,
    voidedAt: { $exists: false },
  });
  if (liveCollection) {
    throw conflict(
      'This order has a collection entry recorded against it. Void that entry before moving the order to trash.',
    );
  }

  if (!STOCK_SETTLED_STATUSES.includes(order.status)) {
    await reverseOrderStock(order, actorId, cycleScope('trash', order));
  }

  order.isTrashed = true;
  order.trashedAt = new Date();
  order.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await order.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'order',
    entityId: String(order._id),
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { status: order.status, dealerId: String(order.dealerId) },
  });

  return { message: 'Order moved to trash successfully' };
}

export async function restoreOrder(id: string, actorId?: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: true });
  if (!order) throw notFound('Order not found in trash');

  // `deleteOrder` gave this order's stock back when it was trashed, so restoring has to take
  // it again — otherwise a trash round-trip permanently inflates stock. If the stock is no
  // longer there the restore is refused rather than silently leaving the books wrong.
  if (!STOCK_SETTLED_STATUSES.includes(order.status)) {
    await reserveWarehouseStock(
      await warehouseOf(order),
      aggregateExistingOrderQuantityByProduct(order.products as never),
      id,
      actorId,
      cycleScope('restore', order),
    );
  }

  order.isTrashed = false;
  order.trashedAt = undefined;
  order.trashedBy = undefined;
  await order.save();
  logActivityAsync({
    employeeId: actorId,
    module: 'order',
    entityId: String(order._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { status: order.status, dealerId: String(order.dealerId), grandTotal: order.grandTotal },
  });
  return order;
}

export async function permanentlyDeleteOrder(id: string, actorId?: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: true });
  if (!order) throw notFound('Order not found in trash');
  await OrderModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'order',
    entityId: String(order._id),
    action: 'deleted',
    meta: { status: order.status, dealerId: String(order.dealerId), grandTotal: order.grandTotal, permanent: true },
  });
  return { message: 'Order permanently deleted successfully' };
}
