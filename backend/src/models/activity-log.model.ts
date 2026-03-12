import { Schema, model, Document, Types } from 'mongoose';

export interface IActivityLog extends Document {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  taskId: Types.ObjectId;
  action: 'started_task' | 'completed_task';
  latitude: number;
  longitude: number;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    action: {
      type: String,
      enum: ['started_task', 'completed_task'],
      required: true,
    },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

activityLogSchema.index({ employeeId: 1 });
activityLogSchema.index({ timestamp: -1 });

export const ActivityLogModel = model<IActivityLog>('ActivityLog', activityLogSchema);
