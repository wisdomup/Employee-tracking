import api from './api';

export interface ActivityLog {
  _id: string;
  employeeId?: any;
  module: 'task' | 'order' | 'product' | 'category' | 'client' | 'route' | 'return' | 'visit' | 'employee';
  entityId: string;
  taskId?: any;
  action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'started_task' | 'completed_task';
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  meta?: Record<string, unknown>;
  timestamp: string;
}

export const activityLogService = {
  async getActivityLogs(filters?: {
    employeeId?: string;
    module?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.module) params.append('module', filters.module);
    if (filters?.action) params.append('action', filters.action);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.limit) params.append('limit', String(filters.limit));

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
