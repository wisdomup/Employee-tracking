import { Schema, model, Document, Types } from 'mongoose';

export interface IBroadcastNotificationRead extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  notificationId: Types.ObjectId;
  readAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const broadcastNotificationReadSchema = new Schema<IBroadcastNotificationRead>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notificationId: {
      type: Schema.Types.ObjectId,
      ref: 'BroadcastNotification',
      required: true,
    },
    readAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

broadcastNotificationReadSchema.index({ userId: 1, notificationId: 1 }, { unique: true });
broadcastNotificationReadSchema.index({ notificationId: 1 });

export const BroadcastNotificationReadModel = model<IBroadcastNotificationRead>(
  'BroadcastNotificationRead',
  broadcastNotificationReadSchema,
);
