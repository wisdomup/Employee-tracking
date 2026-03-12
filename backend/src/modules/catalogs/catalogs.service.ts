import { Types } from 'mongoose';
import { CatalogModel } from '../../models/catalog.model';
import { saveFile, deleteFile } from '../../services/file-upload.service';
import { notFound } from '../../utils/app-error';

export async function createCatalog(
  data: { name: string; fileUrl: string },
  userId?: string,
) {
  return CatalogModel.create({
    name: data.name,
    fileUrl: data.fileUrl,
    ...(userId && { createdBy: new Types.ObjectId(userId) }),
  });
}

export async function findAll(filters?: { search?: string }) {
  const query: Record<string, unknown> = {};
  if (filters?.search) {
    query.name = { $regex: filters.search, $options: 'i' };
  }
  return CatalogModel.find(query)
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const catalog = await CatalogModel.findById(id)
    .populate('createdBy', '-password')
    .exec();
  if (!catalog) {
    throw notFound('Catalog not found');
  }
  return catalog;
}

export async function updateCatalog(
  id: string,
  data: { name?: string; fileUrl?: string },
) {
  const catalog = await CatalogModel.findById(id);
  if (!catalog) {
    throw notFound('Catalog not found');
  }
  if (data.name !== undefined) catalog.name = data.name;
  if (data.fileUrl !== undefined) catalog.fileUrl = data.fileUrl;
  await catalog.save();
  return catalog.populate('createdBy', '-password');
}

export async function deleteCatalog(id: string) {
  const catalog = await CatalogModel.findById(id);
  if (!catalog) {
    throw notFound('Catalog not found');
  }
  try {
    await deleteFile(catalog.fileUrl);
  } catch {
    // ignore file delete errors
  }
  await CatalogModel.findByIdAndDelete(id);
  return { message: 'Catalog deleted successfully' };
}

export async function saveCatalogFile(file: Express.Multer.File): Promise<string> {
  return saveFile(file, 'catalogs');
}
