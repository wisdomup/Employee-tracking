import api from './api';

/**
 * Region-wise daily sale. Regions come from each salesman's own city; days are bounded
 * in the backend's report timezone (Asia/Karachi), not UTC.
 */

export interface SaleTotals {
  deliveredAmount: number;
  bookedAmount: number;
  totalAmount: number;
  orderCount: number;
}

export interface RegionRow extends SaleTotals {
  /** Normalised key used for drill-down ('' = Unassigned). */
  regionKey: string;
  region: string;
  salesmenCount: number;
}

export interface SalesmanRow extends SaleTotals {
  employeeId: string;
  username: string;
  fullName?: string;
  userID?: string;
  role: string;
}

export interface DayRow extends SaleTotals {
  date: string;
}

export interface RegionTotalsReport {
  date: string;
  timezone: string;
  totals: SaleTotals;
  regions: RegionRow[];
}

export interface RegionSalesmenReport {
  date: string;
  timezone: string;
  regionKey: string;
  region: string;
  totals: SaleTotals;
  salesmen: SalesmanRow[];
}

export interface SalesmanDailyReport {
  from: string;
  to: string;
  timezone: string;
  employee: {
    employeeId: string;
    username: string;
    fullName?: string;
    userID?: string;
    role: string;
    region: string;
    regionKey: string;
  } | null;
  totals: SaleTotals;
  days: DayRow[];
}

/** Rupee formatting for figures the admin will read out or copy into a message. */
export function formatRs(value: number): string {
  return `Rs. ${value.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/** Today as `YYYY-MM-DD` in the browser's local calendar — matches DatePickerFilter. */
export function todayKey(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** `YYYY-MM-DD` shifted by whole days — used for the default 7-day report window. */
export function shiftDayKey(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  return cursor.toISOString().slice(0, 10);
}

/** "31 Jul 2026" for display, without pulling in a date library. */
export function formatDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The literal the API expects for the no-city bucket (an empty key isn't URL-safe). */
const UNASSIGNED_PATH = 'unassigned';

export const regionSalesService = {
  async getRegions(date?: string): Promise<RegionTotalsReport> {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    const response = await api.get(`/region-sales/regions?${params.toString()}`);
    return response.data;
  },

  async getRegionSalesmen(regionKey: string, date?: string): Promise<RegionSalesmenReport> {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    const segment = regionKey === '' ? UNASSIGNED_PATH : encodeURIComponent(regionKey);
    const response = await api.get(`/region-sales/regions/${segment}/salesmen?${params.toString()}`);
    return response.data;
  },

  async getSalesmanDaily(
    employeeId: string,
    from?: string,
    to?: string,
  ): Promise<SalesmanDailyReport> {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const response = await api.get(`/region-sales/salesman/${employeeId}?${params.toString()}`);
    return response.data;
  },
};
