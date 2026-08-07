import { Schema, model, Document, Types } from 'mongoose';

export type BroadcastAudienceType =
  | 'all'
  | 'all_employees'
  | 'role_order_taker'
  | 'role_delivery_man'
  | 'role_warehouse_manager'
  | 'role_warehouse_staff'
  | 'specific_users';

const AUDIENCE_TYPES: BroadcastAudienceType[] = [
  'all',
  'all_employees',
  'role_order_taker',
  'role_delivery_man',
  'role_warehouse_manager',
  'role_warehouse_staff',
  'specific_users',
];

/**
 * Who wrote this notification. `admin` entries are the hand-written broadcasts that already
 * existed; `system` entries are raised by the app itself (a transfer awaiting approval, a quantity
 * mismatch, low stock) and must not be editable or deletable from the broadcast admin screens —
 * they are a log, not a message someone composed.
 */
export type BroadcastSource = 'admin' | 'system';

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
  source: BroadcastSource;
  /** Deep link into the app, e.g. `/warehouse/transfers/<id>`. Rendered as an "Open" button. */
  link?: string;
  /**
   * Stable key for a system event, unique when set. Stops a recurring job (low stock, nightly
   * integrity check) from re-raising the same alert every run.
   */
  eventKey?: string;
  /** Optional: system notifications have no human author. */
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const broadcastNotificationSchema = new Schema<IBroadcastNotification>(
  {
    title: { type: String, required: true },
    description: { type: String },
    audienceType: { type: String, enum: AUDIENCE_TYPES, required: true },
    targetUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    broadcastTo: { type: String },
    startAt: { type: Date },
    endAt: { type: Date },
    source: { type: String, enum: ['admin', 'system'], default: 'admin', index: true },
    link: { type: String, trim: true, maxlength: 500 },
    eventKey: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

broadcastNotificationSchema.index({ audienceType: 1 });
broadcastNotificationSchema.index({ targetUserIds: 1 });
broadcastNotificationSchema.index({ createdBy: 1 });
broadcastNotificationSchema.index({ eventKey: 1 }, { unique: true, sparse: true });

export const BroadcastNotificationModel = model<IBroadcastNotification>(
  'BroadcastNotification',
  broadcastNotificationSchema,
);
