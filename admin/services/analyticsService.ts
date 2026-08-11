import api from './api';

/** A User reference as the API returns it — populated by these endpoints. */
export interface PopulatedUser {
  _id: string;
  username?: string;
  fullName?: string;
  userID?: string;
  role?: string;
}

/** A Route reference as the API returns it. */
export interface PopulatedRoute {
  _id: string;
  name?: string;
}

/** Metrics a monthly target can be set on. Mirrors the backend. */
export type TargetMetric = 'salesAmount' | 'orderCount' | 'visitCount';

export type AchievementStatus =
  | 'no_target'
  | 'on_track'
  | 'at_risk'
  | 'behind'
  | 'achieved';

export interface PerformanceRow {
  employeeId: string;
  username: string;
  fullName?: string;
  userID?: string;
  role: string;
  managerId?: string;
  managerName?: string;
  // Actuals
  salesAmount: number;
  bookedAmount: number;
  orderCount: number;
  visitsCompleted: number;
  visitsAssigned: number;
  visitsSkipped: number;
  /** Self-started extras — real work, deliberately outside the adherence rate. */
  extraVisitsCompleted: number;
  extraVisitsStarted: number;
  /** Assigned + extras, i.e. everything the rider actually completed. */
  totalVisitsCompleted: number;
  /** Adherence to the assigned route only; comparable to the 75% pass mark. */
  visitCompletionRate: number;
  /** Below the 75% pass mark for the period. */
  belowVisitThreshold: boolean;
  avgVisitMinutes: number | null;
  overstayCount: number;
  newClients: number;
  // Attendance & reliability
  daysPresent: number;
  hoursWorked: number;
  avgHoursPerDay: number | null;
  // Quality
  returnCount: number;
  returnAmount: number;
  damageCount: number;
  returnRatePercent: number;
  // Tasks
  tasksAssigned: number;
  tasksCompleted: number;
  taskCompletionRate: number;
  // Collection health
  invoicedTotal: number;
  collectedTotal: number;
  outstandingTotal: number;
  collectionRatePercent: number;
  discountTotal: number;
  creditOrders: number;
  shopsOrderedFrom: number;
  // Efficiency ratios
  avgOrderValue: number;
  salesPerDayPresent: number;
  visitsPerDayPresent: number;
  strikeRatePercent: number;
  // Flags
  flagsTotal: number;
  flagsOpen: number;
  lowCompletionFlags: number;
  // Targets and progress
  targetSalesAmount: number | null;
  targetOrderCount: number | null;
  targetVisitCount: number | null;
  salesAchievementPercent: number | null;
  orderAchievementPercent: number | null;
  visitAchievementPercent: number | null;
  salesRemaining: number | null;
  status: AchievementStatus;
}

export interface PerformanceKpis {
  salesAmount: number;
  bookedAmount: number;
  orderCount: number;
  visitsCompleted: number;
  visitsAssigned: number;
  visitsSkipped: number;
  extraVisitsCompleted: number;
  totalVisitsCompleted: number;
  overstayCount: number;
  newClients: number;
  daysPresent: number;
  hoursWorked: number;
  returnCount: number;
  returnAmount: number;
  damageCount: number;
  tasksAssigned: number;
  tasksCompleted: number;
  invoicedTotal: number;
  collectedTotal: number;
  outstandingTotal: number;
  discountTotal: number;
  flagsOpen: number;
  targetSalesAmount: number;
  targetOrderCount: number;
  targetVisitCount: number;
  headcount: number;
  ridersWithTarget: number;
  ridersAchieved: number;
  ridersBehind: number;
  ridersBelowVisitThreshold: number;
  visitCompletionRate: number;
  visitThresholdPercent: number;
  taskCompletionRate: number;
  collectionRatePercent: number;
  returnRatePercent: number;
  avgOrderValue: number;
  strikeRatePercent: number;
  salesAchievementPercent: number | null;
  monthElapsedPercent: number;
}

export type PerformanceFlagType = 'low_visit_completion' | 'overstay';

export interface PerformanceFlag {
  _id: string;
  employeeId: PopulatedUser;
  type: PerformanceFlagType;
  flagDate: string;
  message: string;
  value?: number;
  threshold?: number;
  visitId?: string;
  routeId?: PopulatedRoute;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: PopulatedUser;
  createdAt: string;
}

export interface FlagSummary {
  total: number;
  lowVisitCompletion: number;
  overstay: number;
}

export interface PerformanceReport {
  filters: { periodMonth: string; start: string; end: string; employeeId: string | null };
  kpis: PerformanceKpis;
  rows: PerformanceRow[];
}

