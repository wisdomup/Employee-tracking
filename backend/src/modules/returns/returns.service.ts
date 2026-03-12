import { Types } from 'mongoose';
import { ReturnModel } from '../../models/return.model';
import { notFound } from '../../utils/app-error';

export async function createReturn(
  data: {
    productId: string;
    dealerId: string;
    returnType: 'return' | 'claim';
    returnReason?: string;
  },
  userId: string,
) {
  const { productId, dealerId, ...rest } = data;

  return ReturnModel.create({
    ...rest,
    productId: new Types.ObjectId(productId),
    dealerId: new Types.ObjectId(dealerId),
    createdBy: new Types.ObjectId(userId),
  });
}

export async function findAll(filters?: {
  dealerId?: string;
  productId?: string;
  returnType?: string;
  createdBy?: string;
}) {
  const query: Record<string, unknown> = {};

  if (filters?.dealerId) query.dealerId = new Types.ObjectId(filters.dealerId);
  if (filters?.productId) query.productId = new Types.ObjectId(filters.productId);
  if (filters?.returnType) query.returnType = filters.returnType;
  if (filters?.createdBy) query.createdBy = new Types.ObjectId(filters.createdBy);

  return ReturnModel.find(query)
    .populate('productId')
    .populate('dealerId')
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const returnDoc = await ReturnModel.findById(id)
    .populate('productId')
    .populate('dealerId')
    .populate('createdBy', '-password')
    .exec();

  if (!returnDoc) {
    throw notFound('Return not found');
  }

  return returnDoc;
}

export async function updateReturn(id: string, data: Record<string, unknown>) {
  const returnDoc = await ReturnModel.findById(id);

  if (!returnDoc) {
    throw notFound('Return not found');
  }

  if (data.productId) data.productId = new Types.ObjectId(data.productId as string);
  if (data.dealerId) data.dealerId = new Types.ObjectId(data.dealerId as string);

  Object.assign(returnDoc, data);
  await returnDoc.save();

  return returnDoc;
}

export async function deleteReturn(id: string) {
  const returnDoc = await ReturnModel.findById(id);

  if (!returnDoc) {
    throw notFound('Return not found');
  }

  await ReturnModel.findByIdAndDelete(id);

  return { message: 'Return deleted successfully' };
}
