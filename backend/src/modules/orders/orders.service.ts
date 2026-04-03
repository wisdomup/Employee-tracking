import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { ProductModel } from '../../models/product.model';
import { DealerModel } from '../../models/dealer.model';
import { notFound, badRequest } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

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

async function restoreStockForOrderProducts(order: { products: { productId: Types.ObjectId; quantity: number }[] }) {
  for (const item of order.products) {
    await ProductModel.findByIdAndUpdate(item.productId, { $inc: { quantity: item.quantity } });
  }
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
    products: { productId: string; quantity: number; price: number }[];
    totalPrice?: number;
    discount?: number;
    grandTotal?: number;
    paidAmount?: number;
    description?: string;
    status?: string;
    orderDate?: Date;
    deliveryDate?: Date;
    dealerId: string;
    routeId?: string;
  },
  userId: string,
) {
  const { products, dealerId, routeId, discount, ...rest } = data;
  const routeIdProvided = Object.prototype.hasOwnProperty.call(data, 'routeId');
  const resolvedRouteId = await resolveOrderRouteId(dealerId, routeId, routeIdProvided);

  const totalPrice = products.reduce((sum, p) => sum + p.quantity * p.price, 0);
  const grandTotal = totalPrice - (discount ?? 0);

  const byProduct = aggregateQuantityByProduct(products);
  for (const [productId, totalQty] of byProduct) {
    const product = await ProductModel.findOne({ _id: productId, isTrashed: { $ne: true } }).select('name quantity').lean();
    const stock = product?.quantity ?? 0;
    if (totalQty > stock) {
      throw badRequest(
        `Insufficient stock for "${product?.name ?? productId}". Available: ${stock}, requested: ${totalQty}.`,
      );
    }
  }

  const order = await OrderModel.create({
    ...rest,
    discount: discount ?? 0,
    totalPrice,
    grandTotal,
    products: products.map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      price: p.price,
    })),
    dealerId: new Types.ObjectId(dealerId),
    ...(resolvedRouteId && { routeId: resolvedRouteId }),
    createdBy: new Types.ObjectId(userId),
  });

  try {
    for (const [productId, totalQty] of byProduct) {
      const result = await ProductModel.findOneAndUpdate(
        { _id: productId, quantity: { $gte: totalQty }, isTrashed: { $ne: true } },
        { $inc: { quantity: -totalQty } },
      );
      if (!result) {
        await OrderModel.findByIdAndDelete(order._id);
        throw badRequest('Insufficient stock (conflict with another order). Please try again.');
      }
    }
  } catch (err) {
    await OrderModel.findByIdAndDelete(order._id);
    throw err;
  }

  logActivityAsync({
    employeeId: userId,
    module: 'order',
    entityId: String(order._id),
    action: 'created',
    meta: {
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
  startDate?: string;
  endDate?: string;
}) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.dealerId) query.dealerId = new Types.ObjectId(filters.dealerId);
  if (filters?.routeId) query.routeId = new Types.ObjectId(filters.routeId);
  if (filters?.status) query.status = filters.status;
  if (filters?.createdBy) query.createdBy = new Types.ObjectId(filters.createdBy);

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
    .populate('products.productId')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('dealerId')
    .populate('routeId')
    .populate('createdBy', '-password')
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

  const previousStatus = order.status;
  const nextStatus = typeof data.status === 'string' ? data.status : undefined;
  const previousProducts = order.products.map((p) => ({
    productId: p.productId,
    quantity: p.quantity,
    price: p.price,
  }));

  if (data.status === 'cancelled' && order.status !== 'cancelled') {
    await restoreStockForOrderProducts(order);
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
    data.products = (data.products as any[]).map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      price: p.price,
    }));
  }

  Object.assign(order, data);

  if (nextRouteId !== UNCHANGED) {
    order.routeId = nextRouteId as Types.ObjectId | undefined;
  }

  const totalPrice = order.products.reduce((sum, p) => sum + p.quantity * p.price, 0);
  order.totalPrice = totalPrice;
  order.grandTotal = totalPrice - (order.discount ?? 0);

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

    for (const { productId, delta } of deltas.filter((d) => d.delta > 0)) {
      const product = await ProductModel.findOne({
        _id: productId,
        isTrashed: { $ne: true },
      }).select('name quantity').lean();
      const stock = product?.quantity ?? 0;
      if (delta > stock) {
        throw badRequest(
          `Insufficient stock for "${product?.name ?? productId}". Available: ${stock}, additional required: ${delta}.`,
        );
      }
    }

    for (const { productId, delta } of deltas.filter((d) => d.delta > 0)) {
      const result = await ProductModel.findOneAndUpdate(
        { _id: productId, quantity: { $gte: delta }, isTrashed: { $ne: true } },
        { $inc: { quantity: -delta } },
      );
      if (!result) {
        throw badRequest('Insufficient stock (conflict with another order). Please try again.');
      }
    }

    for (const { productId, delta } of deltas.filter((d) => d.delta < 0)) {
      await ProductModel.findByIdAndUpdate(productId, { $inc: { quantity: -delta } });
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

  return order;
}

export async function approveOrder(id: string, actorId?: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!order) {
    throw notFound('Order not found');
  }

  if (order.status !== 'pending') {
    throw badRequest(`Only pending orders can be approved. Current status is "${order.status}".`);
  }

  order.status = 'approved';
  await order.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'order',
    entityId: String(order._id),
    action: 'status_changed',
    changes: { status: { from: 'pending', to: 'approved' } },
    meta: { status: order.status, dealerId: String(order.dealerId) },
  });

  return order;
}

export async function deleteOrder(id: string, actorId?: string) {
  const order = await OrderModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!order) {
    throw notFound('Order not found');
  }

  const completedStatuses = ['delivered', 'cancelled'];
  if (!completedStatuses.includes(order.status)) {
    await restoreStockForOrderProducts(order);
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
