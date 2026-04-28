import { Schema, model, Document, Types } from 'mongoose';

export type ActivityModule =
  | 'task'
  | 'order'
  | 'product'
  | 'category'
  | 'dealer'
  | 'route'
  | 'return'
  | 'visit'
  | 'employee'
  | 'attendance';

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'started_task'
  | 'completed_task';

export interface IActivityLog extends Document {
  _id: Types.ObjectId;
  employeeId?: Types.ObjectId;
  module: ActivityModule;
  entityId: string;
  action: ActivityAction;
  taskId?: Types.ObjectId;
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  meta?: Record<string, unknown>;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    module: {
      type: String,
      enum: ['task', 'order', 'product', 'category', 'dealer', 'route', 'return', 'visit', 'employee', 'attendance'],
      required: true,
    },
    entityId: { type: String, required: true },
    action: {
      type: String,
      enum: ['created', 'updated', 'deleted', 'status_changed', 'started_task', 'completed_task'],
      required: true,
    },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: false },
    changes: { type: Schema.Types.Mixed, required: false },
    meta: { type: Schema.Types.Mixed, required: false },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

activityLogSchema.index({ timestamp: -1 });
activityLogSchema.index({ module: 1, timestamp: -1 });
activityLogSchema.index({ employeeId: 1, timestamp: -1 });
activityLogSchema.index({ entityId: 1, module: 1, timestamp: -1 });

export const ActivityLogModel = model<IActivityLog>('ActivityLog', activityLogSchema);
