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
  /** Start of the window (`YYYY-MM-DD`). Equals `to` for a single-day view. */
  from: string;
  /** End of the window (`YYYY-MM-DD`). */
  to: string;
  /** Legacy alias for `to`, kept for callers written against the single-day API. */
  date: string;
  timezone: string;
  totals: SaleTotals;
  regions: RegionRow[];
}

export interface RegionSalesmenReport {
  from: string;
  to: string;
  /** Legacy alias for `to`. */
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

/**
 * Rupee formatting for figures the admin will read out or copy into a message.
 * Re-exported from the shared util so existing imports keep working.
 */
export { formatRs } from '../utils/formatCurrency';

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

/** An inclusive `YYYY-MM-DD` window. A single day is `from === to`. */
export interface SaleWindow {
  from: string;
  to: string;
}

function windowParams(window?: Partial<SaleWindow>): URLSearchParams {
  const params = new URLSearchParams();
  if (window?.from) params.append('from', window.from);
  if (window?.to) params.append('to', window.to);
  return params;
}

/** "31 Jul 2026" for one day, "01 Jul 2026 – 31 Jul 2026" for a span. */
export function formatWindowLabel(from: string, to: string): string {
  return from === to ? formatDayLabel(to) : `${formatDayLabel(from)} – ${formatDayLabel(to)}`;
}

export const regionSalesService = {
  async getRegions(window?: Partial<SaleWindow>): Promise<RegionTotalsReport> {
    const response = await api.get(`/region-sales/regions?${windowParams(window).toString()}`);
    return response.data;
  },

  async getRegionSalesmen(
    regionKey: string,
    window?: Partial<SaleWindow>,
  ): Promise<RegionSalesmenReport> {
    const segment = regionKey === '' ? UNASSIGNED_PATH : encodeURIComponent(regionKey);
    const response = await api.get(
      `/region-sales/regions/${segment}/salesmen?${windowParams(window).toString()}`,
    );
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
