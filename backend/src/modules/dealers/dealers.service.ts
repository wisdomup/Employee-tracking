import { Types } from 'mongoose';
import { DealerModel } from '../../models/dealer.model';
import { calculateDistance } from '../../services/distance.service';
import { notFound } from '../../utils/app-error';

export async function createDealer(
  data: {
    name: string;
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
  const payload: Record<string, unknown> = { ...data };
  if (data.route) {
    payload.route = new Types.ObjectId(data.route);
  }
  if (userId) payload.createdBy = new Types.ObjectId(userId);
  return DealerModel.create(payload);
}

export async function findAll(filters?: { status?: string; search?: string; routeId?: string }) {
  const query: Record<string, unknown> = {};

  if (filters?.status) query.status = filters.status;
  if (filters?.routeId) query.route = new Types.ObjectId(filters.routeId);

  if (filters?.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { phone: { $regex: filters.search, $options: 'i' } },
      { email: { $regex: filters.search, $options: 'i' } },
    ];
  }

  return DealerModel.find(query).populate('route').populate('createdBy', '-password').sort({ createdAt: -1 }).exec();
}

export async function findById(id: string) {
  const dealer = await DealerModel.findById(id).populate('route').populate('createdBy', '-password').exec();

  if (!dealer) {
    throw notFound('Dealer not found');
  }

  return dealer;
}

export async function findByLocation(lat: number, lng: number, radius: number) {
  const dealers = await DealerModel.find({ status: 'active' }).exec();

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
) {
  const dealer = await DealerModel.findById(id);

  if (!dealer) {
    throw notFound('Dealer not found');
  }

  const update: Record<string, unknown> = { ...data };
  if (data.route !== undefined) {
    update.route = data.route ? new Types.ObjectId(data.route) : null;
  }
  Object.assign(dealer, update);
  await dealer.save();

  return dealer.populate('route');
}

export async function deleteDealer(id: string) {
  const dealer = await DealerModel.findById(id);

  if (!dealer) {
    throw notFound('Dealer not found');
  }

  await DealerModel.findByIdAndDelete(id);

  return { message: 'Dealer deleted successfully' };
}
