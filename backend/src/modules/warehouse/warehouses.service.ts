import { Types } from 'mongoose';
import { WarehouseModel } from '../../models/warehouse.model';
import { WarehouseStockModel } from '../../models/warehouse-stock.model';
import { StockTransferModel } from '../../models/stock-transfer.model';
import { badRequest, notFound } from '../../utils/app-error';
import { normalizeCityKey } from '../region-sales/region-sales.rules';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { resolveWarehouseScope } from './warehouse-scope';

/**
 * Warehouse master data. Admin can add a warehouse at any time — the spec is explicit that there
 * is no limit — and exactly one is flagged Main, which is where all Stock In lands.
 */

interface WarehouseInput {
  name: string;
  city: string;
  address?: string;
  managerId?: string;
  isMain?: boolean;
  isActive?: boolean;
}

/** Uniqueness on name is checked here, not with a DB index: soft-deleted rows keep their name. */
async function assertNameFree(name: string, excludeId?: string) {
  const existing = await WarehouseModel.findOne({
    name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    isTrashed: { $ne: true },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('_id')
    .lean();
  if (existing) throw badRequest(`A warehouse named "${name.trim()}" already exists`);
}

export async function createWarehouse(data: WarehouseInput, userId: string) {
  await assertNameFree(data.name);

  const isFirst = (await WarehouseModel.countDocuments({ isTrashed: { $ne: true } })) === 0;

  const warehouse = await WarehouseModel.create({
    name: data.name.trim(),
    city: data.city.trim(),
    cityKey: normalizeCityKey(data.city),
    address: data.address,
    ...(data.managerId ? { managerId: new Types.ObjectId(data.managerId) } : {}),
    // The very first warehouse becomes Main automatically — otherwise nothing can receive stock.
    isMain: false,
    isActive: data.isActive ?? true,
    createdBy: new Types.ObjectId(userId),
  });

  if (data.isMain || isFirst) {
    await setMainWarehouse(String(warehouse._id), userId);
  }

  logActivityAsync({
    employeeId: userId,
    module: 'warehouse',
    entityId: String(warehouse._id),
    action: 'created',
    meta: { name: warehouse.name, city: warehouse.city, isMain: data.isMain || isFirst },
  });

  return findWarehouseById(String(warehouse._id));
}

export async function findAllWarehouses(
  filters: { search?: string; city?: string; isActive?: string } = {},
  viewer?: { userId: string; role: string },
) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { city: { $regex: filters.search, $options: 'i' } },
    ];
  }
  if (filters.city) query.cityKey = normalizeCityKey(filters.city);
  if (filters.isActive === 'true') query.isActive = true;
  if (filters.isActive === 'false') query.isActive = false;

  // Warehouse staff may only see their own warehouse, but everyone needs the list to pick a
  // transfer destination — so a scoped caller still gets every warehouse NAME, just not the
  // stock behind it (that is enforced separately on the stock endpoints).
  if (viewer) {
    const scope = await resolveWarehouseScope(viewer.userId, viewer.role);
    if (scope !== null) query.isActive = query.isActive ?? true;
  }

  return WarehouseModel.find(query)
    .populate('managerId', 'username fullName userID phone')
    .sort({ isMain: -1, name: 1 })
    .lean();
}

export async function findWarehouseById(id: string) {
  const warehouse = await WarehouseModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('managerId', 'username fullName userID phone')
    .lean();
  if (!warehouse) throw notFound('Warehouse not found');
  return warehouse;
}

export async function updateWarehouse(
  id: string,
  data: Partial<WarehouseInput>,
  actorId?: string,
) {
  const warehouse = await WarehouseModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!warehouse) throw notFound('Warehouse not found');

  if (data.name && data.name.trim() !== warehouse.name) {
    await assertNameFree(data.name, id);
    warehouse.name = data.name.trim();
  }
  if (data.city !== undefined) {
    warehouse.city = data.city.trim();
    warehouse.cityKey = normalizeCityKey(data.city);
  }
  if (data.address !== undefined) warehouse.address = data.address;
  if (Object.prototype.hasOwnProperty.call(data, 'managerId')) {
    warehouse.managerId = data.managerId ? new Types.ObjectId(data.managerId) : undefined;
  }
  if (data.isActive !== undefined) {
    if (data.isActive === false && warehouse.isMain) {
      throw badRequest('The main warehouse cannot be deactivated — mark another warehouse as Main first');
    }
    warehouse.isActive = data.isActive;
  }

  await warehouse.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'warehouse',
    entityId: id,
    action: 'updated',
    meta: { name: warehouse.name, city: warehouse.city },
  });

  return findWarehouseById(id);
}

