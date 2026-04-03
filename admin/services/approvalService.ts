import api from './api';

export type ApprovalType = 'leave' | 'allowance' | 'advance_salary' | 'query' | 'other';
export type LeaveDurationType = 'full_day' | 'half_day' | 'short_leave';

export interface Approval {
  _id: string;
  approvalType: ApprovalType;
  leaveType?: LeaveDurationType;
  employeeId: any;
  leaveReason?: string;
  status: 'pending' | 'approved' | 'rejected';
  leaveDate: string;
  approvedBy?: any;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const approvalService = {
  async getApprovals(filters?: {
    employeeId?: string;
    status?: string;
    approvalType?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.approvalType) params.append('approvalType', filters.approvalType);
    const response = await api.get(`/approvals?${params.toString()}`);
    return response.data;
  },

  async getApproval(id: string) {
    const response = await api.get(`/approvals/${id}`);
    return response.data;
  },

  async createApproval(data: {
    approvalType?: ApprovalType;
    leaveType?: LeaveDurationType;
    leaveDate: string;
    leaveReason?: string;
  }) {
    const response = await api.post('/approvals', data);
    return response.data;
  },

  async updateApproval(
    id: string,
    data: {
      approvalType?: ApprovalType;
      leaveType?: LeaveDurationType;
      leaveDate?: string;
      leaveReason?: string;
      status?: 'pending' | 'approved' | 'rejected';
    },
  ) {
    const response = await api.patch(`/approvals/${id}`, data);
    return response.data;
  },

  async updateApprovalStatus(id: string, status: 'approved' | 'rejected') {
    const response = await api.patch(`/approvals/${id}/status`, { status });
    return response.data;
  },

  async deleteApproval(id: string) {
    const response = await api.delete(`/approvals/${id}`);
    return response.data;
  },
};

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  leave: 'Leave',
  allowance: 'Allowance',
  advance_salary: 'Advance salary',
  query: 'Query',
  other: 'Other',
};
