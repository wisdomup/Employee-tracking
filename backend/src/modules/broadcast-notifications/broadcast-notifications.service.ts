import { Types } from 'mongoose';
import {
  BroadcastNotificationModel,
  BroadcastTarget,
} from '../../models/broadcast-notification.model';
import { notFound } from '../../utils/app-error';

export async function createNotification(
  data: {
    title: string;
    description?: string;
    broadcastTo: BroadcastTarget;
    startAt?: Date;
    endAt?: Date;
  },
  userId: string,
) {
  return BroadcastNotificationModel.create({
    ...data,
    createdBy: new Types.ObjectId(userId),
  });
}

export async function findAll(filters?: { broadcastTo?: string }) {
  const query: Record<string, unknown> = {};

  if (filters?.broadcastTo) query.broadcastTo = filters.broadcastTo;

  return BroadcastNotificationModel.find(query)
    .populate('createdBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const notification = await BroadcastNotificationModel.findById(id)
    .populate('createdBy', '-password')
    .exec();

  if (!notification) {
    throw notFound('Broadcast notification not found');
  }

  return notification;
}

export async function updateNotification(id: string, data: object) {
  const notification = await BroadcastNotificationModel.findById(id);

  if (!notification) {
    throw notFound('Broadcast notification not found');
  }

  Object.assign(notification, data);
  await notification.save();

  return notification;
}

export async function deleteNotification(id: string) {
  const notification = await BroadcastNotificationModel.findById(id);

  if (!notification) {
    throw notFound('Broadcast notification not found');
  }

  await BroadcastNotificationModel.findByIdAndDelete(id);

  return { message: 'Broadcast notification deleted successfully' };
}
