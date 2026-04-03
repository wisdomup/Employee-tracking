import type { DashboardReports } from '../services/dashboardService';

export type DashboardTrendData = {
  labels: string[];
  qtySeries: { sold: number[]; returned: number[]; damaged: number[] };
  amountSeries: { earned: number[]; paidBack: number[]; booked: number[]; net: number[] };
};

/** Aligns period keys across trend arrays for `LineTrendChart` (same logic on dashboard + reports). */
export function buildTrendDataFromReports(reports: DashboardReports | null): DashboardTrendData {
  if (!reports) {
    return {
      labels: [],
      qtySeries: { sold: [], returned: [], damaged: [] },
      amountSeries: { earned: [], paidBack: [], booked: [], net: [] },
    };
  }

  const allPeriods = new Set<string>();
  reports.salesTrend.forEach((r) => allPeriods.add(r.period));
  reports.returnTrend.forEach((r) => allPeriods.add(r.period));
  reports.soldQtyTrend.forEach((r) => allPeriods.add(r.period));
  reports.bookedSalesTrend.forEach((r) => allPeriods.add(r.period));
  reports.returnPayoutTrend.forEach((r) => allPeriods.add(r.period));

  const labels = Array.from(allPeriods).sort();
  const soldMap = new Map(reports.soldQtyTrend.map((r) => [r.period, r.soldQty]));
  const returnedMap = new Map(reports.returnTrend.map((r) => [r.period, r.returnedQty]));
  const damagedMap = new Map(reports.returnTrend.map((r) => [r.period, r.damagedQty]));
  const earnedMap = new Map(reports.salesTrend.map((r) => [r.period, r.totalSales]));
  const paidBackMap = new Map(reports.returnPayoutTrend.map((r) => [r.period, r.paidBack]));
  const bookedMap = new Map(reports.bookedSalesTrend.map((r) => [r.period, r.bookedSales]));

  const sold = labels.map((p) => soldMap.get(p) ?? 0);
  const returned = labels.map((p) => returnedMap.get(p) ?? 0);
  const damaged = labels.map((p) => damagedMap.get(p) ?? 0);
  const earned = labels.map((p) => earnedMap.get(p) ?? 0);
  const paidBack = labels.map((p) => paidBackMap.get(p) ?? 0);
  const booked = labels.map((p) => bookedMap.get(p) ?? 0);
  const net = labels.map((p, idx) => Number((earned[idx] - paidBack[idx]).toFixed(2)));

  return {
    labels,
    qtySeries: { sold, returned, damaged },
    amountSeries: { earned, paidBack, booked, net },
  };
}
