import { Schema, model, Document, Types } from 'mongoose';

export type BroadcastAudienceType =
  | 'all'
  | 'all_employees'
  | 'role_order_taker'
  | 'role_delivery_man'
  | 'role_warehouse_manager'
  | 'specific_users';

export interface IBroadcastNotification extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  audienceType: BroadcastAudienceType;
  targetUserIds: Types.ObjectId[];
  /** @deprecated migrated to audienceType; may exist on old documents until migration runs */
  broadcastTo?: string;
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
    audienceType: {
      type: String,
      enum: [
        'all',
        'all_employees',
        'role_order_taker',
        'role_delivery_man',
        'role_warehouse_manager',
        'specific_users',
      ],
      required: true,
    },
    targetUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    broadcastTo: { type: String },
    startAt: { type: Date },
    endAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

broadcastNotificationSchema.index({ audienceType: 1 });
broadcastNotificationSchema.index({ targetUserIds: 1 });
broadcastNotificationSchema.index({ createdBy: 1 });

export const BroadcastNotificationModel = model<IBroadcastNotification>(
  'BroadcastNotification',
  broadcastNotificationSchema,
);
