import { Types } from 'mongoose';
import { WarehouseModel } from '../../models/warehouse.model';
import { UserModel } from '../../models/user.model';
import { badRequest } from '../../utils/app-error';
import { normalizeCityKey } from '../region-sales/region-sales.rules';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

/**
 * Which warehouse does a sale come out of?
 *
 * Spec §9: "the system picks the warehouse automatically based on the salesman's city (Lahore
 * salesman → Lahore warehouse)". Cities are free text on both sides, so matching goes through
 * `normalizeCityKey` — the same normalisation the region-sales dashboard already uses, so
 * "  LAHORE " and "Lahore" are one place.
 *
 * Resolution never returns "no warehouse": that would leave a sale with nowhere to draw stock
 * from. It falls back to Main and reports WHY, so a mis-keyed city surfaces as a flag instead of
 * silently sending every order to the wrong city.
 */
export type WarehouseResolutionSource = 'user_warehouse' | 'city_match' | 'main';

export interface WarehouseResolution {
  warehouseId: Types.ObjectId;
  source: WarehouseResolutionSource;
  /** Set when the resolution had to fall back — worth surfacing to an admin. */
  note?: string;
}

/** The Main warehouse id. Everything falls back here, so its absence is a hard configuration error. */
export async function resolveMainWarehouseId(): Promise<Types.ObjectId> {
  const main = await WarehouseModel.findOne({ isMain: true, isTrashed: { $ne: true } })
    .select('_id')
    .lean();
  if (!main) {
    throw badRequest(
      'No main warehouse is configured. Create a warehouse and mark it as Main before moving stock.',
    );
  }
  return new Types.ObjectId(String(main._id));
}

export async function resolveWarehouseForUser(userId: string): Promise<WarehouseResolution> {
  const user = await UserModel.findById(userId).select('warehouseId address.city username').lean();

  // 1. An explicit assignment always wins.
  if (user?.warehouseId) {
    const assigned = await WarehouseModel.findOne({
      _id: user.warehouseId,
      isTrashed: { $ne: true },
      isActive: true,
    })
      .select('_id')
      .lean();
    if (assigned) {
      return { warehouseId: new Types.ObjectId(String(assigned._id)), source: 'user_warehouse' };
    }
  }

  // 2. Match on normalised city.
  const cityKey = normalizeCityKey(user?.address?.city);
  if (cityKey !== '') {
    const matches = await WarehouseModel.find({
      cityKey,
      isTrashed: { $ne: true },
      isActive: true,
    })
      .select('_id isMain')
      .sort({ _id: 1 })
      .lean();

    if (matches.length === 1) {
      return { warehouseId: new Types.ObjectId(String(matches[0]._id)), source: 'city_match' };
    }

    if (matches.length > 1) {
      // Two warehouses in one city is a configuration problem, not a routing decision. Pick
      // deterministically (Main, else lowest id) and flag it rather than silently first-matching.
      const chosen = matches.find((m) => m.isMain) ?? matches[0];
      logActivityAsync({
        employeeId: userId,
        module: 'warehouse',
        entityId: String(chosen._id),
        action: 'flagged',
        meta: {
          reason: 'multiple_warehouses_in_city',
          cityKey,
          candidates: matches.map((m) => String(m._id)),
        },
      });
      return {
        warehouseId: new Types.ObjectId(String(chosen._id)),
        source: 'city_match',
        note: `More than one active warehouse is configured for "${user?.address?.city}"`,
      };
    }
  }

  // 3. Fall back to Main, and say so.
  const mainId = await resolveMainWarehouseId();
  return {
    warehouseId: mainId,
    source: 'main',
    note:
      cityKey === ''
        ? 'No city is set on this user, so the main warehouse was used'
        : `No warehouse is configured for "${user?.address?.city}", so the main warehouse was used`,
  };
}
