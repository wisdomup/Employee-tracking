import { Types } from 'mongoose';
import { CategoryModel } from '../../models/category.model';
import { notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

export async function createCategory(
  data: { name: string; description?: string; image?: string },
  userId: string,
) {
  const category = await CategoryModel.create({ ...data, createdBy: new Types.ObjectId(userId) });
  logActivityAsync({
    employeeId: userId,
    module: 'category',
    entityId: String(category._id),
    action: 'created',
    meta: { name: category.name },
  });
  return category;
}

export async function findAll(filters?: { search?: string }) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { description: { $regex: filters.search, $options: 'i' } },
    ];
  }

  return CategoryModel.find(query).populate('createdBy', '-password').exec();
}

export async function findById(id: string) {
  const category = await CategoryModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('createdBy', '-password')
    .exec();

  if (!category) {
    throw notFound('Category not found');
  }

  return category;
}

export async function updateCategory(id: string, data: object, actorId?: string) {
  const category = await CategoryModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!category) {
    throw notFound('Category not found');
  }

  Object.assign(category, data);
  await category.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'category',
    entityId: String(category._id),
    action: 'updated',
    meta: { name: category.name },
  });

  return category;
}

export async function deleteCategory(id: string, actorId?: string) {
  const category = await CategoryModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!category) {
    throw notFound('Category not found');
  }

  category.isTrashed = true;
  category.trashedAt = new Date();
  category.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await category.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'category',
    entityId: String(category._id),
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { name: category.name },
  });

  return { message: 'Category moved to trash successfully' };
}

export async function restoreCategory(id: string, actorId?: string) {
  const category = await CategoryModel.findOne({ _id: id, isTrashed: true });
  if (!category) throw notFound('Category not found in trash');
  category.isTrashed = false;
  category.trashedAt = undefined;
  category.trashedBy = undefined;
  await category.save();
  logActivityAsync({
    employeeId: actorId,
    module: 'category',
    entityId: String(category._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { name: category.name },
  });
  return category;
}

export async function permanentlyDeleteCategory(id: string, actorId?: string) {
  const category = await CategoryModel.findOne({ _id: id, isTrashed: true });
  if (!category) throw notFound('Category not found in trash');
  await CategoryModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'category',
    entityId: String(category._id),
    action: 'deleted',
    meta: { name: category.name, permanent: true },
  });
  return { message: 'Category permanently deleted successfully' };
}
