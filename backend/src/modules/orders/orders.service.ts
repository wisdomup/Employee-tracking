import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { ProductModel } from '../../models/product.model';
import { notFound, badRequest } from '../../utils/app-error';

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

async function restoreStockForOrderProducts(order: { products: { productId: Types.ObjectId; quantity: number }[] }) {
  for (const item of order.products) {
    await ProductModel.findByIdAndUpdate(item.productId, { $inc: { quantity: item.quantity } });
  }
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

  const totalPrice = products.reduce((sum, p) => sum + p.quantity * p.price, 0);
  const grandTotal = totalPrice - (discount ?? 0);

  const byProduct = aggregateQuantityByProduct(products);
  for (const [productId, totalQty] of byProduct) {
    const product = await ProductModel.findById(productId).select('name quantity').lean();
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
    ...(routeId && { routeId: new Types.ObjectId(routeId) }),
    createdBy: new Types.ObjectId(userId),
  });

  try {
    for (const [productId, totalQty] of byProduct) {
      const result = await ProductModel.findOneAndUpdate(
        { _id: productId, quantity: { $gte: totalQty } },
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
  const query: Record<string, unknown> = {};

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
  const order = await OrderModel.findById(id)
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

export async function updateOrder(id: string, data: Record<string, unknown>) {
  const order = await OrderModel.findById(id);

  if (!order) {
    throw notFound('Order not found');
  }

  if (data.status === 'cancelled' && order.status !== 'cancelled') {
    await restoreStockForOrderProducts(order);
  }

  if (data.dealerId) data.dealerId = new Types.ObjectId(data.dealerId as string);
  if (data.routeId) data.routeId = new Types.ObjectId(data.routeId as string);

  if (data.products) {
    data.products = (data.products as any[]).map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      price: p.price,
    }));
  }

  Object.assign(order, data);

  const totalPrice = order.products.reduce((sum, p) => sum + p.quantity * p.price, 0);
  order.totalPrice = totalPrice;
  order.grandTotal = totalPrice - (order.discount ?? 0);
  await order.save();

  return order;
}

export async function deleteOrder(id: string) {
  const order = await OrderModel.findById(id);

  if (!order) {
    throw notFound('Order not found');
  }

  const completedStatuses = ['delivered', 'cancelled'];
  if (!completedStatuses.includes(order.status)) {
    await restoreStockForOrderProducts(order);
  }

  await OrderModel.findByIdAndDelete(id);

  return { message: 'Order deleted successfully' };
}
