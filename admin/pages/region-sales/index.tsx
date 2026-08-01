import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import Table from '../../components/UI/Table';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import { employeeDisplayLabel } from '../../utils/employeeDisplayLabel';
import {
  regionSalesService,
  RegionTotalsReport,
  RegionSalesmenReport,
  SalesmanDailyReport,
  RegionRow,
  SalesmanRow,
  SaleTotals,
  formatRs,
  formatDayLabel,
  todayKey,
  shiftDayKey,
} from '../../services/regionSalesService';
import { toast } from 'react-toastify';
import styles from '../../styles/Reports.module.scss';

const LineTrendChart = dynamic(() => import('../../components/UI/LineTrendChart'), { ssr: false });

/** Which drill-down level is on screen. */
type Level =
  | { kind: 'regions' }
  | { kind: 'salesmen'; regionKey: string; regionLabel: string }
  | { kind: 'daily'; employeeId: string; employeeLabel: string; regionKey: string; regionLabel: string };

/** The four headline numbers, shared by every level. */
const TotalsRow: React.FC<{ totals: SaleTotals; caption: string }> = ({ totals, caption }) => (
  <>
    <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>{caption}</p>
    <div className={styles.kpiGrid}>
      <div className={styles.kpiCard}>
        <span>Total Sale</span>
        <strong>{formatRs(totals.totalAmount)}</strong>
      </div>
      <div className={styles.kpiCard}>
        <span>Delivered</span>
        <strong style={{ color: '#065f46' }}>{formatRs(totals.deliveredAmount)}</strong>
      </div>
      <div className={styles.kpiCard}>
        <span>Booked (not yet delivered)</span>
        <strong style={{ color: '#b45309' }}>{formatRs(totals.bookedAmount)}</strong>
      </div>
      <div className={styles.kpiCard}>
        <span>Orders</span>
        <strong>{totals.orderCount}</strong>
      </div>
    </div>
  </>
);

