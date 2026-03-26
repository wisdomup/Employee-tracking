import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import Table from '../../components/UI/Table';
import {
  dashboardService,
  DashboardReportRow,
  DashboardReports,
  DashboardSalesRow,
} from '../../services/dashboardService';
import styles from '../../styles/Reports.module.scss';

const LineTrendChart = dynamic(() => import('../../components/UI/LineTrendChart'), {
  ssr: false,
});

const ReportsPage: React.FC = () => {
  const [reports, setReports] = useState<DashboardReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'year'>('month');
  const [viewBy, setViewBy] = useState<'item' | 'category'>('item');

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const data = await dashboardService.getReports({ startDate, endDate, groupBy, viewBy });
        setReports(data);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [startDate, endDate, groupBy, viewBy]);

  const trendData = useMemo(() => {
    if (!reports) {
      return {
        labels: [] as string[],
        qtySeries: { sold: [] as number[], returned: [] as number[], damaged: [] as number[] },
        amountSeries: { earned: [] as number[], paidBack: [] as number[], booked: [] as number[], net: [] as number[] },
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
  }, [reports]);

  const stockColumns = useMemo(
    () => [
      {
        key: 'label',
        title: viewBy === 'item' ? 'Item' : 'Category',
        render: (_: unknown, row: DashboardReportRow) =>
          viewBy === 'item' ? row.productName || '-' : row.categoryName || '-',
      },
      { key: 'availableQty', title: 'Current Stock' },
      { key: 'onHoldQty', title: 'Stock Hold' },
      { key: 'returnedQty', title: 'Returned Qty' },
      { key: 'damagedQty', title: 'Damaged Qty' },
    ],
    [viewBy],
  );

  const salesColumns = useMemo(
    () => [
      {
        key: 'label',
        title: viewBy === 'item' ? 'Item' : 'Category',
        render: (_: unknown, row: DashboardSalesRow) =>
          viewBy === 'item' ? row.productName || '-' : row.categoryName || '-',
      },
      { key: 'soldQty', title: 'Sold Qty' },
      {
        key: 'salesAmount',
        title: 'Sales Amount',
        render: (value: number) => (value != null ? value.toFixed(2) : '0.00'),
      },
      { key: 'orderCount', title: 'Orders' },
    ],
    [viewBy],
  );

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!reports) {
    return (
      <Layout>
        <div className={styles.emptyState}>Failed to load reports</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Reports</h1>
        </div>

        <div className={styles.filters}>
          <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="Start date" />
          <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="End date" />
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'month' | 'year')}>
            <option value="day">Group by day</option>
            <option value="month">Group by month</option>
            <option value="year">Group by year</option>
          </select>
          <select value={viewBy} onChange={(e) => setViewBy(e.target.value as 'item' | 'category')}>
            <option value="item">Item-wise</option>
            <option value="category">Category-wise</option>
          </select>
        </div>

        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}><span>Current Stock</span><strong>{reports.kpis.totalCurrentStock}</strong></div>
          <div className={styles.kpiCard}><span>Stock Hold</span><strong>{reports.kpis.totalHoldStock}</strong></div>
          <div className={styles.kpiCard}><span>Returned Qty</span><strong>{reports.kpis.totalReturnedQty}</strong></div>
          <div className={styles.kpiCard}><span>Damaged Qty</span><strong>{reports.kpis.totalDamagedQty}</strong></div>
          <div className={styles.kpiCard}><span>Sold Qty</span><strong>{reports.kpis.totalSoldQty}</strong></div>
          <div className={styles.kpiCard}><span>Earned (Delivered Sales)</span><strong>{reports.kpis.salesInRange.toFixed(2)}</strong></div>
          <div className={styles.kpiCard}><span>Paid Back (Returns)</span><strong>{reports.kpis.totalReturnPayout.toFixed(2)}</strong></div>
          <div className={styles.kpiCard}><span>Net After Returns</span><strong>{reports.kpis.netAfterReturns.toFixed(2)}</strong></div>
          <div className={styles.kpiCard}><span>Booked Sales (Open Orders)</span><strong>{reports.kpis.bookedSalesInRange.toFixed(2)}</strong></div>
        </div>

        <div className={styles.section}>
          <h2>Quantity Trend (Sold / Returned / Damaged)</h2>
          <div className={styles.trendChartWrap}>
            <LineTrendChart
              labels={trendData.labels}
              datasets={[
                { label: 'Sold Qty', values: trendData.qtySeries.sold, borderColor: '#1d4ed8' },
                { label: 'Returned Qty', values: trendData.qtySeries.returned, borderColor: '#16a34a' },
                { label: 'Damaged Qty', values: trendData.qtySeries.damaged, borderColor: '#dc2626' },
              ]}
              height={400}
              emptyText="No quantity trend data in selected range"
            />
          </div>
        </div>

        <div className={styles.section}>
          <h2>Amount Trend (Earned / Paid Back / Booked / Net)</h2>
          <div className={styles.trendChartWrap}>
            <LineTrendChart
              labels={trendData.labels}
              datasets={[
                { label: 'Earned', values: trendData.amountSeries.earned, borderColor: '#1d4ed8' },
                { label: 'Paid Back', values: trendData.amountSeries.paidBack, borderColor: '#dc2626' },
                { label: 'Booked', values: trendData.amountSeries.booked, borderColor: '#7c3aed' },
                { label: 'Net', values: trendData.amountSeries.net, borderColor: '#16a34a' },
              ]}
              height={400}
              emptyText="No amount trend data in selected range"
            />
          </div>
        </div>

        <div className={styles.section}>
          <h2>Stock Report ({viewBy === 'item' ? 'Item-wise' : 'Category-wise'})</h2>
          <div className={styles.tableWrap}>
            <Table
              columns={stockColumns}
              data={reports.stockReport}
              paginate
              pageSize={10}
              fixedHeader
              fixedHeaderHeight="430px"
              noDataText="No stock rows found"
            />
          </div>
        </div>

        <div className={styles.section}>
          <h2>Sales Report ({viewBy === 'item' ? 'Item-wise' : 'Category-wise'})</h2>
          <div className={styles.tableWrap}>
            <Table
              columns={salesColumns}
              data={reports.salesReport}
              paginate
              pageSize={10}
              fixedHeader
              fixedHeaderHeight="430px"
              noDataText="No sales rows found"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ReportsPageWrapper() {
  return (
    <ProtectedRoute>
      <ReportsPage />
    </ProtectedRoute>
  );
}
