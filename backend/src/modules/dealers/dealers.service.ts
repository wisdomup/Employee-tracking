import { Types } from 'mongoose';
import { MAX_DEALERS_PER_ROUTE } from '../../constants/global';
import { DealerModel } from '../../models/dealer.model';
import { calculateDistance } from '../../services/distance.service';
import { badRequest, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

const ROUTE_DEALER_LIMIT_MESSAGE =
  `This route already has the maximum of ${MAX_DEALERS_PER_ROUTE} dealers. You cannot add this dealer or any more dealers to this route — max limit reached. Create another route to add dealers.`;

const DEALER_PHONE_EXISTS_MESSAGE =
  'This phone number already exists. Another dealer is already registered with this phone number — please enter a different phone number.';

/** Match duplicates ignoring leading/trailing spaces (consistent with stored trimmed values). */
async function assertDealerPhoneAvailable(phone: string, excludeDealerId?: string) {
  const normalized = phone.trim();
  if (!normalized) {
    throw badRequest('Phone number is required.');
  }
  const filter: Record<string, unknown> = {
    $expr: { $eq: [{ $trim: { input: '$phone' } }, normalized] },
  };
  if (excludeDealerId) {
    filter._id = { $ne: new Types.ObjectId(excludeDealerId) };
  }
  const existing = await DealerModel.findOne(filter).exec();
  if (existing) {
    throw badRequest(DEALER_PHONE_EXISTS_MESSAGE);
  }
}

function isPhoneDuplicateKey(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  if ((err as { code: number }).code !== 11000) return false;
  const o = err as { keyPattern?: Record<string, unknown>; keyValue?: Record<string, unknown> };
  if (o.keyPattern && Object.prototype.hasOwnProperty.call(o.keyPattern, 'phone')) return true;
  if (o.keyValue && Object.prototype.hasOwnProperty.call(o.keyValue, 'phone')) return true;
  return false;
}

async function assertCanAssignDealerToRoute(routeId: string, excludeDealerId?: string) {
  const filter: Record<string, unknown> = { route: new Types.ObjectId(routeId) };
  if (excludeDealerId) {
    filter._id = { $ne: new Types.ObjectId(excludeDealerId) };
  }
  const count = await DealerModel.countDocuments(filter).exec();
  if (count >= MAX_DEALERS_PER_ROUTE) {
    throw badRequest(ROUTE_DEALER_LIMIT_MESSAGE);
  }
}

export async function createDealer(
  data: {
    name: string;
    shopName: string;
    phone: string;
    email?: string;
    address?: object;
    latitude?: number;
    longitude?: number;
    shopImage?: string;
    profilePicture?: string;
    category?: string;
    rating?: number;
    status?: string;
    route?: string;
  },
  userId?: string,
) {
  await assertDealerPhoneAvailable(data.phone);
  if (data.route) {
    await assertCanAssignDealerToRoute(data.route);
  }
  const payload: Record<string, unknown> = { ...data, phone: data.phone.trim() };
  if (data.route) {
    payload.route = new Types.ObjectId(data.route);
  }
  if (userId) payload.createdBy = new Types.ObjectId(userId);
  try {
    const dealer = await DealerModel.create(payload);
    logActivityAsync({
      employeeId: userId,
      module: 'dealer',
      entityId: String(dealer._id),
      action: 'created',
      meta: { name: dealer.name, shopName: dealer.shopName, phone: dealer.phone, status: dealer.status },
    });
    return dealer;
  } catch (err) {
    if (isPhoneDuplicateKey(err)) {
      throw badRequest(DEALER_PHONE_EXISTS_MESSAGE);
    }
    throw err;
  }
}

export async function findAll(filters?: { status?: string; search?: string; routeId?: string }) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.status) query.status = filters.status;
  if (filters?.routeId) query.route = new Types.ObjectId(filters.routeId);

  if (filters?.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { shopName: { $regex: filters.search, $options: 'i' } },
      { phone: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
    ];
  }

  return DealerModel.find(query).populate('route').populate('createdBy', '-password').sort({ createdAt: -1 }).exec();
}