const RegionSalesPage: React.FC = () => {
  const [level, setLevel] = useState<Level>({ kind: 'regions' });
  /** Shared by the region and salesmen levels, so drilling in/out keeps the date. */
  const [date, setDate] = useState(todayKey());
  /** Day-wise level only. */
  const [from, setFrom] = useState(() => shiftDayKey(todayKey(), -6));
  const [to, setTo] = useState(todayKey());

  const [regions, setRegions] = useState<RegionTotalsReport | null>(null);
  const [salesmen, setSalesmen] = useState<RegionSalesmenReport | null>(null);
  const [daily, setDaily] = useState<SalesmanDailyReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Each level loads independently; `level.kind` is the only trigger that changes which.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (level.kind === 'regions') {
        setRegions(await regionSalesService.getRegions(date));
      } else if (level.kind === 'salesmen') {
        setSalesmen(await regionSalesService.getRegionSalesmen(level.regionKey, date));
      } else {
        setDaily(await regionSalesService.getSalesmanDaily(level.employeeId, from, to));
      }
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(message || 'Failed to load region sales');
    } finally {
      setLoading(false);
    }
  }, [level, date, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const regionColumns = useMemo(
    () => [
      {
        key: 'region',
        title: 'Region',
        render: (value: string, row: RegionRow) => (
          <div>
            <div style={{ fontWeight: 600 }}>{value}</div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              {row.salesmenCount} salesman{row.salesmenCount === 1 ? '' : 'en'}
            </div>
          </div>
        ),
      },
      {
        key: 'totalAmount',
        title: 'Total Sale',
        render: (value: number) => <strong>{formatRs(value)}</strong>,
      },
      {
        key: 'deliveredAmount',
        title: 'Delivered',
        render: (value: number) => <span style={{ color: '#065f46' }}>{formatRs(value)}</span>,
      },
      {
        key: 'bookedAmount',
        title: 'Booked',
        render: (value: number) => <span style={{ color: '#b45309' }}>{formatRs(value)}</span>,
      },
      { key: 'orderCount', title: 'Orders' },
    ],
    [],
  );

  const salesmanColumns = useMemo(
    () => [
      {
        key: 'username',
        title: 'Salesman',
        render: (_: unknown, row: SalesmanRow) => (
          <div>
            <div style={{ fontWeight: 600 }}>{employeeDisplayLabel(row) || row.username}</div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{row.role.replace(/_/g, ' ')}</div>
          </div>
        ),
      },
      {
        key: 'totalAmount',
        title: 'Total Sale',
        render: (value: number) => <strong>{formatRs(value)}</strong>,
      },
      {
        key: 'deliveredAmount',
        title: 'Delivered',
        render: (value: number) => <span style={{ color: '#065f46' }}>{formatRs(value)}</span>,
      },
      {
        key: 'bookedAmount',
        title: 'Booked',
        render: (value: number) => <span style={{ color: '#b45309' }}>{formatRs(value)}</span>,
      },
      { key: 'orderCount', title: 'Orders' },
    ],
    [],
  );

  const dayColumns = useMemo(
    () => [
      {
        key: 'date',
        title: 'Date',
        render: (value: string) => formatDayLabel(value),
      },
      {
        key: 'totalAmount',
        title: 'Total Sale',
        render: (value: number) => <strong>{formatRs(value)}</strong>,
      },
      {
        key: 'deliveredAmount',
        title: 'Delivered',
        render: (value: number) => <span style={{ color: '#065f46' }}>{formatRs(value)}</span>,
      },
      {
        key: 'bookedAmount',
        title: 'Booked',
        render: (value: number) => <span style={{ color: '#b45309' }}>{formatRs(value)}</span>,
      },
      { key: 'orderCount', title: 'Orders' },
    ],
    [],
  );

  const dailyChart = useMemo(() => {
    if (!daily || daily.days.length === 0) return null;
    return {
      labels: daily.days.map((d) => formatDayLabel(d.date)),
      datasets: [
        { label: 'Delivered', values: daily.days.map((d) => d.deliveredAmount) },
        { label: 'Booked', values: daily.days.map((d) => d.bookedAmount) },
      ],
    };
  }, [daily]);

  const crumb = (label: string, onClick?: () => void, current = false) =>
    onClick ? (
      <button
        key={label}
        type="button"
        onClick={onClick}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: '#0369a1',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        {label}
      </button>
    ) : (
      <span
        key={label}
        style={{ fontSize: '0.875rem', color: current ? '#111827' : '#6b7280', fontWeight: 600 }}
      >
        {label}
      </span>
    );

  const breadcrumb = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        flexWrap: 'wrap',
        marginBottom: '0.75rem',
      }}
    >
      {crumb('All Regions', level.kind === 'regions' ? undefined : () => setLevel({ kind: 'regions' }), level.kind === 'regions')}
      {level.kind !== 'regions' && <span style={{ color: '#9ca3af' }}>›</span>}
      {level.kind === 'salesmen' && crumb(level.regionLabel, undefined, true)}
      {level.kind === 'daily' && (
        <>
          {crumb(level.regionLabel, () =>
            setLevel({ kind: 'salesmen', regionKey: level.regionKey, regionLabel: level.regionLabel }),
          )}
          <span style={{ color: '#9ca3af' }}>›</span>
          {crumb(level.employeeLabel, undefined, true)}
        </>
      )}
    </div>
  );

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Region Sales</h1>
        </div>

        {breadcrumb}

        {/* Date controls: a single day for levels 1–2, a range for the day-wise report. */}
        <div className={styles.filters}>
          {level.kind === 'daily' ? (
            <>
              <DatePickerFilter value={from} onChange={setFrom} placeholder="From" title="From date" />
              <DatePickerFilter value={to} onChange={setTo} placeholder="To" title="To date" />
            </>
          ) : (
            <DatePickerFilter value={date} onChange={setDate} placeholder="Date" title="Sale date" />
          )}
        </div>

        {loading && <Loader />}

        {/* ---------------- Level 1: regions ---------------- */}
        {!loading && level.kind === 'regions' && regions && (
          <>
            <TotalsRow
              totals={regions.totals}
              caption={`${formatDayLabel(regions.date)} · all regions · times in ${regions.timezone}`}
            />
            <div className={styles.section}>
              <h2>Region-wise Sale ({regions.regions.length})</h2>
              <div className={styles.tableWrap}>
                <Table
                  columns={regionColumns}
                  data={regions.regions}
                  loading={false}
                  paginate={false}
                  onRowClick={(row: RegionRow) =>
                    setLevel({ kind: 'salesmen', regionKey: row.regionKey, regionLabel: row.region })
                  }
                  exportFileName={`region-sales-${regions.date}`}
                  exportPdfTitle={`Region Sales — ${formatDayLabel(regions.date)}`}
                />
              </div>
              {regions.regions.length === 0 ? (
                <div className={styles.emptyState}>
                  No salesmen found. Assign a city on an employee to see their region here.
                </div>
              ) : (
                <p style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                  Click a region to see its salesmen.
                </p>
              )}
            </div>
          </>
        )}

        {/* ---------------- Level 2: salesmen in a region ---------------- */}
        {!loading && level.kind === 'salesmen' && salesmen && (
          <>
            <TotalsRow
              totals={salesmen.totals}
              caption={`${formatDayLabel(salesmen.date)} · ${salesmen.region} · times in ${salesmen.timezone}`}
            />
            <div className={styles.section}>
              <h2>
                {salesmen.region} — Salesmen ({salesmen.salesmen.length})
              </h2>
              <div className={styles.tableWrap}>
                <Table
                  columns={salesmanColumns}
                  data={salesmen.salesmen}
                  loading={false}
                  paginate={false}
                  onRowClick={(row: SalesmanRow) =>
                    setLevel({
                      kind: 'daily',
                      employeeId: row.employeeId,
                      employeeLabel: employeeDisplayLabel(row) || row.username,
                      regionKey: salesmen.regionKey,
                      regionLabel: salesmen.region,
                    })
                  }
                  exportFileName={`region-sales-${salesmen.regionKey || 'unassigned'}-${salesmen.date}`}
                  exportPdfTitle={`${salesmen.region} — ${formatDayLabel(salesmen.date)}`}
                />
              </div>
              {salesmen.salesmen.length === 0 ? (
                <div className={styles.emptyState}>No salesmen in this region.</div>
              ) : (
                <p style={{ fontSize: '0.8125rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                  Click a salesman for their day-wise report.
                </p>
              )}
            </div>
          </>
        )}

        {/* ---------------- Level 3: one salesman, day by day ---------------- */}
        {!loading && level.kind === 'daily' && daily && (
          <>
            <TotalsRow
              totals={daily.totals}
              caption={
                daily.employee
                  ? `${employeeDisplayLabel(daily.employee) || daily.employee.username} · ${daily.employee.region} · ${formatDayLabel(daily.from)} – ${formatDayLabel(daily.to)}`
                  : 'No data available for this salesman.'
              }
            />

            <div className={styles.section}>
              <h2>Day-wise Trend</h2>
              <div className={styles.trendChartWrap}>
                {dailyChart ? (
                  <LineTrendChart labels={dailyChart.labels} datasets={dailyChart.datasets} />
                ) : (
                  <div className={styles.emptyState}>No data in this range</div>
                )}
              </div>
            </div>

            <div className={styles.section}>
              <h2>Day-wise Breakdown ({daily.days.length} days)</h2>
              <div className={styles.tableWrap}>
                <Table
                  columns={dayColumns}
                  data={daily.days}
                  loading={false}
                  paginate={daily.days.length > 31}
                  pageSize={31}
                  exportFileName={`sale-${daily.employee?.username ?? 'salesman'}-${daily.from}-to-${daily.to}`}
                  exportPdfTitle={`${daily.employee?.fullName ?? ''} — ${formatDayLabel(daily.from)} to ${formatDayLabel(daily.to)}`}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default function RegionSalesPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'sales_manager']}>
      <RegionSalesPage />
    </ProtectedRoute>
  );
}
