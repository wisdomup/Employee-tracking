import api from './api';

export interface Leave {
  _id: string;
  leaveType: 'full_day' | 'half_day' | 'short_leave';
  employeeId: any;
  leaveReason?: string;
  status: 'pending' | 'approved' | 'rejected';
  leaveDate: string;
  approvedBy?: any;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const leaveService = {
  async getLeaves(filters?: { employeeId?: string; status?: string }) {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.status) params.append('status', filters.status);
    const response = await api.get(`/leaves?${params.toString()}`);
    return response.data;
  },

  async getLeave(id: string) {
    const response = await api.get(`/leaves/${id}`);
    return response.data;
  },

  async createLeave(data: {
    leaveType: 'full_day' | 'half_day' | 'short_leave';
    leaveDate: string;
    leaveReason?: string;
  }) {
    const response = await api.post('/leaves', data);
    return response.data;
  },

  async updateLeave(
    id: string,
    data: {
      leaveType?: 'full_day' | 'half_day' | 'short_leave';
      leaveDate?: string;
      leaveReason?: string;
      status?: 'pending' | 'approved' | 'rejected';
    },
  ) {
    const response = await api.patch(`/leaves/${id}`, data);
    return response.data;
  },

  async updateLeaveStatus(id: string, status: 'approved' | 'rejected') {
    const response = await api.patch(`/leaves/${id}/status`, { status });
    return response.data;
  },

  async deleteLeave(id: string) {
    const response = await api.delete(`/leaves/${id}`);
    return response.data;
  },
};
