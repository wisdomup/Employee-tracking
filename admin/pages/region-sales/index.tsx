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
  formatWindowLabel,
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

/**
 * The windows an admin asks for by name. Each resolves at click time rather than at module
 * load, so a tab left open overnight still means "today" when the button is pressed.
 */
const RANGE_PRESETS: { label: string; resolve: () => { from: string; to: string } }[] = [
  { label: 'Today', resolve: () => ({ from: todayKey(), to: todayKey() }) },
  {
    label: 'Yesterday',
    resolve: () => {
      const y = shiftDayKey(todayKey(), -1);
      return { from: y, to: y };
    },
  },
  { label: 'Last 7 days', resolve: () => ({ from: shiftDayKey(todayKey(), -6), to: todayKey() }) },
  { label: 'Last 30 days', resolve: () => ({ from: shiftDayKey(todayKey(), -29), to: todayKey() }) },
  {
    label: 'This month',
    resolve: () => ({ from: `${todayKey().slice(0, 7)}-01`, to: todayKey() }),
  },
];

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
  /**
   * One window for all three levels, so drilling in and back out never silently changes the
   * period you are looking at. Defaults to today — the dashboard opened on a single day
   * before ranges existed, and that is still the figure most people come here for.
   */
  const [from, setFrom] = useState(todayKey());
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
        setRegions(await regionSalesService.getRegions({ from, to }));
      } else if (level.kind === 'salesmen') {
        setSalesmen(await regionSalesService.getRegionSalesmen(level.regionKey, { from, to }));
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
  }, [level, from, to]);

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
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      {
        key: 'deliveredAmount',
        title: 'Delivered',
        render: (value: number) => <span style={{ color: '#065f46' }}>{formatRs(value)}</span>,
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      {
        key: 'bookedAmount',
        title: 'Booked',
        render: (value: number) => <span style={{ color: '#b45309' }}>{formatRs(value)}</span>,
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      { key: 'orderCount', title: 'Orders', total: 'sum' as const },
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
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      {
        key: 'deliveredAmount',
        title: 'Delivered',
        render: (value: number) => <span style={{ color: '#065f46' }}>{formatRs(value)}</span>,
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      {
        key: 'bookedAmount',
        title: 'Booked',
        render: (value: number) => <span style={{ color: '#b45309' }}>{formatRs(value)}</span>,
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      { key: 'orderCount', title: 'Orders', total: 'sum' as const },
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
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      {
        key: 'deliveredAmount',
        title: 'Delivered',
        render: (value: number) => <span style={{ color: '#065f46' }}>{formatRs(value)}</span>,
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      {
        key: 'bookedAmount',
        title: 'Booked',
        render: (value: number) => <span style={{ color: '#b45309' }}>{formatRs(value)}</span>,
        total: 'sum' as const,
        totalRender: (value: number) => formatRs(value),
      },
      { key: 'orderCount', title: 'Orders', total: 'sum' as const },
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

        {/* One date range for every level. Presets cover the windows people ask for daily. */}
        <div className={styles.filters}>
          <DatePickerFilter value={from} onChange={setFrom} placeholder="From" title="From date" />
          <DatePickerFilter value={to} onChange={setTo} placeholder="To" title="To date" />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {RANGE_PRESETS.map((preset) => {
              const range = preset.resolve();
              const active = range.from === from && range.to === to;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setFrom(range.from);
                    setTo(range.to);
                  }}
                  style={{
                    padding: '0.4rem 0.75rem',
                    borderRadius: '999px',
                    border: `1px solid ${active ? 'var(--admin-primary)' : '#d1d5db'}`,
                    background: active ? 'var(--admin-primary)' : '#fff',
                    color: active ? '#fff' : '#374151',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
        {from > to && (
          <div className={styles.emptyState} style={{ marginBottom: '1rem' }}>
            The “From” date is after the “To” date — pick a valid range.
          </div>
        )}

        {loading && <Loader />}

        {/* ---------------- Level 1: regions ---------------- */}
        {!loading && level.kind === 'regions' && regions && (
          <>
            <TotalsRow
              totals={regions.totals}
              caption={`${formatWindowLabel(regions.from, regions.to)} · all regions · times in ${regions.timezone}`}
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
                  showGrandTotal
                  exportFileName={`region-sales-${regions.from}-to-${regions.to}`}
                  exportPdfTitle={`Region Sales — ${formatWindowLabel(regions.from, regions.to)}`}
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
              caption={`${formatWindowLabel(salesmen.from, salesmen.to)} · ${salesmen.region} · times in ${salesmen.timezone}`}
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
                  showGrandTotal
                  exportFileName={`region-sales-${salesmen.regionKey || 'unassigned'}-${salesmen.from}-to-${salesmen.to}`}
                  exportPdfTitle={`${salesmen.region} — ${formatWindowLabel(salesmen.from, salesmen.to)}`}
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
                  showGrandTotal
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
    <ProtectedRoute report="region-sales.daily">
      <RegionSalesPage />
    </ProtectedRoute>
  );
}
