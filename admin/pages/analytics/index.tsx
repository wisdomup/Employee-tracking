import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import Table from '../../components/UI/Table';
import SearchableSelect from '../../components/UI/SearchableSelect';
import TargetModal from '../../components/Analytics/TargetModal';
import AchievementBar from '../../components/Analytics/AchievementBar';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import { employeeDisplayLabel } from '../../utils/employeeDisplayLabel';
import {
  analyticsService,
  PerformanceDetailMetric,
  PerformanceReport,
  PerformanceRow,
  PerformanceTrend,
  currentPeriodMonth,
  formatPeriodMonth,
  recentPeriodMonths,
} from '../../services/analyticsService';
import { toast } from 'react-toastify';
import styles from '../../styles/Reports.module.scss';

const LineTrendChart = dynamic(() => import('../../components/UI/LineTrendChart'), { ssr: false });

const money = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A KPI tile that drills into `/analytics/[metric]`. The month and employee filter travel in the
 * query so the detail page opens on exactly the slice the tile was showing.
 */
const KpiTile: React.FC<{
  metric: PerformanceDetailMetric;
  label: React.ReactNode;
  query: string;
  /** Colour applied to the value, as each tile used before it became a link. */
  valueStyle?: React.CSSProperties;
  /** Tooltip explaining the metric; falls back to a plain drill-down hint. */
  hint?: string;
  children: React.ReactNode;
}> = ({ metric, label, query, valueStyle, hint, children }) => (
  <Link
    href={`/analytics/${metric}${query}`}
    className={`${styles.kpiCard} ${styles.kpiCardLink}`}
    title={hint ?? 'View details'}
  >
    <span>{label}</span>
    <strong style={valueStyle}>{children}</strong>
    <em className={styles.kpiCardHint}>View details</em>
  </Link>
);