/**
 * Move the Main flag. The unique partial index means the old holder MUST be cleared first —
 * setting the new one while the old still holds it fails with a duplicate key.
 */
export async function setMainWarehouse(id: string, actorId?: string) {
  const warehouse = await WarehouseModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!warehouse) throw notFound('Warehouse not found');
  if (warehouse.isActive === false) {
    throw badRequest('An inactive warehouse cannot be the main warehouse');
  }
  if (warehouse.isMain) return findWarehouseById(id);

  await WarehouseModel.updateMany({ isMain: true, _id: { $ne: id } }, { $set: { isMain: false } });
  await WarehouseModel.updateOne({ _id: id }, { $set: { isMain: true } });

  logActivityAsync({
    employeeId: actorId,
    module: 'warehouse',
    entityId: id,
    action: 'updated',
    changes: { isMain: { from: false, to: true } },
    meta: { name: warehouse.name },
  });

  return findWarehouseById(id);
}

/**
 * Trash a warehouse. Refused while it is Main, while it still holds stock in any bucket, or while
 * an unfinished transfer points at it — otherwise the stock would simply vanish from the books.
 */
export async function trashWarehouse(id: string, actorId?: string) {
  const warehouse = await WarehouseModel.findOne({ _id: id, isTrashed: { $ne: true } });
  if (!warehouse) throw notFound('Warehouse not found');

  if (warehouse.isMain) {
    throw badRequest('The main warehouse cannot be deleted — mark another warehouse as Main first');
  }

  const held = await WarehouseStockModel.findOne({
    warehouseId: id,
    $or: [{ sellable: { $gt: 0 } }, { damaged: { $gt: 0 } }, { inTransit: { $gt: 0 } }],
  })
    .select('_id')
    .lean();
  if (held) {
    throw badRequest(
      'This warehouse still holds stock. Transfer it out or write it off before deleting the warehouse.',
    );
  }

  const openTransfer = await StockTransferModel.findOne({
    $or: [{ fromWarehouseId: id }, { toWarehouseId: id }],
    status: { $in: ['pending', 'approved', 'mismatch'] },
    isTrashed: { $ne: true },
  })
    .select('documentNo')
    .lean();
  if (openTransfer) {
    throw badRequest(
      `Transfer #${openTransfer.documentNo ?? ''} is still open for this warehouse. Finish or cancel it first.`,
    );
  }

  warehouse.isTrashed = true;
  warehouse.trashedAt = new Date();
  warehouse.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await warehouse.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'warehouse',
    entityId: id,
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { name: warehouse.name },
  });

  return { message: 'Warehouse moved to trash successfully' };
}

export async function restoreWarehouse(id: string, actorId?: string) {
  const warehouse = await WarehouseModel.findOne({ _id: id, isTrashed: true });
  if (!warehouse) throw notFound('Warehouse not found in trash');
  await assertNameFree(warehouse.name, id);

  warehouse.isTrashed = false;
  warehouse.trashedAt = undefined;
  warehouse.trashedBy = undefined;
  await warehouse.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'warehouse',
    entityId: id,
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { name: warehouse.name },
  });

  return findWarehouseById(id);
}

export async function permanentlyDeleteWarehouse(id: string, actorId?: string) {
  const warehouse = await WarehouseModel.findOne({ _id: id, isTrashed: true });
  if (!warehouse) throw notFound('Warehouse not found in trash');

  await WarehouseStockModel.deleteMany({ warehouseId: id, sellable: 0, damaged: 0, inTransit: 0 });

  await WarehouseModel.findByIdAndDelete(id);

  logActivityAsync({
    employeeId: actorId,
    module: 'warehouse',
    entityId: id,
    action: 'deleted',
    meta: { name: warehouse.name, permanent: true },
  });

  return { message: 'Warehouse permanently deleted successfully' };
}
