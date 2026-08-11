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

export interface CompletedTaskMapEntry {
  taskName?: string;
  employeeName?: string;
  /** The shop's own coordinates. `dealerLocation` is the same object under the older name. */
  clientLocation: { latitude: number; longitude: number; name?: string } | null;
  dealerLocation: { latitude: number; longitude: number; name?: string } | null;
  completionLocation: { latitude?: number; longitude?: number } | null;
  completedAt?: string;
}

export interface DashboardStats {
  /**
   * The `YYYY-MM-DD` the visit figures cover, from the server. Cards build their links from
   * this rather than the browser's own clock, so the number and the list it opens agree.
   */
  today: string;
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
    /** Visits are the unit of field work; the task counts above are the legacy module. */
    visitsToday: number;
    visitsCompletedToday: number;
    visitsOpenToday: number;
    ordersToday: number;
    deliveredSalesToday: number;
    bookedSalesToday: number;
  };
  recentActivity: RecentActivityEntry[];
  completedTasksForMap: CompletedTaskMapEntry[];
}

/** The signed-in user's own figures for one day — backs the salesman dashboard cards. */
export interface MyDashboardStats {
  date: string;
  visits: {
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
    skipped: number;
    incomplete: number;
    cancelled: number;
  };
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
  };
  sales: {
    deliveredAmount: number;
    bookedAmount: number;
    totalAmount: number;
  };
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

/** KPI tiles on `/reports` that drill down into a detail page. Values match the backend enum. */
export type ReportDetailMetric =
  | 'current-stock'
  | 'stock-hold'
  | 'returned-qty'
  | 'damaged-qty'
  | 'sold-qty'
  | 'earned'
  | 'paid-back'
  | 'net-after-returns'
  | 'booked-sales';

export type ReportDetailColumnType = 'text' | 'number' | 'currency' | 'date';

export interface ReportDetailColumn {
  key: string;
  title: string;
  type?: ReportDetailColumnType;
}

export interface ReportDetailSummaryItem {
  label: string;
  value: number;
  type?: ReportDetailColumnType;
}

export interface ReportDetail {
  metric: ReportDetailMetric;
  title: string;
  description: string;
  /** `false` for all-time snapshots (stock, returns) — the date filter does not apply. */
  dateFiltered: boolean;
  filters: { startDate: string; endDate: string };
  columns: ReportDetailColumn[];
  summary: ReportDetailSummaryItem[];
  rows: Record<string, any>[];
  /** `true` when the row cap was hit and the list is partial. */
  truncated: boolean;
}

export const dashboardService = {
  async getStats(): Promise<DashboardStats> {
    const response = await api.get('/dashboard/stats');
    return response.data;
  },

  /**
   * The caller's own visit/task/sale counts for a day, aggregated server-side. Replaces
   * fetching whole lists and filtering them in the browser.
   */
  async getMyStats(date?: string): Promise<MyDashboardStats> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    const response = await api.get(`/dashboard/my-stats${query}`);
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

  async getReportDetail(
    metric: ReportDetailMetric,
    filters?: Pick<DashboardReportFilters, 'startDate' | 'endDate'>,
  ): Promise<ReportDetail> {
    const params = new URLSearchParams({ metric });
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    const response = await api.get(`/dashboard/reports/detail?${params.toString()}`);
    return response.data;
  },
};
