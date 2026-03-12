import api from './api';

export interface DashboardStats {
  stats: {
    totalEmployees: number;
    totalDealers: number;
    totalTasks: number;
    tasksCompletedToday: number;
    tasksInProgress: number;
  };
  recentActivity: any[];
  completedTasksForMap: any[];
}

export const dashboardService = {
  async getStats(): Promise<DashboardStats> {
    const response = await api.get('/dashboard/stats');
    return response.data;
  },
};
