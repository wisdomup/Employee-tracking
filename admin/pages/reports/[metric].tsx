import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import Table from '../../components/UI/Table';
import {
  dashboardService,
  ReportDetail,
  ReportDetailColumnType,
  ReportDetailMetric,
} from '../../services/dashboardService';
import { formatPieces, formatRsExact } from '../../utils/formatCurrency';
import styles from '../../styles/Reports.module.scss';

const VALID_METRICS: ReportDetailMetric[] = [
  'current-stock',
  'stock-hold',
  'returned-qty',
  'damaged-qty',
  'sold-qty',
  'earned',
  'paid-back',
  'net-after-returns',
  'booked-sales',
];

/**
 * Numeric columns that must NOT be summed: unit rates, thresholds and identifiers. Adding them up
 * produces a number that looks authoritative and means nothing.
 */
const NO_TOTAL_KEYS = new Set([
  'invoiceNumber',
  'price',
  'salePrice',
  'survivalQuantity',
]);

function formatCell(value: unknown, type?: ReportDetailColumnType): string {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'currency') return formatRsExact(Number(value));
  if (type === 'number') return formatPieces(Number(value));
  if (type === 'date') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-GB');
  }
  return String(value);
}

const ReportDetailPage: React.FC = () => {
  const router = useRouter();
  const metricParam = router.query.metric as string | undefined;
  const metric = VALID_METRICS.includes(metricParam as ReportDetailMetric)
    ? (metricParam as ReportDetailMetric)
    : undefined;

  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // The Reports page carries its range through the link, so the drill-down opens on the same window
  // the admin was looking at when they clicked the tile.
  useEffect(() => {
    if (!router.isReady) return;
    setStartDate((router.query.startDate as string) || '');
    setEndDate((router.query.endDate as string) || '');
  }, [router.isReady, router.query.startDate, router.query.endDate]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!metric) {
      setLoading(false);
      setError('Unknown report metric');
      return;
    }
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await dashboardService.getReportDetail(metric, { startDate, endDate });
        setDetail(data);
      } catch {
        setError('Failed to load report details');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router.isReady, metric, startDate, endDate]);

  const columns = useMemo(
    () =>
      (detail?.columns ?? []).map((column) => {
        const summable =
          (column.type === 'number' || column.type === 'currency') && !NO_TOTAL_KEYS.has(column.key);
        return {
          key: column.key,
          title: column.title,
          render: (value: unknown) => formatCell(value, column.type),
          exportValue: (row: Record<string, unknown>) => formatCell(row[column.key], column.type),
          ...(summable
            ? {
                total: 'sum' as const,
                totalRender: (value: number) => formatCell(value, column.type),
              }
            : {}),
        };
      }),
    [detail],
  );

  const backHref = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const query = params.toString();
    return `/reports${query ? `?${query}` : ''}`;
  }, [startDate, endDate]);

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <Link href={backHref} className={styles.backLink}>
            <ArrowLeft size={16} weight="bold" aria-hidden />
            Back to Reports
          </Link>
          <h1>{detail?.title ?? 'Report Details'}</h1>
          {detail?.description && <p className={styles.detailDescription}>{detail.description}</p>}
        </div>

        {detail?.dateFiltered && (
          <div className={styles.filters}>
            <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="Start date" />
            <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="End date" />
          </div>
        )}

        {loading && <Loader />}

        {!loading && error && <div className={styles.emptyState}>{error}</div>}

        {!loading && !error && detail && (
          <>
            <div className={styles.kpiGrid}>
              {detail.summary.map((item) => (
                <div key={item.label} className={styles.kpiCard}>
                  <span>{item.label}</span>
                  <strong>{formatCell(item.value, item.type)}</strong>
                </div>
              ))}
            </div>

            {detail.truncated && (
              <div className={styles.truncatedNote}>
                Showing the first {detail.rows.length.toLocaleString()} rows. Narrow the date range
                to see the rest.
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.tableWrap}>
                <Table
                  columns={columns}
                  data={detail.rows}
                  paginate
                  pageSize={25}
                  fixedHeader
                  fixedHeaderHeight="600px"
                  exportFileName={`report-${detail.metric}`}
                  exportPdfTitle={detail.title}
                  noDataText="No records found"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default function ReportDetailPageWrapper() {
  return (
    <ProtectedRoute>
      <ReportDetailPage />
    </ProtectedRoute>
  );
}
