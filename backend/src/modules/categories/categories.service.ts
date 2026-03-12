import { Types } from 'mongoose';
import { CategoryModel } from '../../models/category.model';
import { notFound } from '../../utils/app-error';

export async function createCategory(
  data: { name: string; description?: string; image?: string },
  userId: string,
) {
  return CategoryModel.create({ ...data, createdBy: new Types.ObjectId(userId) });
}

export async function findAll(filters?: { search?: string }) {
  const query: Record<string, unknown> = {};

  if (filters?.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { description: { $regex: filters.search, $options: 'i' } },
    ];
  }

  return CategoryModel.find(query).populate('createdBy', '-password').exec();
}

export async function findById(id: string) {
  const category = await CategoryModel.findById(id)
    .populate('createdBy', '-password')
    .exec();

  if (!category) {
    throw notFound('Category not found');
  }

  return category;
}

export async function updateCategory(id: string, data: object) {
  const category = await CategoryModel.findById(id);

  if (!category) {
    throw notFound('Category not found');
  }

  Object.assign(category, data);
  await category.save();

  return category;
}

export async function deleteCategory(id: string) {
  const category = await CategoryModel.findById(id);

  if (!category) {
    throw notFound('Category not found');
  }

  await CategoryModel.findByIdAndDelete(id);

  return { message: 'Category deleted successfully' };
}
