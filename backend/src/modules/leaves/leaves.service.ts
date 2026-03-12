import { Types } from 'mongoose';
import { LeaveModel } from '../../models/leave.model';
import { notFound, badRequest } from '../../utils/app-error';

export async function createLeave(
  data: {
    leaveType: 'full_day' | 'half_day' | 'short_leave';
    leaveReason?: string;
    leaveDate: Date;
  },
  employeeId: string,
) {
  return LeaveModel.create({
    ...data,
    employeeId: new Types.ObjectId(employeeId),
  });
}

export async function findAll(filters?: {
  employeeId?: string;
  status?: string;
}) {
  const query: Record<string, unknown> = {};

  if (filters?.employeeId) query.employeeId = new Types.ObjectId(filters.employeeId);
  if (filters?.status) query.status = filters.status;

  return LeaveModel.find(query)
    .populate('employeeId', '-password')
    .populate('approvedBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const leave = await LeaveModel.findById(id)
    .populate('employeeId', '-password')
    .populate('approvedBy', '-password')
    .exec();

  if (!leave) {
    throw notFound('Leave not found');
  }

  return leave;
}

export async function updateLeave(
  id: string,
  data: {
    leaveType?: 'full_day' | 'half_day' | 'short_leave';
    leaveReason?: string;
    leaveDate?: Date;
    status?: 'pending' | 'approved' | 'rejected';
  },
  options?: { isAdmin?: boolean; userId?: string },
) {
  const leave = await LeaveModel.findById(id);
  const isAdmin = options?.isAdmin ?? false;

  if (!leave) {
    throw notFound('Leave not found');
  }

  // Only non-admin users are restricted to editing pending leaves; admin can edit any status
  if (!isAdmin && leave.status !== 'pending') {
    throw badRequest('Only pending leave requests can be edited');
  }

  if (data.leaveType != null) leave.leaveType = data.leaveType;
  if (data.leaveReason !== undefined) leave.leaveReason = data.leaveReason;
  if (data.leaveDate != null) leave.leaveDate = data.leaveDate;

  // Only admin can change status; when setting approved/rejected, set approvedBy/approvedAt
  if (data.status != null && isAdmin) {
    leave.status = data.status;
    if (data.status === 'approved' || data.status === 'rejected') {
      leave.approvedBy = options?.userId ? new Types.ObjectId(options.userId) : leave.approvedBy;
      leave.approvedAt = new Date();
    } else {
      leave.approvedBy = undefined;
      leave.approvedAt = undefined;
    }
  }

  await leave.save();

  return leave;
}

export async function updateLeaveStatus(
  id: string,
  status: 'approved' | 'rejected',
  adminId: string,
) {
  const leave = await LeaveModel.findById(id);

  if (!leave) {
    throw notFound('Leave not found');
  }

  if (leave.status !== 'pending') {
    throw badRequest('Leave has already been processed');
  }

  leave.status = status;
  leave.approvedBy = new Types.ObjectId(adminId);
  leave.approvedAt = new Date();
  await leave.save();

  return leave;
}

export async function deleteLeave(id: string) {
  const leave = await LeaveModel.findById(id);

  if (!leave) {
    throw notFound('Leave not found');
  }

  if (leave.status === 'approved') {
    throw badRequest('Cannot delete an approved leave');
  }

  await LeaveModel.findByIdAndDelete(id);

  return { message: 'Leave deleted successfully' };
}
