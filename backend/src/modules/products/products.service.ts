import { Types } from 'mongoose';
import { ProductModel } from '../../models/product.model';
import { notFound, badRequest } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

export async function createProduct(
  data: {
    barcode: string;
    name: string;
    description?: string;
    image?: string;
    salePrice?: number;
    purchasePrice?: number;
    onlinePrice?: number;
    quantity?: number;
    categoryId: string;
    extras?: Record<string, string>;
  },
  userId: string,
) {
  const existing = await ProductModel.findOne({ barcode: data.barcode });
  if (existing) {
    throw badRequest('A product with this barcode already exists');
  }

  const product = await ProductModel.create({
    ...data,
    categoryId: new Types.ObjectId(data.categoryId),
    createdBy: new Types.ObjectId(userId),
  });

  logActivityAsync({
    employeeId: userId,
    module: 'product',
    entityId: String(product._id),
    action: 'created',
    meta: { name: product.name, barcode: product.barcode },
  });

  return product;
}

export async function findAll(filters?: {
  categoryId?: string;
  search?: string;
}) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.categoryId) query.categoryId = new Types.ObjectId(filters.categoryId);

  if (filters?.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { barcode: { $regex: filters.search, $options: 'i' } },
    ];
  }

  return ProductModel.find(query)
    .populate('categoryId')
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const product = await ProductModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('categoryId')
    .populate('createdBy', '-password')
    .exec();

  if (!product) {
    throw notFound('Product not found');
  }

  return product;
}

export async function updateProduct(id: string, data: Record<string, unknown>, actorId?: string) {
  const product = await ProductModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!product) {
    throw notFound('Product not found');
  }

  if (data.barcode && data.barcode !== product.barcode) {
    const existing = await ProductModel.findOne({ barcode: data.barcode });
    if (existing) {
      throw badRequest('A product with this barcode already exists');
    }
  }

  if (data.categoryId) {
    data.categoryId = new Types.ObjectId(data.categoryId as string);
  }

  const { extras, ...rest } = data;
  Object.assign(product, rest);
  if (Object.prototype.hasOwnProperty.call(data, 'extras')) {
    product.extras = extras as Record<string, string> | undefined;
  }
  await product.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'product',
    entityId: String(product._id),
    action: 'updated',
    meta: { name: product.name, barcode: product.barcode },
  });

  return product;
}

export async function deleteProduct(id: string, actorId?: string) {
  const product = await ProductModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!product) {
    throw notFound('Product not found');
  }

  product.isTrashed = true;
  product.trashedAt = new Date();
  product.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await product.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'product',
    entityId: String(product._id),
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { name: product.name, barcode: product.barcode },
  });

  return { message: 'Product moved to trash successfully' };
}

export async function restoreProduct(id: string, actorId?: string) {
  const product = await ProductModel.findOne({ _id: id, isTrashed: true });
  if (!product) throw notFound('Product not found in trash');
  product.isTrashed = false;
  product.trashedAt = undefined;
  product.trashedBy = undefined;
  await product.save();
  logActivityAsync({
    employeeId: actorId,
    module: 'product',
    entityId: String(product._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { name: product.name, barcode: product.barcode },
  });
  return product;
}

export async function permanentlyDeleteProduct(id: string, actorId?: string) {
  const product = await ProductModel.findOne({ _id: id, isTrashed: true });
  if (!product) throw notFound('Product not found in trash');
  await ProductModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'product',
    entityId: String(product._id),
    action: 'deleted',
    meta: { name: product.name, barcode: product.barcode, permanent: true },
  });
  return { message: 'Product permanently deleted successfully' };
}
