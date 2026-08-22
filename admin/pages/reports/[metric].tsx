import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import SearchableSelect from '../../components/UI/SearchableSelect';
import Table from '../../components/UI/Table';
import { clientService, Client, formatClientSelectLabel } from '../../services/clientService';
import { employeeService, Employee } from '../../services/employeeService';
import {
  dashboardService,
  ReportDetail,
  ReportDetailColumnType,
  ReportDetailMetric,
} from '../../services/dashboardService';
import { formatPieces, formatRsExact } from '../../utils/formatCurrency';
import { can } from '../../utils/permissions';
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
  'sales-ledger',
];

/**
 * Metrics that accept a client / employee filter. Everything else on this route mirrors a KPI tile
 * on `/reports`, and a filtered detail would no longer add up to the tile it was opened from.
 */
const PARTY_FILTER_METRICS = new Set<ReportDetailMetric>(['sales-ledger']);

/**
 * Numeric columns that must NOT be summed: unit rates, thresholds and identifiers. Adding them up
 * produces a number that looks authoritative and means nothing.
 */
const NO_TOTAL_KEYS = new Set([
  'invoiceNumber',
  'price',
  'salePrice',
  'survivalQuantity',
  // A carried-forward balance is already cumulative; summing the column would double-count it.
  'runningBalance',
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
  const [dealerId, setDealerId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const partyFiltered = !!metric && PARTY_FILTER_METRICS.has(metric);

  // The Reports page carries its range through the link, so the drill-down opens on the same window
  // the admin was looking at when they clicked the tile.
  useEffect(() => {
    if (!router.isReady) return;
    setStartDate((router.query.startDate as string) || '');
    setEndDate((router.query.endDate as string) || '');
    setDealerId((router.query.dealerId as string) || '');
    setEmployeeId((router.query.employeeId as string) || '');
  }, [
    router.isReady,
    router.query.startDate,
    router.query.endDate,
    router.query.dealerId,
    router.query.employeeId,
  ]);

  // Only the ledger offers these, so only the ledger pays for the two roster calls.
  useEffect(() => {
    if (!partyFiltered) return;
    clientService.getClients().then(setClients).catch(() => {});
    employeeService.getEmployees().then(setEmployees).catch(() => {});
  }, [partyFiltered]);

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
        const data = await dashboardService.getReportDetail(metric, {
          startDate,
          endDate,
          ...(partyFiltered ? { dealerId, employeeId } : {}),
        });
        setDetail(data);
      } catch {
        setError('Failed to load report details');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router.isReady, metric, startDate, endDate, partyFiltered, dealerId, employeeId]);

  // Order-backed metrics carry `orderId` on every row; stock and return rows do not.
  const hasInvoiceLink = useMemo(
    () => Boolean(detail?.rows.some((row) => row.orderId)) && can(undefined, 'orders:edit'),
    [detail],
  );

  const columns = useMemo(() => {
    const dataColumns = (detail?.columns ?? []).map((column) => {
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
    });

    if (!hasInvoiceLink) return dataColumns;

    // A link rather than a button: the report is worth keeping open, so ctrl/cmd-click works.
    return [
      ...dataColumns,
      {
        key: 'actions',
        title: 'Actions',
        omitFromExport: true,
        render: (_value: unknown, row: Record<string, unknown>) =>
          row.orderId ? (
            <Link
              href={`/orders/${row.orderId}/edit`}
              className={styles.rowActionLink}
              onClick={(event) => event.stopPropagation()}
            >
              View invoice
            </Link>
          ) : (
            '-'
          ),
      },
    ];
  }, [detail, hasInvoiceLink]);

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

        {(detail?.dateFiltered || partyFiltered) && (
          <div className={styles.filters}>
            {detail?.dateFiltered && (
              <>
                <DatePickerFilter
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="Start date"
                />
                <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="End date" />
              </>
            )}
            {partyFiltered && (
              <>
                <SearchableSelect
                  name="dealerId"
                  value={dealerId}
                  onChange={(e) => setDealerId(e.target.value)}
                  className={styles.filterSelect}
                  placeholder="All clients"
                  options={[
                    { value: '', label: 'All clients' },
                    ...clients.map((client) => ({
                      value: client._id,
                      label: formatClientSelectLabel(client),
                    })),
                  ]}
                />
                <SearchableSelect
                  name="employeeId"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className={styles.filterSelect}
                  placeholder="All employees"
                  options={[
                    { value: '', label: 'All employees' },
                    ...employees.map((employee) => ({
                      value: employee._id,
                      label: employee.fullName || employee.username,
                    })),
                  ]}
                />
              </>
            )}
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
