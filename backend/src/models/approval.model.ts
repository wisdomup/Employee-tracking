import { Schema, model, Document, Types } from 'mongoose';

export type ApprovalType = 'leave' | 'allowance' | 'advance_salary' | 'query' | 'other';
export type LeaveDurationType = 'full_day' | 'half_day' | 'short_leave';

export interface IApproval extends Document {
  _id: Types.ObjectId;
  approvalType: ApprovalType;
  leaveType?: LeaveDurationType;
  employeeId: Types.ObjectId;
  leaveReason?: string;
  status: 'pending' | 'approved' | 'rejected';
  leaveDate: Date;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const approvalSchema = new Schema<IApproval>(
  {
    approvalType: {
      type: String,
      enum: ['leave', 'allowance', 'advance_salary', 'query', 'other'],
      default: 'leave',
    },
    leaveType: {
      type: String,
      enum: ['full_day', 'half_day', 'short_leave'],
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

approvalSchema.index({ employeeId: 1 });
approvalSchema.index({ status: 1 });
approvalSchema.index({ leaveDate: 1 });
approvalSchema.index({ approvalType: 1 });

export const ApprovalModel = model<IApproval>('Approval', approvalSchema);
