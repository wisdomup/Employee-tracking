import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import SearchableSelect from '../../components/UI/SearchableSelect';
import Table from '../../components/UI/Table';
import {
  dashboardService,
  DashboardReportRow,
  DashboardReports,
  DashboardSalesRow,
  ReportDetailMetric,
} from '../../services/dashboardService';
import styles from '../../styles/Reports.module.scss';
import { buildTrendDataFromReports } from '../../utils/dashboardReportsTrend';

const LineTrendChart = dynamic(() => import('../../components/UI/LineTrendChart'), {
  ssr: false,
});

/** Each KPI tile drills into `/reports/[metric]`; `value` reads the tile's number off the payload. */
const KPI_TILES: Array<{
  metric: ReportDetailMetric;
  label: string;
  value: (reports: DashboardReports) => string | number;
}> = [
  { metric: 'current-stock', label: 'Current Stock', value: (r) => r.kpis.totalCurrentStock },
  { metric: 'stock-hold', label: 'Stock Hold', value: (r) => r.kpis.totalHoldStock },
  { metric: 'returned-qty', label: 'Returned Qty', value: (r) => r.kpis.totalReturnedQty },
  { metric: 'damaged-qty', label: 'Damaged Qty', value: (r) => r.kpis.totalDamagedQty },
  { metric: 'sold-qty', label: 'Sold Qty', value: (r) => r.kpis.totalSoldQty },
  {
    metric: 'earned',
    label: 'Earned (Delivered Sales)',
    value: (r) => r.kpis.salesInRange.toFixed(2),
  },
  {
    metric: 'paid-back',
    label: 'Paid Back (Returns)',
    value: (r) => r.kpis.totalReturnPayout.toFixed(2),
  },
  {
    metric: 'net-after-returns',
    label: 'Net After Returns',
    value: (r) => r.kpis.netAfterReturns.toFixed(2),
  },
  {
    metric: 'booked-sales',
    label: 'Booked Sales (Open Orders)',
    value: (r) => r.kpis.bookedSalesInRange.toFixed(2),
  },
];

const ReportsPage: React.FC = () => {
  const router = useRouter();
  const [reports, setReports] = useState<DashboardReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'year'>('month');
  const [viewBy, setViewBy] = useState<'item' | 'category'>('item');

  // Restore the range when returning from a drill-down page, which links back with it in the query.
  useEffect(() => {
    if (!router.isReady) return;
    setStartDate((router.query.startDate as string) || '');
    setEndDate((router.query.endDate as string) || '');
  }, [router.isReady, router.query.startDate, router.query.endDate]);

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

  const trendData = useMemo(() => buildTrendDataFromReports(reports), [reports]);

  /** Range travels with the link so the detail page opens on the same window. */
  const detailQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const query = params.toString();
    return query ? `?${query}` : '';
  }, [startDate, endDate]);

  const stockColumns = useMemo(
    () => [
      {
        key: 'label',
        title: viewBy === 'item' ? 'Item' : 'Category',
        render: (_: unknown, row: DashboardReportRow) =>
          viewBy === 'item' ? row.productName || '-' : row.categoryName || '-',
      },
      { key: 'availableQty', title: 'Current Stock', total: 'sum' as const },
      { key: 'onHoldQty', title: 'Stock Hold', total: 'sum' as const },
      { key: 'returnedQty', title: 'Returned Qty', total: 'sum' as const },
      { key: 'damagedQty', title: 'Damaged Qty', total: 'sum' as const },
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
      { key: 'soldQty', title: 'Sold Qty', total: 'sum' as const },
      {
        key: 'salesAmount',
        totalFormat: (t: number) => t.toFixed(2),
        title: 'Sales Amount',
        render: (value: number) => (value != null ? value.toFixed(2) : '0.00'),
        total: 'sum' as const,
        totalRender: (value: number) => value.toFixed(2),
      },
      { key: 'orderCount', title: 'Orders', total: 'sum' as const },
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
          <div className={styles.headerLinks}>
            {/* Not a KPI tile — the ledger is invoice-grain, so it has no number to sit under. */}
            <Link href={`/reports/sales-ledger${detailQuery}`} className={styles.kpiCardLink}>
              Sales Ledger →
            </Link>
            {/* §12: "Collection" reachable from Reports & Insights as well as the dashboard. */}
            <Link href="/collection/report" className={styles.kpiCardLink}>
              Collection Report →
            </Link>
          </div>
        </div>

        <div className={styles.filters}>
          <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="Start date" />
          <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="End date" />
          <SearchableSelect
            name="groupBy"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'day' | 'month' | 'year')}
            className={styles.filterSelect}
            options={[
              { value: 'day', label: 'Group by day' },
              { value: 'month', label: 'Group by month' },
              { value: 'year', label: 'Group by year' },
            ]}
            placeholder="Group by"
          />
          <SearchableSelect
            name="viewBy"
            value={viewBy}
            onChange={(e) => setViewBy(e.target.value as 'item' | 'category')}
            className={styles.filterSelect}
            options={[
              { value: 'item', label: 'Item-wise' },
              { value: 'category', label: 'Category-wise' },
            ]}
            placeholder="View by"
          />
        </div>

        <div className={styles.kpiGrid}>
          {KPI_TILES.map((tile) => (
            <Link
              key={tile.metric}
              href={`/reports/${tile.metric}${detailQuery}`}
              className={`${styles.kpiCard} ${styles.kpiCardLink}`}
              title={`View ${tile.label} details`}
            >
              <span>{tile.label}</span>
              <strong>{tile.value(reports)}</strong>
              <em className={styles.kpiCardHint}>View details</em>
            </Link>
          ))}
        </div>

        <div className={styles.section}>
          <h2>Quantity Trend (Sold / Returned / Damaged)</h2>
          <div className={styles.trendChartWrap}>
            <LineTrendChart
              labels={trendData.labels}
              datasets={[
                { label: 'Sold Qty', values: trendData.qtySeries.sold },
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
                { label: 'Earned', values: trendData.amountSeries.earned },
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
              showGrandTotal
              noDataText="No stock rows found"
              exportFileName={`stock-report-${viewBy}`}
              exportPdfTitle={`Stock Report (${viewBy === 'item' ? 'Item-wise' : 'Category-wise'})`}
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
              showGrandTotal
              noDataText="No sales rows found"
              exportFileName={`sales-report-${viewBy}`}
              exportPdfTitle={`Sales Report (${viewBy === 'item' ? 'Item-wise' : 'Category-wise'})`}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ReportsPageWrapper() {
  return (
    <ProtectedRoute reportPrefix="reports.">
      <ReportsPage />
    </ProtectedRoute>
  );
}
