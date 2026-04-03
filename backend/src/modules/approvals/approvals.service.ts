import { Types } from 'mongoose';
import { ApprovalModel, ApprovalType, LeaveDurationType } from '../../models/approval.model';
import { notFound, badRequest, forbidden } from '../../utils/app-error';

export async function createApproval(
  data: {
    approvalType?: ApprovalType;
    leaveType?: LeaveDurationType;
    leaveReason?: string;
    leaveDate: Date;
  },
  employeeId: string,
) {
  const approvalType = data.approvalType ?? 'leave';
  const doc: Record<string, unknown> = {
    approvalType,
    employeeId: new Types.ObjectId(employeeId),
    leaveDate: data.leaveDate,
    leaveReason: data.leaveReason,
  };
  if (approvalType === 'leave') {
    doc.leaveType = data.leaveType;
  }
  return ApprovalModel.create(doc);
}

export async function findAll(filters?: {
  employeeId?: string;
  status?: string;
  approvalType?: string;
}) {
  const query: Record<string, unknown> = {};

  if (filters?.employeeId) query.employeeId = new Types.ObjectId(filters.employeeId);
  if (filters?.status) query.status = filters.status;
  if (filters?.approvalType) query.approvalType = filters.approvalType;

  return ApprovalModel.find(query)
    .populate('employeeId', '-password')
    .populate('approvedBy', '-password')
    .sort({ createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const approval = await ApprovalModel.findById(id)
    .populate('employeeId', '-password')
    .populate('approvedBy', '-password')
    .exec();

  if (!approval) {
    throw notFound('Approval not found');
  }

  return approval;
}

export async function updateApproval(
  id: string,
  data: {
    approvalType?: ApprovalType;
    leaveType?: LeaveDurationType;
    leaveReason?: string;
    leaveDate?: Date;
    status?: 'pending' | 'approved' | 'rejected';
  },
  options?: { isAdmin?: boolean; userId?: string },
) {
  const approval = await ApprovalModel.findById(id);
  const isAdmin = options?.isAdmin ?? false;

  if (!approval) {
    throw notFound('Approval not found');
  }

  if (!isAdmin && approval.status !== 'pending') {
    throw badRequest('Only pending approvals can be edited');
  }

  if (!isAdmin && options?.userId) {
    const ownerId = approval.employeeId?.toString();
    if (ownerId !== options.userId) {
      throw forbidden('You can only edit your own approvals');
    }
  }

  if (data.approvalType != null) approval.approvalType = data.approvalType;
  if (data.leaveReason !== undefined) approval.leaveReason = data.leaveReason;
  if (data.leaveDate != null) approval.leaveDate = data.leaveDate;
  if (data.leaveType !== undefined) approval.leaveType = data.leaveType;

  if (data.status != null && isAdmin) {
    approval.status = data.status;
    if (data.status === 'approved' || data.status === 'rejected') {
      approval.approvedBy = options?.userId ? new Types.ObjectId(options.userId) : approval.approvedBy;
      approval.approvedAt = new Date();
    } else {
      approval.approvedBy = undefined;
      approval.approvedAt = undefined;
    }
  }

  if (approval.approvalType !== 'leave') {
    approval.leaveType = undefined;
  } else if (!approval.leaveType) {
    throw badRequest('Duration is required for leave-type approvals');
  }

  if (approval.approvalType !== 'leave') {
    const reason = approval.leaveReason?.trim();
    if (!reason) {
      throw badRequest('Details are required for this approval type');
    }
  }

  await approval.save();

  return approval;
}

export async function updateApprovalStatus(
  id: string,
  status: 'approved' | 'rejected',
  adminId: string,
) {
  const approval = await ApprovalModel.findById(id);

  if (!approval) {
    throw notFound('Approval not found');
  }

  if (approval.status !== 'pending') {
    throw badRequest('Approval has already been processed');
  }

  approval.status = status;
  approval.approvedBy = new Types.ObjectId(adminId);
  approval.approvedAt = new Date();
  await approval.save();

  return approval;
}

export async function deleteApproval(
  id: string,
  options?: { isAdmin?: boolean; userId?: string },
) {
  const approval = await ApprovalModel.findById(id);
  const isAdmin = options?.isAdmin ?? false;

  if (!approval) {
    throw notFound('Approval not found');
  }

  if (!isAdmin && options?.userId) {
    const ownerId = approval.employeeId?.toString();
    if (ownerId !== options.userId) {
      throw forbidden('You can only delete your own approvals');
    }
    if (approval.status !== 'pending') {
      throw badRequest('You can only delete approvals that are still pending');
    }
  }

  if (approval.status === 'approved') {
    throw badRequest('Cannot delete an approved request');
  }

  await ApprovalModel.findByIdAndDelete(id);

  return { message: 'Approval deleted successfully' };
}