export async function findById(id: string) {
  const dealer = await DealerModel.findOne({ _id: id, isTrashed: { $ne: true } }).populate('route').populate('createdBy', '-password').exec();

  if (!dealer) {
    throw notFound('Dealer not found');
  }

  return dealer;
}

export async function findByLocation(lat: number, lng: number, radius: number) {
  const dealers = await DealerModel.find({ status: 'active', isTrashed: { $ne: true } }).exec();

  return dealers.filter((dealer) => {
    if (dealer.latitude == null || dealer.longitude == null) return false;
    const distance = calculateDistance(lat, lng, dealer.latitude, dealer.longitude);
    return distance <= radius;
  });
}

export async function updateDealer(
  id: string,
  data: {
    name?: string;
    shopName?: string;
    phone?: string;
    email?: string;
    address?: object;
    latitude?: number;
    longitude?: number;
    shopImage?: string;
    profilePicture?: string;
    category?: string;
    rating?: number;
    status?: string;
    route?: string;
  },
  actorId?: string,
) {
  const dealer = await DealerModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!dealer) {
    throw notFound('Dealer not found');
  }

  const previousStatus = dealer.status;
  const update: Record<string, unknown> = { ...data };
  if (data.phone !== undefined) {
    await assertDealerPhoneAvailable(data.phone, id);
    update.phone = data.phone.trim();
  }
  if (data.route !== undefined) {
    const targetRouteId = data.route || null;
    const currentRouteId = dealer.route ? dealer.route.toString() : null;
    if (targetRouteId && targetRouteId !== currentRouteId) {
      await assertCanAssignDealerToRoute(targetRouteId, id);
    }
    update.route = data.route ? new Types.ObjectId(data.route) : null;
  }
  Object.assign(dealer, update);
  try {
    await dealer.save();
  } catch (err) {
    if (isPhoneDuplicateKey(err)) {
      throw badRequest(DEALER_PHONE_EXISTS_MESSAGE);
    }
    throw err;
  }

  const nextStatus = typeof data.status === 'string' ? data.status : undefined;
  const statusChanged = nextStatus !== undefined && previousStatus !== nextStatus;
  logActivityAsync({
    employeeId: actorId,
    module: 'dealer',
    entityId: String(dealer._id),
    action: statusChanged ? 'status_changed' : 'updated',
    changes: statusChanged
      ? { status: { from: previousStatus, to: nextStatus } }
      : undefined,
    meta: { name: dealer.name, shopName: dealer.shopName, phone: dealer.phone, status: dealer.status },
  });

  return dealer.populate('route');
}

export async function deleteDealer(id: string, actorId?: string) {
  const dealer = await DealerModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!dealer) {
    throw notFound('Dealer not found');
  }

  dealer.isTrashed = true;
  dealer.trashedAt = new Date();
  dealer.trashedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await dealer.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'dealer',
    entityId: String(dealer._id),
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
    meta: { name: dealer.name, shopName: dealer.shopName, phone: dealer.phone, status: dealer.status },
  });

  return { message: 'Dealer moved to trash successfully' };
}

export async function restoreDealer(id: string, actorId?: string) {
  let dealer = await DealerModel.findOne({ _id: id, isTrashed: true });
  if (!dealer) {
    // Compatibility fallback: allow restore when legacy/partial states exist.
    dealer = await DealerModel.findById(id);
  }
  if (!dealer) throw notFound('Dealer not found');
  dealer.isTrashed = false;
  dealer.trashedAt = undefined;
  dealer.trashedBy = undefined;
  await dealer.save();
  logActivityAsync({
    employeeId: actorId,
    module: 'dealer',
    entityId: String(dealer._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { name: dealer.name, shopName: dealer.shopName, phone: dealer.phone, status: dealer.status },
  });
  return dealer;
}

export async function permanentlyDeleteDealer(id: string, actorId?: string) {
  const dealer = await DealerModel.findOne({ _id: id, isTrashed: true });
  if (!dealer) throw notFound('Dealer not found in trash');
  await DealerModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'dealer',
    entityId: String(dealer._id),
    action: 'deleted',
    meta: { name: dealer.name, shopName: dealer.shopName, phone: dealer.phone, status: dealer.status, permanent: true },
  });
  return { message: 'Dealer permanently deleted successfully' };
}
