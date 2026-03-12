import api from './api';

export interface ActivityLog {
  _id: string;
  employeeId: any;
  taskId: any;
  action: 'started_task' | 'completed_task';
  latitude: number;
  longitude: number;
  timestamp: string;
}

export const activityLogService = {
  async getActivityLogs(filters?: {
    employeeId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);

    const response = await api.get(`/activity-logs?${params.toString()}`);
    return response.data;
  },

  async getEmployeeActivityLogs(
    employeeId: string,
    filters?: { startDate?: string; endDate?: string },
  ) {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);

    const response = await api.get(
      `/activity-logs/employee/${employeeId}?${params.toString()}`,
    );
    return response.data;
  },
};
