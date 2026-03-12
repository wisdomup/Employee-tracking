import { Schema, model, Document, Types } from 'mongoose';

export interface ILeave extends Document {
  _id: Types.ObjectId;
  leaveType: 'full_day' | 'half_day' | 'short_leave';
  employeeId: Types.ObjectId;
  leaveReason?: string;
  status: 'pending' | 'approved' | 'rejected';
  leaveDate: Date;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const leaveSchema = new Schema<ILeave>(
  {
    leaveType: {
      type: String,
      enum: ['full_day', 'half_day', 'short_leave'],
      required: true,
    },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    leaveReason: { type: String },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    leaveDate: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
  },
  { timestamps: true },
);

leaveSchema.index({ employeeId: 1 });
leaveSchema.index({ status: 1 });
leaveSchema.index({ leaveDate: 1 });

export const LeaveModel = model<ILeave>('Leave', leaveSchema);
