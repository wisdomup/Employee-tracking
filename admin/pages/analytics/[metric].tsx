import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import Table from '../../components/UI/Table';
import { ALL_ROLES } from '../../utils/permissions';
import {
  analyticsService,
  DetailColumnType,
  PerformanceDetail,
  PerformanceDetailMetric,
  formatPeriodMonth,
} from '../../services/analyticsService';
import styles from '../../styles/Reports.module.scss';

const VALID_METRICS: PerformanceDetailMetric[] = [
  'sales',
  'target',
  'achievement',
  'booked',
  'orders',
  'visits-completed',
  'overstays',
  'new-clients',
  'visit-completion',
  'visits-skipped',
  'extra-visits',
  'total-visits-done',
  'open-flags',
  'days-present',
  'collected',
  'outstanding',
  'collection-rate',
  'returns',
  'avg-order-value',
  'strike-rate',
  'tasks-done',
  'achieved-target',
  'behind-pace',
  'below-visits',
];

const money = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rates and identifiers: an average reads correctly where a sum would not. */
const AVERAGE_KEYS = new Set([
  'durationMinutes',
  'avgVisitMinutes',
  'avgOrderValue',
  'visitCompletionRate',
  'salesAchievementPercent',
  'collectionRatePercent',
  'strikeRatePercent',
]);

/** Numeric columns with no meaningful aggregate at all. */
const NO_TOTAL_KEYS = new Set(['invoiceNumber', 'value', 'threshold', 'price']);

function formatCell(value: unknown, type?: DetailColumnType): string {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'currency') return money(Number(value));
  if (type === 'percent') return `${Number(value)}%`;
  if (type === 'number') return Number(value).toLocaleString();
  if (type === 'date') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-GB');
  }
  return String(value);
}

const PerformanceDetailPage: React.FC = () => {
  const router = useRouter();
  const metricParam = router.query.metric as string | undefined;
  const metric = VALID_METRICS.includes(metricParam as PerformanceDetailMetric)
    ? (metricParam as PerformanceDetailMetric)
    : undefined;

  const periodMonth = (router.query.periodMonth as string) || '';
  const employeeId = (router.query.employeeId as string) || '';

  const [detail, setDetail] = useState<PerformanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    if (!metric) {
      setLoading(false);
      setError('Unknown performance metric');
      return;
    }
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await analyticsService.getPerformanceDetail(metric, {
          periodMonth: periodMonth || undefined,
          employeeId: employeeId || undefined,
        });
        setDetail(data);
      } catch {
        setError('Failed to load details');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router.isReady, metric, periodMonth, employeeId]);

  const columns = useMemo(
    () =>
      (detail?.columns ?? []).map((column) => {
        const numeric =
          column.type === 'number' || column.type === 'currency' || column.type === 'percent';
        const mode = !numeric || NO_TOTAL_KEYS.has(column.key)
          ? undefined
          : AVERAGE_KEYS.has(column.key) || column.type === 'percent'
            ? ('avg' as const)
            : ('sum' as const);
        return {
          key: column.key,
          title: column.title,
          render: (value: unknown) => formatCell(value, column.type),
          exportValue: (row: Record<string, unknown>) => formatCell(row[column.key], column.type),
          ...(mode
            ? {
                total: mode,
                totalRender: (value: number) =>
                  formatCell(mode === 'avg' ? Math.round(value * 10) / 10 : value, column.type),
              }
            : {}),
        };
      }),
    [detail],
  );

  // The analytics page keeps month and employee in its own state, so both travel in the query.
  const backHref = useMemo(() => {
    const params = new URLSearchParams();
    if (periodMonth) params.append('periodMonth', periodMonth);
    if (employeeId) params.append('employeeId', employeeId);
    const query = params.toString();
    return `/analytics${query ? `?${query}` : ''}`;
  }, [periodMonth, employeeId]);

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.detailHeader}>
          <Link href={backHref} className={styles.backLink}>
            <ArrowLeft size={16} weight="bold" aria-hidden />
            Back to Performance
          </Link>
          <h1>{detail?.title ?? 'Performance Details'}</h1>
          {detail && (
            <p className={styles.detailDescription}>
              {detail.description}
              {detail.filters.periodMonth && ` · ${formatPeriodMonth(detail.filters.periodMonth)}`}
            </p>
          )}
        </div>

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
                Showing the first {detail.rows.length.toLocaleString()} rows. Filter by employee to
                see the rest.
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
                  exportFileName={`performance-${detail.metric}-${detail.filters.periodMonth}`}
                  exportPdfTitle={`${detail.title} — ${formatPeriodMonth(detail.filters.periodMonth)}`}
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

export default function PerformanceDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <PerformanceDetailPage />
    </ProtectedRoute>
  );
}
