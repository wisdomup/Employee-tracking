import api from './api';

export interface RecentActivityEntry {
  _id: string;
  employeeId?: { username?: string };
  module?: string;
  action: string;
  entityId?: string;
  taskId?: { taskName?: string };
  timestamp: string;
}

export interface DashboardStats {
  stats: {
    activeEmployees: number;
    inactiveEmployees: number;
    totalClients: number;
    totalTasks: number;
    tasksCompletedToday: number;
    tasksInProgress: number;
    totalProducts: number;
    totalCategories: number;
    totalOrders: number;
    totalPendingOrders: number;
    totalRoutes: number;
  };
  recentActivity: RecentActivityEntry[];
  completedTasksForMap: any[];
}

export interface DashboardReportFilters {
  startDate?: string;
  endDate?: string;
  groupBy?: 'day' | 'month' | 'year';
  viewBy?: 'item' | 'category';
}

export interface DashboardReportKpis {
  totalCurrentStock: number;
  totalHoldStock: number;
  totalReturnedQty: number;
  totalDamagedQty: number;
  totalSoldQty: number;
  salesInRange: number;
  bookedSalesInRange: number;
  totalReturnPayout: number;
  netAfterReturns: number;
  totalProducts: number;
  totalCategories: number;
}

export interface DashboardReportRow {
  productId?: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  availableQty: number;
  onHoldQty: number;
  returnedQty: number;
  damagedQty: number;
  productCount?: number;
}

export interface DashboardSalesRow {
  productId?: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  soldQty: number;
  salesAmount: number;
  orderCount: number;
  productCount?: number;
}

export interface DashboardReports {
  filters: {
    startDate: string;
    endDate: string;
    groupBy: 'day' | 'month' | 'year';
    viewBy: 'item' | 'category';
  };
  kpis: DashboardReportKpis;
  salesTrend: Array<{ period: string; totalSales: number; orderCount: number }>;
  soldQtyTrend: Array<{ period: string; soldQty: number }>;
  bookedSalesTrend: Array<{ period: string; bookedSales: number }>;
  returnPayoutTrend: Array<{ period: string; paidBack: number }>;
  categoryGrowth: Array<{ period: string; count: number }>;
  productGrowth: Array<{ period: string; count: number }>;
  returnTrend: Array<{ period: string; returnedQty: number; damagedQty: number }>;
  stockByItem: DashboardReportRow[];
  stockByCategory: DashboardReportRow[];
  stockReport: DashboardReportRow[];
  salesByItem: DashboardSalesRow[];
  salesByCategory: DashboardSalesRow[];
  salesReport: DashboardSalesRow[];
}

export const dashboardService = {
  async getStats(): Promise<DashboardStats> {
    const response = await api.get('/dashboard/stats');
    return response.data;
  },

  async getReports(filters?: DashboardReportFilters): Promise<DashboardReports> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.groupBy) params.append('groupBy', filters.groupBy);
    if (filters?.viewBy) params.append('viewBy', filters.viewBy);
    const query = params.toString();
    const response = await api.get(`/dashboard/reports${query ? `?${query}` : ''}`);
    return response.data;
  },
};
