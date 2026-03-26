import { Types } from 'mongoose';
import { ReturnModel } from '../../models/return.model';
import { ProductModel } from '../../models/product.model';
import { badRequest, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

interface ReturnProductInput {
  productId: string;
  quantity: number;
  price: number;
}

async function applyReturnedStock(products: ReturnProductInput[] | { productId: Types.ObjectId; quantity: number; price: number }[]) {
  if (!products.length) return;
  const ops = products.map((p) => ({
    updateOne: {
      filter: { _id: new Types.ObjectId(String(p.productId)), isTrashed: { $ne: true } },
      update: { $inc: { quantity: p.quantity || 0 } },
    },
  }));
  await ProductModel.bulkWrite(ops);
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

  const returnDoc = await ReturnModel.create({
    ...rest,
    dealerId: new Types.ObjectId(dealerId),
    products: products.map((p) => ({
      productId: new Types.ObjectId(p.productId),
      quantity: p.quantity,
      price: p.price,
    })),
    createdBy: new Types.ObjectId(userId),
  });

  if (returnDoc.status === 'completed' && returnDoc.returnType === 'return') {
    await applyReturnedStock(returnDoc.products as any);
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

  const movedToCompleted = nextStatus === 'completed';
  if (movedToCompleted && returnDoc.returnType === 'return') {
    await applyReturnedStock(returnDoc.products as any);
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
