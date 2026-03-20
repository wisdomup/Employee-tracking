import { Types } from 'mongoose';
import { ProductModel } from '../../models/product.model';
import { notFound, badRequest } from '../../utils/app-error';

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

  return ProductModel.create({
    ...data,
    categoryId: new Types.ObjectId(data.categoryId),
    createdBy: new Types.ObjectId(userId),
  });
}

export async function findAll(filters?: {
  categoryId?: string;
  search?: string;
}) {
  const query: Record<string, unknown> = {};

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
  const product = await ProductModel.findById(id)
    .populate('categoryId')
    .populate('createdBy', '-password')
    .exec();

  if (!product) {
    throw notFound('Product not found');
  }

  return product;
}

export async function updateProduct(id: string, data: Record<string, unknown>) {
  const product = await ProductModel.findById(id);

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

  return product;
}

export async function deleteProduct(id: string) {
  const product = await ProductModel.findById(id);

  if (!product) {
    throw notFound('Product not found');
  }

  await ProductModel.findByIdAndDelete(id);

  return { message: 'Product deleted successfully' };
}
