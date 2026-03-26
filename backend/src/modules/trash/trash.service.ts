import { Model } from 'mongoose';
import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { ProductModel } from '../../models/product.model';
import { CategoryModel } from '../../models/category.model';
import { RouteModel } from '../../models/route.model';
import { OrderModel } from '../../models/order.model';
import { ReturnModel } from '../../models/return.model';
import { VisitModel } from '../../models/visit.model';
import { badRequest } from '../../utils/app-error';

type TrashModule =
  | 'employee'
  | 'dealer'
  | 'product'
  | 'category'
  | 'route'
  | 'order'
  | 'return'
  | 'visit';

const MODULE_MODEL_MAP: Record<TrashModule, Model<any>> = {
  employee: UserModel,
  dealer: DealerModel,
  product: ProductModel,
  category: CategoryModel,
  route: RouteModel,
  order: OrderModel,
  return: ReturnModel,
  visit: VisitModel,
};

function getEntityLabel(module: TrashModule, doc: any): string {
  switch (module) {
    case 'employee':
      return `${doc.username ?? 'Employee'}${doc.phone ? ` (${doc.phone})` : ''}`;
    case 'dealer':
      return `${doc.shopName ?? doc.name ?? 'Dealer'}${doc.name ? ` - ${doc.name}` : ''}${doc.phone ? ` (${doc.phone})` : ''}`;
    case 'product':
      return `${doc.name ?? 'Product'}${doc.barcode ? ` (${doc.barcode})` : ''}`;
    case 'category':
      return doc.name ?? 'Category';
    case 'route':
      return doc.name ?? 'Route';
    case 'order':
      return `Order ${String(doc._id).slice(-8).toUpperCase()}`;
    case 'return':
      return `Return ${String(doc._id).slice(-8).toUpperCase()}`;
    case 'visit':
      return `Visit ${String(doc._id).slice(-8).toUpperCase()}`;
    default:
      return String(doc._id);
  }
}

export async function getTrashItems(filters?: {
  module?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}) {
  const modules: TrashModule[] = filters?.module
    ? [filters.module as TrashModule]
    : (Object.keys(MODULE_MODEL_MAP) as TrashModule[]);

  const results = await Promise.all(
    modules.map(async (module) => {
      const ModelForModule = MODULE_MODEL_MAP[module];
      if (!ModelForModule) {
        throw badRequest(`Unsupported module: ${module}`);
      }

      const query: Record<string, unknown> = { isTrashed: true };
      if (filters?.startDate || filters?.endDate) {
        const range: Record<string, Date> = {};
        if (filters.startDate) range.$gte = new Date(filters.startDate);
        if (filters.endDate) {
          const end = new Date(filters.endDate);
          end.setHours(23, 59, 59, 999);
          range.$lte = end;
        }
        query.trashedAt = range;
      }
      if (filters?.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: 'i' } },
          { shopName: { $regex: filters.search, $options: 'i' } },
          { username: { $regex: filters.search, $options: 'i' } },
          { phone: { $regex: filters.search, $options: 'i' } },
          { barcode: { $regex: filters.search, $options: 'i' } },
          { userID: { $regex: filters.search, $options: 'i' } },
        ];
      }

      const docs = await ModelForModule.find(query)
        .populate('trashedBy', 'username userID phone')
        .sort({ trashedAt: -1 })
        .lean()
        .exec();

      return docs.map((doc: any) => ({
        module,
        entityId: String(doc._id),
        label: getEntityLabel(module, doc),
        trashedAt: doc.trashedAt,
        trashedBy: doc.trashedBy,
        meta: doc,
      }));
    }),
  );

  return results.flat().sort((a, b) => {
    const aTime = a.trashedAt ? new Date(a.trashedAt).getTime() : 0;
    const bTime = b.trashedAt ? new Date(b.trashedAt).getTime() : 0;
    return bTime - aTime;
  });
}

export async function bulkPermanentDelete(items: { module: TrashModule; entityId: string }[]) {
  const grouped = new Map<TrashModule, string[]>();
  for (const item of items) {
    if (!MODULE_MODEL_MAP[item.module]) {
      throw badRequest(`Unsupported module: ${item.module}`);
    }
    grouped.set(item.module, [...(grouped.get(item.module) ?? []), item.entityId]);
  }

  let deletedCount = 0;
  for (const [module, ids] of grouped) {
    const ModelForModule = MODULE_MODEL_MAP[module];
    const result = await ModelForModule.deleteMany({ _id: { $in: ids }, isTrashed: true });
    deletedCount += result.deletedCount ?? 0;
  }
  return { deletedCount };
}