const AnalyticsPage: React.FC = () => {
  const router = useRouter();
  const { user } = useAuth();
  const canManageTargets = can(user?.role, 'targets:manage') || user?.role === 'admin';
  /** Riders see only themselves, so the page reads as a personal scorecard. */
  const isSelfOnly = !can(user?.role, 'analytics:view-team') && user?.role !== 'admin';

  const [periodMonth, setPeriodMonth] = useState(currentPeriodMonth());
  const [employeeId, setEmployeeId] = useState('');
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [targetFor, setTargetFor] = useState<PerformanceRow | null>(null);
  /**
   * The full team roster, fetched unfiltered. Kept separate from `report.rows` because
   * selecting one employee shrinks rows to a single entry — deriving the dropdown from
   * rows would then drop everyone else and strand the user on that one person.
   */
  const [roster, setRoster] = useState<PerformanceRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [performance, trendData] = await Promise.all([
        analyticsService.getPerformance({ periodMonth, employeeId: employeeId || undefined }),
        analyticsService.getTrend({ employeeId: employeeId || undefined, months: 6 }),
      ]);
      setReport(performance);
      setTrend(trendData);
    } catch {
      toast.error('Failed to load analytics');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [periodMonth, employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Restore the filters when coming back from a KPI drill-down, which links back with them.
  useEffect(() => {
    if (!router.isReady) return;
    const month = router.query.periodMonth as string | undefined;
    if (month) setPeriodMonth(month);
    setEmployeeId((router.query.employeeId as string) || '');
  }, [router.isReady, router.query.periodMonth, router.query.employeeId]);

  /** Filters carried into every KPI drill-down link. */
  const detailQuery = useMemo(() => {
    const params = new URLSearchParams({ periodMonth });
    if (employeeId) params.append('employeeId', employeeId);
    return `?${params.toString()}`;
  }, [periodMonth, employeeId]);

  // Roster depends only on the month, never on the selected employee.
  useEffect(() => {
    if (isSelfOnly) return;
    analyticsService
      .getPerformance({ periodMonth })
      .then((r) => setRoster(r.rows))
      .catch(() => setRoster([]));
  }, [periodMonth, isSelfOnly]);

  const employeeOptions = useMemo(
    () => [
      { value: '', label: 'All team members' },
      ...roster.map((r) => ({
        value: r.employeeId,
        label: employeeDisplayLabel(r) || r.username,
      })),
    ],
    [roster],
  );

  const columns = useMemo(
    () => [
      {
        key: 'username',
        title: 'Employee',
        render: (_: unknown, row: PerformanceRow) => (
          <div>
            <div style={{ fontWeight: 600 }}>{employeeDisplayLabel(row) || row.username}</div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              {row.role.replace(/_/g, ' ')}
              {row.managerName ? ` · reports to ${row.managerName}` : ''}
            </div>
          </div>
        ),
      },
      {
        key: 'salesAmount', totalFormat: money,
        title: 'Sales vs Target',
        render: (_: unknown, row: PerformanceRow) => (
          <AchievementBar
            actual={row.salesAmount}
            target={row.targetSalesAmount}
            percent={row.salesAchievementPercent}
            status={row.status}
            format={money}
          />
        ),
        total: 'sum' as const,
        totalValue: (row: PerformanceRow) => row.salesAmount ?? 0,
        totalRender: (value: number) => money(value),
      },
      {
        key: 'bookedAmount', totalFormat: money,
        title: 'Booked',
        render: (value: number) => money(value ?? 0),
        total: 'sum' as const,
        totalRender: (value: number) => money(value),
      },
      {
        key: 'orderCount',
        title: 'Orders',
        render: (_: unknown, row: PerformanceRow) => (
          <span>
            {row.orderCount}
            {row.targetOrderCount != null && (
              <span style={{ color: '#6b7280' }}> / {row.targetOrderCount}</span>
            )}
          </span>
        ),
        total: 'sum' as const,
        totalValue: (row: PerformanceRow) => row.orderCount ?? 0,
      },
      {
        key: 'visitsCompleted',
        title: 'Visits',
        render: (_: unknown, row: PerformanceRow) => (
          <span>
            {row.visitsCompleted}
            <span style={{ color: '#6b7280' }}> / {row.visitsAssigned}</span>
            <span
              style={{
                display: 'block',
                fontSize: '0.75rem',
                fontWeight: row.belowVisitThreshold ? 600 : 400,
                color: row.belowVisitThreshold ? '#b91c1c' : '#6b7280',
              }}
            >
              {row.belowVisitThreshold && '⚠️ '}
              {row.visitCompletionRate}%
              {row.visitsSkipped > 0 && ` · ${row.visitsSkipped} skipped`}
            </span>
            {row.extraVisitsCompleted > 0 && (
              <span
                style={{ display: 'block', fontSize: '0.75rem', color: '#5b21b6' }}
                title="Extra visits the rider started themselves — not part of the rate above"
              >
                +{row.extraVisitsCompleted} extra
              </span>
            )}
          </span>
        ),
        total: 'sum' as const,
        totalValue: (row: PerformanceRow) => row.visitsCompleted ?? 0,
        totalRender: (value: number) => `${value.toLocaleString()} done`,
      },
      {
        key: 'avgVisitMinutes',
        title: 'Avg Time At Store',
        render: (value: number | null) => (value == null ? '-' : `${value} min`),
        total: 'avg' as const,
        totalRender: (value: number) => `${Math.round(value * 10) / 10} min`,
      },
      {
        key: 'strikeRatePercent',
        title: 'Strike Rate',
        render: (value: number) => (
          <span title="Share of completed visits that produced an order">{value}%</span>
        ),
        total: 'avg' as const,
        totalRender: (value: number) => `${Math.round(value * 10) / 10}%`,
      },
      {
        key: 'outstandingTotal', totalFormat: money,
        title: 'Outstanding',
        render: (value: number, row: PerformanceRow) => (
          <span style={{ color: value > 0 ? '#b45309' : undefined }}>
            {money(value ?? 0)}
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280' }}>
              {row.collectionRatePercent}% collected
            </span>
          </span>
        ),
        total: 'sum' as const,
        totalRender: (value: number) => money(value),
      },
      {
        key: 'returnAmount', totalFormat: money,
        title: 'Returns',
        render: (value: number, row: PerformanceRow) => (
          <span>
            {money(value ?? 0)}
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280' }}>
              {row.returnCount} incl. {row.damageCount} damage
            </span>
          </span>
        ),
        total: 'sum' as const,
        totalRender: (value: number) => money(value),
      },
      {
        key: 'daysPresent',
        title: 'Attendance',
        render: (value: number, row: PerformanceRow) => (
          <span>
            {value} days
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280' }}>
              {row.hoursWorked}h
              {row.avgHoursPerDay != null && ` · ${row.avgHoursPerDay}h/day`}
            </span>
          </span>
        ),
        total: 'sum' as const,
        totalRender: (value: number) => `${value.toLocaleString()} days`,
      },
      {
        key: 'tasksCompleted',
        title: 'Tasks',
        render: (_: unknown, row: PerformanceRow) =>
          row.tasksAssigned === 0 ? (
            '-'
          ) : (
            <span>
              {row.tasksCompleted}/{row.tasksAssigned}
              <span style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280' }}>
                {row.taskCompletionRate}%
              </span>
            </span>
          ),
        total: 'sum' as const,
        totalValue: (row: PerformanceRow) => row.tasksCompleted ?? 0,
      },
      {
        key: 'overstayCount',
        title: 'Flags',
        render: (_: unknown, row: PerformanceRow) => {
          const parts: string[] = [];
          if (row.overstayCount > 0) parts.push(`${row.overstayCount} overstay`);
          if (row.lowCompletionFlags > 0) parts.push(`${row.lowCompletionFlags} low completion`);
          if (parts.length === 0) return '0';
          return (
            <span style={{ color: '#b91c1c', fontWeight: 600, fontSize: '0.8125rem' }}>
              ⚠️ {parts.join(', ')}
            </span>
          );
        },
        total: 'sum' as const,
        totalValue: (row: PerformanceRow) => (row.overstayCount ?? 0) + (row.lowCompletionFlags ?? 0),
        totalRender: (value: number) => `${value.toLocaleString()} flags`,
      },
      { key: 'newClients', title: 'New Clients', total: 'sum' as const },
      {
        key: '_actions',
        title: 'Actions',
        render: (_: unknown, row: PerformanceRow) => (
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={styles.filterSelect}
              style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
              onClick={() => router.push(`/visits?employeeId=${row.employeeId}`)}
            >
              Visits
            </button>
            {canManageTargets && (
              <button
                type="button"
                className={styles.filterSelect}
                style={{ cursor: 'pointer', padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                onClick={() => setTargetFor(row)}
              >
                {row.targetSalesAmount == null ? 'Set target' : 'Edit target'}
              </button>
            )}
          </div>
        ),
      },
    ],
    [canManageTargets, router],
  );

  const trendChart = useMemo(() => {
    if (!trend || trend.months.length === 0) return null;
    return {
      labels: trend.months.map(formatPeriodMonth),
      datasets: [
        { label: 'Sales (delivered)', values: trend.sales },
        { label: 'Target', values: trend.targets },
      ],
    };
  }, [trend]);

  const activityChart = useMemo(() => {
    if (!trend || trend.months.length === 0) return null;
    return {
      labels: trend.months.map(formatPeriodMonth),
      datasets: [
        { label: 'Orders', values: trend.orders },
        { label: 'Visits completed', values: trend.visits },
      ],
    };
  }, [trend]);

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!report) {
    return (
      <Layout>
        <div className={styles.emptyState}>Failed to load analytics</div>
      </Layout>
    );
  }

  const { kpis } = report;

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>{isSelfOnly ? 'My Performance' : 'Team Performance'}</h1>
        </div>

        <div className={styles.filters}>
          <SearchableSelect
            name="periodMonth"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className={styles.filterSelect}
            placeholder="Month"
            options={recentPeriodMonths(12).map((m) => ({
              value: m,
              label: formatPeriodMonth(m),
            }))}
          />
          {!isSelfOnly && (
            <SearchableSelect
              name="employeeId"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={styles.filterSelect}
              placeholder="All team members"
              options={employeeOptions}
            />
          )}
        </div>

        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
          {formatPeriodMonth(periodMonth)} · {kpis.monthElapsedPercent}% of the month elapsed
          {kpis.headcount > 0 && ` · ${kpis.headcount} ${isSelfOnly ? 'person' : 'team member(s)'}`}
        </p>

        <div className={styles.kpiGrid}>
          <KpiTile metric="sales" label="Sales (Delivered)" query={detailQuery}>
            {money(kpis.salesAmount)}
          </KpiTile>
          <KpiTile metric="target" label="Target" query={detailQuery}>
            {kpis.targetSalesAmount ? money(kpis.targetSalesAmount) : '—'}
          </KpiTile>
          <KpiTile
            metric="achievement"
            label="Achievement"
            query={detailQuery}
            valueStyle={{
              color:
                kpis.salesAchievementPercent == null
                  ? undefined
                  : kpis.salesAchievementPercent >= 100
                    ? '#065f46'
                    : kpis.salesAchievementPercent >= kpis.monthElapsedPercent * 0.9
                      ? '#0369a1'
                      : '#b91c1c',
            }}
          >
            {kpis.salesAchievementPercent == null ? '—' : `${kpis.salesAchievementPercent}%`}
          </KpiTile>
          <KpiTile metric="booked" label="Booked (Open Orders)" query={detailQuery}>
            {money(kpis.bookedAmount)}
          </KpiTile>
          <KpiTile metric="orders" label="Orders" query={detailQuery}>
            {kpis.orderCount}
          </KpiTile>
          <KpiTile metric="visits-completed" label="Visits Completed" query={detailQuery}>
            {kpis.visitsCompleted}
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}> / {kpis.visitsAssigned}</span>
          </KpiTile>
          <KpiTile
            metric="overstays"
            label={`Overstays (>30 min)`}
            query={detailQuery}
            valueStyle={{ color: kpis.overstayCount > 0 ? '#b91c1c' : undefined }}
          >
            {kpis.overstayCount}
          </KpiTile>
          <KpiTile metric="new-clients" label="New Clients" query={detailQuery}>
            {kpis.newClients}
          </KpiTile>
          <KpiTile
            metric="visit-completion"
            label="Visit Completion"
            query={detailQuery}
            valueStyle={{
              color:
                kpis.visitsAssigned > 0 && kpis.visitCompletionRate < kpis.visitThresholdPercent
                  ? '#b91c1c'
                  : undefined,
            }}
          >
            {kpis.visitCompletionRate}%
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              {' '}
              / {kpis.visitThresholdPercent}% pass
            </span>
          </KpiTile>
          <KpiTile
            metric="visits-skipped"
            label="Visits Skipped"
            query={detailQuery}
            valueStyle={{ color: kpis.visitsSkipped > 0 ? '#92400e' : undefined }}
          >
            {kpis.visitsSkipped}
          </KpiTile>
          <KpiTile
            metric="extra-visits"
            label="Extra Visits"
            query={detailQuery}
            valueStyle={{ color: kpis.extraVisitsCompleted > 0 ? '#5b21b6' : undefined }}
            hint="Visits riders started themselves, outside their assigned route. Counted as work done, but not in the completion rate."
          >
            {kpis.extraVisitsCompleted}
          </KpiTile>
          <KpiTile
            metric="total-visits-done"
            label="Total Visits Done"
            query={detailQuery}
            hint="Assigned visits completed plus self-started extras"
          >
            {kpis.totalVisitsCompleted}
          </KpiTile>
          <KpiTile
            metric="open-flags"
            label="Open Flags"
            query={detailQuery}
            valueStyle={{ color: kpis.flagsOpen > 0 ? '#b91c1c' : undefined }}
          >
            {kpis.flagsOpen}
          </KpiTile>
          <KpiTile metric="days-present" label="Days Present" query={detailQuery}>
            {kpis.daysPresent}
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}> · {kpis.hoursWorked}h</span>
          </KpiTile>
          <KpiTile metric="collected" label="Collected" query={detailQuery}>
            {money(kpis.collectedTotal)}
          </KpiTile>
          <KpiTile
            metric="outstanding"
            label="Outstanding"
            query={detailQuery}
            valueStyle={{ color: kpis.outstandingTotal > 0 ? '#b45309' : undefined }}
          >
            {money(kpis.outstandingTotal)}
          </KpiTile>
          <KpiTile metric="collection-rate" label="Collection Rate" query={detailQuery}>
            {kpis.collectionRatePercent}%
          </KpiTile>
          <KpiTile metric="returns" label="Returns" query={detailQuery}>
            {money(kpis.returnAmount)}
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              {' '}
              ({kpis.returnRatePercent}%)
            </span>
          </KpiTile>
          <KpiTile metric="avg-order-value" label="Avg Order Value" query={detailQuery}>
            {money(kpis.avgOrderValue)}
          </KpiTile>
          <KpiTile
            metric="strike-rate"
            label="Strike Rate"
            query={detailQuery}
            hint="Share of completed visits that produced an order"
          >
            {kpis.strikeRatePercent}%
          </KpiTile>
          <KpiTile metric="tasks-done" label="Tasks Done" query={detailQuery}>
            {kpis.tasksCompleted}
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              {' '}
              / {kpis.tasksAssigned} ({kpis.taskCompletionRate}%)
            </span>
          </KpiTile>
          {!isSelfOnly && (
            <>
              <KpiTile
                metric="achieved-target"
                label="Achieved Target"
                query={detailQuery}
                valueStyle={{ color: '#065f46' }}
              >
                {kpis.ridersAchieved}
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}> / {kpis.headcount}</span>
              </KpiTile>
              <KpiTile
                metric="behind-pace"
                label="Behind Pace"
                query={detailQuery}
                valueStyle={{ color: kpis.ridersBehind > 0 ? '#b91c1c' : undefined }}
              >
                {kpis.ridersBehind}
              </KpiTile>
              <KpiTile
                metric="below-visits"
                label={`Below ${kpis.visitThresholdPercent}% Visits`}
                query={detailQuery}
                valueStyle={{ color: kpis.ridersBelowVisitThreshold > 0 ? '#b91c1c' : undefined }}
              >
                {kpis.ridersBelowVisitThreshold}
              </KpiTile>
            </>
          )}
        </div>

        <div className={styles.section}>
          <h2>Sales vs Target (last 6 months)</h2>
          <div className={styles.trendChartWrap}>
            {trendChart ? (
              <LineTrendChart labels={trendChart.labels} datasets={trendChart.datasets} />
            ) : (
              <div className={styles.emptyState}>No trend data</div>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <h2>Activity (last 6 months)</h2>
          <div className={styles.trendChartWrap}>
            {activityChart ? (
              <LineTrendChart labels={activityChart.labels} datasets={activityChart.datasets} />
            ) : (
              <div className={styles.emptyState}>No activity data</div>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <h2>{isSelfOnly ? 'My Numbers' : `Breakdown by Employee (${report.rows.length})`}</h2>
          <div className={styles.tableWrap}>
            <Table
              columns={columns}
              data={report.rows}
              loading={false}
              showGrandTotal
              exportFileName={`performance-${periodMonth}`}
              exportPdfTitle={`Performance — ${formatPeriodMonth(periodMonth)}`}
            />
          </div>
          {report.rows.length === 0 && (
            <div className={styles.emptyState}>
              No team members to report on for this period.
            </div>
          )}
        </div>
      </div>

      {targetFor && (
        <TargetModal
          row={targetFor}
          periodMonth={periodMonth}
          onClose={() => setTargetFor(null)}
          onSaved={() => {
            setTargetFor(null);
            load();
          }}
        />
      )}
    </Layout>
  );
};

export default function AnalyticsPageWrapper() {
  return (
    <ProtectedRoute reportPrefix="analytics.">
      <AnalyticsPage />
    </ProtectedRoute>
  );
}