export interface PerformanceTrend {
  months: string[];
  sales: number[];
  orders: number[];
  visits: number[];
  targets: number[];
}

export interface Target {
  _id: string;
  employeeId: PopulatedUser;
  periodMonth: string;
  salesAmount?: number;
  orderCount?: number;
  visitCount?: number;
  notes?: string;
  createdBy?: PopulatedUser;
  createdAt: string;
  updatedAt: string;
}

/** Current month as `YYYY-MM`, matching the backend's canonical period key. */
export function currentPeriodMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Human label for a `YYYY-MM` key, e.g. "July 2026". */
export function formatPeriodMonth(periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number);
  if (!year || !month) return periodMonth;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The last `count` months as `YYYY-MM`, newest first — for the period picker. */
export function recentPeriodMonths(count = 12): string[] {
  const months: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < count; i += 1) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return months;
}

/** KPI tiles on `/analytics` that drill down into a detail page. Mirrors the backend enum. */
export type PerformanceDetailMetric =
  | 'sales'
  | 'target'
  | 'achievement'
  | 'booked'
  | 'orders'
  | 'visits-completed'
  | 'overstays'
  | 'new-clients'
  | 'visit-completion'
  | 'visits-skipped'
  | 'extra-visits'
  | 'total-visits-done'
  | 'open-flags'
  | 'days-present'
  | 'collected'
  | 'outstanding'
  | 'collection-rate'
  | 'returns'
  | 'avg-order-value'
  | 'strike-rate'
  | 'tasks-done'
  | 'achieved-target'
  | 'behind-pace'
  | 'below-visits';

export type DetailColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date';

export interface DetailColumn {
  key: string;
  title: string;
  type?: DetailColumnType;
}

export interface DetailSummaryItem {
  label: string;
  value: number;
  type?: DetailColumnType;
}

export interface PerformanceDetail {
  metric: PerformanceDetailMetric;
  title: string;
  description: string;
  filters: { periodMonth: string; employeeId: string | null };
  columns: DetailColumn[];
  summary: DetailSummaryItem[];
  rows: Record<string, any>[];
  /** `true` when the row cap was hit and the list is partial. */
  truncated: boolean;
}

export const analyticsService = {
  async getPerformance(filters?: {
    periodMonth?: string;
    employeeId?: string;
  }): Promise<PerformanceReport> {
    const params = new URLSearchParams();
    if (filters?.periodMonth) params.append('periodMonth', filters.periodMonth);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    const response = await api.get(`/analytics/performance?${params.toString()}`);
    return response.data;
  },

  async getPerformanceDetail(
    metric: PerformanceDetailMetric,
    filters?: { periodMonth?: string; employeeId?: string },
  ): Promise<PerformanceDetail> {
    const params = new URLSearchParams({ metric });
    if (filters?.periodMonth) params.append('periodMonth', filters.periodMonth);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    const response = await api.get(`/analytics/performance/detail?${params.toString()}`);
    return response.data;
  },

  async getTrend(filters?: { employeeId?: string; months?: number }): Promise<PerformanceTrend> {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.months) params.append('months', String(filters.months));
    const response = await api.get(`/analytics/trend?${params.toString()}`);
    return response.data;
  },
};

export const performanceFlagService = {
  async getFlags(filters?: {
    employeeId?: string;
    type?: PerformanceFlagType;
    resolved?: boolean;
    startDate?: string;
    endDate?: string;
  }): Promise<PerformanceFlag[]> {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.resolved !== undefined) params.append('resolved', String(filters.resolved));
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    const response = await api.get(`/performance-flags?${params.toString()}`);
    return response.data;
  },

  async getSummary(): Promise<FlagSummary> {
    const response = await api.get('/performance-flags/summary');
    return response.data;
  },

  async resolveFlag(id: string): Promise<PerformanceFlag> {
    const response = await api.patch(`/performance-flags/${id}/resolve`);
    return response.data;
  },
};

export const targetService = {
  async getTargets(filters?: { employeeId?: string; periodMonth?: string }): Promise<Target[]> {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.periodMonth) params.append('periodMonth', filters.periodMonth);
    const response = await api.get(`/targets?${params.toString()}`);
    return response.data;
  },

  /** Create or update the target for one employee/month. */
  async saveTarget(data: {
    employeeId: string;
    periodMonth: string;
    salesAmount?: number;
    orderCount?: number;
    visitCount?: number;
    notes?: string;
  }): Promise<Target> {
    const response = await api.put('/targets', data);
    return response.data;
  },

  async deleteTarget(id: string) {
    const response = await api.delete(`/targets/${id}`);
    return response.data;
  },
};
