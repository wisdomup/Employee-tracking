import { Schema, model, Document, Types } from 'mongoose';

export type BroadcastTarget = 'all' | 'employees' | 'dealers' | 'customers';

export interface IBroadcastNotification extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  broadcastTo: BroadcastTarget;
  startAt?: Date;
  endAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const broadcastNotificationSchema = new Schema<IBroadcastNotification>(
  {
    title: { type: String, required: true },
    description: { type: String },
    broadcastTo: {
      type: String,
      enum: ['all', 'employees', 'dealers', 'customers'],
      required: true,
    },
    startAt: { type: Date },
    endAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

broadcastNotificationSchema.index({ broadcastTo: 1 });
broadcastNotificationSchema.index({ createdBy: 1 });

export const BroadcastNotificationModel = model<IBroadcastNotification>(
  'BroadcastNotification',
  broadcastNotificationSchema,
);
