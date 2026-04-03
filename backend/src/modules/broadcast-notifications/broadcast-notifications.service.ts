import { Types } from 'mongoose';
import { BroadcastNotificationModel, BroadcastAudienceType } from '../../models/broadcast-notification.model';
import { BroadcastNotificationReadModel } from '../../models/broadcast-notification-read.model';
import { UserModel } from '../../models/user.model';
import { notFound, badRequest } from '../../utils/app-error';

const INBOX_FETCH_LIMIT = 120;
const INBOX_RESULT_LIMIT = 50;

/** Resolve audience from document (supports legacy `broadcastTo` before migration). */
export function resolvedAudienceType(doc: {
  audienceType?: BroadcastAudienceType;
  broadcastTo?: string;
}): BroadcastAudienceType | undefined {
  if (doc.audienceType) return doc.audienceType;
  if (doc.broadcastTo === 'all') return 'all';
  if (doc.broadcastTo === 'employees') return 'all_employees';
  return undefined;
}

export function isNotificationActiveAt(
  doc: { startAt?: Date | null; endAt?: Date | null },
  now: Date,
): boolean {
  if (doc.startAt && new Date(doc.startAt).getTime() > now.getTime()) return false;
  if (doc.endAt && new Date(doc.endAt).getTime() < now.getTime()) return false;
  return true;
}

export function notificationVisibleToUser(
  doc: {
    audienceType?: BroadcastAudienceType;
    broadcastTo?: string;
    targetUserIds?: Types.ObjectId[] | string[] | unknown[];
  },
  userId: string,
  role: string,
): boolean {
  const at = resolvedAudienceType(doc);
  if (!at) return false;

  const uid = String(userId);

  switch (at) {
    case 'all':
      return true;
    case 'all_employees':
      return role !== 'admin';
    case 'role_order_taker':
      return role === 'order_taker';
    case 'role_delivery_man':
      return role === 'delivery_man';
    case 'role_warehouse_manager':
      return role === 'warehouse_manager';
    case 'specific_users': {
      const ids = doc.targetUserIds || [];
      return ids.some((id) => String(id) === uid);
    }
    default:
      return false;
  }
}

async function assertTargetUsersValid(ids: Types.ObjectId[]) {
  if (ids.length === 0) {
    throw badRequest('Select at least one employee for specific audience');
  }
  const count = await UserModel.countDocuments({
    _id: { $in: ids },
    role: { $ne: 'admin' },
    isTrashed: { $ne: true },
    isActive: true,
  });
  if (count !== ids.length) {
    throw badRequest('One or more selected users are invalid or inactive');
  }
}

export async function createNotification(
  data: {
    title: string;
    description?: string;
    audienceType: BroadcastAudienceType;
    targetUserIds?: string[];
    startAt?: Date;
    endAt?: Date;
  },
  userId: string,
) {
  let targetUserIds: Types.ObjectId[] = [];
  if (data.audienceType === 'specific_users') {
    if (!data.targetUserIds?.length) {
      throw badRequest('targetUserIds is required for specific_users audience');
    }
    targetUserIds = data.targetUserIds.map((id) => new Types.ObjectId(id));
    await assertTargetUsersValid(targetUserIds);
  }

  return BroadcastNotificationModel.create({
    title: data.title,
    description: data.description,
    audienceType: data.audienceType,
    targetUserIds,
    startAt: data.startAt,
    endAt: data.endAt,
    createdBy: new Types.ObjectId(userId),
  });
}

export async function findAll(filters?: { audienceType?: string }) {
  const query: Record<string, unknown> = {};
  if (filters?.audienceType) query.audienceType = filters.audienceType;

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

export async function findByIdForViewer(
  id: string,
  options: { userId: string; role: string; isAdmin: boolean },
) {
  const notification = await findById(id);
  if (options.isAdmin) {
    return notification;
  }
  const plain = notification.toObject();
  if (
    !isNotificationActiveAt(plain, new Date()) ||
    !notificationVisibleToUser(plain, options.userId, options.role)
  ) {
    throw notFound('Broadcast notification not found');
  }
  return notification;
}

export async function findInboxForUser(userId: string, role: string) {
  const now = new Date();
  const raw = await BroadcastNotificationModel.find({
    $and: [
      {
        $or: [{ startAt: { $exists: false } }, { startAt: null }, { startAt: { $lte: now } }],
      },
      {
        $or: [{ endAt: { $exists: false } }, { endAt: null }, { endAt: { $gte: now } }],
      },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(INBOX_FETCH_LIMIT)
    .lean()
    .exec();

  const visible = raw.filter(
    (doc) =>
      isNotificationActiveAt(doc, now) &&
      notificationVisibleToUser(doc, userId, role),
  ).slice(0, INBOX_RESULT_LIMIT);

  const ids = visible.map((d) => d._id);
  const reads = await BroadcastNotificationReadModel.find({
    userId: new Types.ObjectId(userId),
    notificationId: { $in: ids },
  })
    .lean()
    .exec();

  const readSet = new Set(reads.map((r) => String(r.notificationId)));

  const items = visible.map((doc) => ({
    ...doc,
    read: readSet.has(String(doc._id)),
    readAt: reads.find((r) => String(r.notificationId) === String(doc._id))?.readAt,
  }));

  const unreadCount = items.filter((i) => !i.read).length;

  return { items, unreadCount };
}

export async function markAsRead(notificationId: string, userId: string, role: string) {
  const doc = await BroadcastNotificationModel.findById(notificationId).lean();
  if (!doc) {
    throw notFound('Broadcast notification not found');
  }
  const now = new Date();
  if (!isNotificationActiveAt(doc, now) || !notificationVisibleToUser(doc, userId, role)) {
    throw notFound('Broadcast notification not found');
  }

  await BroadcastNotificationReadModel.findOneAndUpdate(
    { userId: new Types.ObjectId(userId), notificationId: new Types.ObjectId(notificationId) },
    { $set: { readAt: new Date() }, $setOnInsert: { userId: new Types.ObjectId(userId), notificationId: new Types.ObjectId(notificationId) } },
    { upsert: true, new: true },
  );

  return { message: 'Marked as read' };
}

export async function updateNotification(
  id: string,
  data: {
    title: string;
    description?: string;
    audienceType: BroadcastAudienceType;
    targetUserIds?: string[];
    startAt?: Date;
    endAt?: Date;
  },
) {
  const notification = await BroadcastNotificationModel.findById(id);

  if (!notification) {
    throw notFound('Broadcast notification not found');
  }

  let targetUserIds: Types.ObjectId[] = notification.targetUserIds || [];
  if (data.audienceType === 'specific_users') {
    if (!data.targetUserIds?.length) {
      throw badRequest('targetUserIds is required for specific_users audience');
    }
    targetUserIds = data.targetUserIds.map((x) => new Types.ObjectId(x));
    await assertTargetUsersValid(targetUserIds);
  } else {
    targetUserIds = [];
  }

  notification.title = data.title;
  notification.description = data.description;
  notification.audienceType = data.audienceType;
  notification.targetUserIds = targetUserIds;
  notification.startAt = data.startAt;
  notification.endAt = data.endAt;
  notification.broadcastTo = undefined;

  await notification.save();

  return notification;
}

export async function deleteNotification(id: string) {
  const notification = await BroadcastNotificationModel.findById(id);

  if (!notification) {
    throw notFound('Broadcast notification not found');
  }

  await BroadcastNotificationReadModel.deleteMany({ notificationId: new Types.ObjectId(id) });
  await BroadcastNotificationModel.findByIdAndDelete(id);

  return { message: 'Broadcast notification deleted successfully' };
}
