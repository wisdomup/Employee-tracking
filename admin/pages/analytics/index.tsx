import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import Table from '../../components/UI/Table';
import AnalyticsExportButton from '../../components/UI/AnalyticsExportButton';
import SearchableSelect from '../../components/UI/SearchableSelect';
import TargetModal from '../../components/Analytics/TargetModal';
import AchievementBar from '../../components/Analytics/AchievementBar';
import { useAuth } from '../../contexts/AuthContext';
import { ALL_ROLES, can } from '../../utils/permissions';
import { employeeDisplayLabel } from '../../utils/employeeDisplayLabel';
import {
  analyticsService,
  PerformanceReport,
  PerformanceRow,
  PerformanceTrend,
  currentPeriodMonth,
  formatPeriodMonth,
  recentPeriodMonths,
} from '../../services/analyticsService';
import { toast } from 'react-toastify';
import type { AnalyticsExportPayload } from '../../utils/analyticsExport';
import type { TableExportColumn } from '../../utils/tableExport';
import styles from '../../styles/Reports.module.scss';

const LineTrendChart = dynamic(() => import('../../components/UI/LineTrendChart'), { ssr: false });

const money = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
   * The full team roster for the dropdown, tagged with the month it was fetched for.
   * Kept separate from `report.rows` because selecting one employee shrinks rows to a
   * single entry — deriving the dropdown from rows would then drop everyone else and
   * strand the user on that one person.
   */
  const [roster, setRoster] = useState<{ periodMonth: string; rows: PerformanceRow[] } | null>(
    null,
  );
  /** Discards responses from a superseded request when filters change mid-flight. */
  const requestSeq = useRef(0);
  /** Bumped after a target is saved, to pull the chart's target line back in sync. */
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    const seq = (requestSeq.current += 1);
    setLoading(true);
    try {
      const applyReport = (data: PerformanceReport) => {
        setReport(data);
        // An unfiltered report already IS the roster, so reuse it rather than paying for
        // the same expensive query a second time just to fill the dropdown.
        if (!employeeId) setRoster({ periodMonth, rows: data.rows });
      };

      // A cached copy renders straight away; `applyReport` runs again only if the
      // background refresh comes back with different numbers.
      const performance = await analyticsService.getPerformance(
        { periodMonth, employeeId: employeeId || undefined },
        (fresh) => {
          if (seq === requestSeq.current) applyReport(fresh);
        },
      );
      if (seq !== requestSeq.current) return;
      applyReport(performance);
    } catch {
      if (seq !== requestSeq.current) return;
      toast.error('Failed to load analytics');
      setReport(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [periodMonth, employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The trend is always the last 6 months counted from today, so it does not depend on
   * the selected period — refetching it on every month change was pure waste. Fetched
   * outside `load` so the KPIs and table paint without waiting on the charts.
   */
  useEffect(() => {
    let cancelled = false;
    setTrend(null);
    analyticsService
      .getTrend({ employeeId: employeeId || undefined, months: 6 }, (fresh) => {
        if (!cancelled) setTrend(fresh);
      })
      .then((t) => {
        if (!cancelled) setTrend(t);
      })
      .catch(() => {
        if (!cancelled) setTrend(null);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, refreshKey]);

  /**
   * Only needed while an employee filter is narrowing `report.rows`, and only once per
   * month — `load` fills the roster itself whenever the report is unfiltered.
   */
  useEffect(() => {
    if (isSelfOnly || !employeeId) return;
    if (roster?.periodMonth === periodMonth) return;
    let cancelled = false;
    analyticsService
      .getPerformance({ periodMonth })
      .then((r) => {
        if (!cancelled) setRoster({ periodMonth, rows: r.rows });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [periodMonth, employeeId, isSelfOnly, roster?.periodMonth]);

  const employeeOptions = useMemo(
    () => [
      { value: '', label: 'All team members' },
      ...(roster?.rows ?? []).map((r) => ({
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
      },
      {
        key: 'bookedAmount', totalFormat: money,
        title: 'Booked',
        render: (value: number) => money(value ?? 0),
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
      },
      {
        key: 'avgVisitMinutes', total: 'none' as const,
        title: 'Avg Time At Store',
        render: (value: number | null) => (value == null ? '-' : `${value} min`),
      },
      {
        key: 'strikeRatePercent', total: 'none' as const,
        title: 'Strike Rate',
        render: (value: number) => (
          <span title="Share of completed visits that produced an order">{value}%</span>
        ),
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
      },
      { key: 'newClients', title: 'New Clients' },
      {
        key: '_actions',
        title: 'Actions',
        omitFromExport: true,
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

  /**
   * Built on click so the PDF picks up the charts as they are currently drawn. Mirrors what
   * the page shows: KPI cards, both trends, then the per-employee breakdown.
   */
  const buildExportPayload = useCallback((): AnalyticsExportPayload => {
    const k = report?.kpis;
    return {
      filename: `performance-${periodMonth}${employeeId ? `-${employeeId}` : ''}`,
      title: isSelfOnly ? 'My Performance' : 'Team Performance',
      subtitle: `${formatPeriodMonth(periodMonth)} · ${k?.monthElapsedPercent ?? 0}% of the month elapsed${
        k?.headcount ? ` · ${k.headcount} ${isSelfOnly ? 'person' : 'team member(s)'}` : ''
      }`,
      kpis: k
        ? [
            { label: 'Sales (Delivered)', value: money(k.salesAmount) },
            { label: 'Target', value: k.targetSalesAmount ? money(k.targetSalesAmount) : '—' },
            {
              label: 'Achievement',
              value: k.salesAchievementPercent == null ? '—' : `${k.salesAchievementPercent}%`,
            },
            { label: 'Booked (Open Orders)', value: money(k.bookedAmount) },
            { label: 'Orders', value: k.orderCount },
            {
              label: 'Visits Completed',
              value: k.visitsCompleted,
              hint: `/ ${k.visitsAssigned}`,
            },
            { label: 'Overstays (>30 min)', value: k.overstayCount },
            { label: 'New Clients', value: k.newClients },
            {
              label: 'Visit Completion',
              value: `${k.visitCompletionRate}%`,
              hint: `/ ${k.visitThresholdPercent}% pass`,
            },
            { label: 'Visits Skipped', value: k.visitsSkipped },
            { label: 'Extra Visits', value: k.extraVisitsCompleted },
            { label: 'Total Visits Done', value: k.totalVisitsCompleted },
            { label: 'Open Flags', value: k.flagsOpen },
            { label: 'Days Present', value: k.daysPresent, hint: `· ${k.hoursWorked}h` },
            { label: 'Collected', value: money(k.collectedTotal) },
            { label: 'Outstanding', value: money(k.outstandingTotal) },
            { label: 'Collection Rate', value: `${k.collectionRatePercent}%` },
            {
              label: 'Returns',
              value: money(k.returnAmount),
              hint: `(${k.returnRatePercent}%)`,
            },
            { label: 'Avg Order Value', value: money(k.avgOrderValue) },
            { label: 'Strike Rate', value: `${k.strikeRatePercent}%` },
            {
              label: 'Tasks Done',
              value: k.tasksCompleted,
              hint: `/ ${k.tasksAssigned} (${k.taskCompletionRate}%)`,
            },
            ...(isSelfOnly
              ? []
              : [
                  {
                    label: 'Achieved Target',
                    value: k.ridersAchieved,
                    hint: `/ ${k.headcount}`,
                  },
                  { label: 'Behind Pace', value: k.ridersBehind },
                  {
                    label: `Below ${k.visitThresholdPercent}% Visits`,
                    value: k.ridersBelowVisitThreshold,
                  },
                ]),
          ]
        : [],
      charts: [
        ...(trendChart
          ? [
              {
                title: 'Sales vs Target (last 6 months)',
                elementId: 'analytics-sales-trend-chart',
                labelHeader: 'Month',
                ...trendChart,
              },
            ]
          : []),
        ...(activityChart
          ? [
              {
                title: 'Activity (last 6 months)',
                elementId: 'analytics-activity-trend-chart',
                labelHeader: 'Month',
                ...activityChart,
              },
            ]
          : []),
      ],
      tables: report?.rows.length
        ? [
            {
              title: isSelfOnly
                ? 'My Numbers'
                : `Breakdown by Employee (${report.rows.length})`,
              columns: columns as TableExportColumn[],
              rows: report.rows,
            },
          ]
        : [],
    };
  }, [activityChart, columns, employeeId, isSelfOnly, periodMonth, report, trendChart]);

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
          <div className={styles.headerRow}>
            <h1>{isSelfOnly ? 'My Performance' : 'Team Performance'}</h1>
            <AnalyticsExportButton
              buildPayload={buildExportPayload}
              ariaLabel="Export performance report"
            />
          </div>
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
          <div className={styles.kpiCard}>
            <span>Sales (Delivered)</span>
            <strong>{money(kpis.salesAmount)}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Target</span>
            <strong>{kpis.targetSalesAmount ? money(kpis.targetSalesAmount) : '—'}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Achievement</span>
            <strong
              style={{
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
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Booked (Open Orders)</span>
            <strong>{money(kpis.bookedAmount)}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Orders</span>
            <strong>{kpis.orderCount}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Visits Completed</span>
            <strong>
              {kpis.visitsCompleted}
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                {' '}
                / {kpis.visitsAssigned}
              </span>
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Overstays ({'>'}30 min)</span>
            <strong style={{ color: kpis.overstayCount > 0 ? '#b91c1c' : undefined }}>
              {kpis.overstayCount}
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>New Clients</span>
            <strong>{kpis.newClients}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Visit Completion</span>
            <strong
              style={{
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
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Visits Skipped</span>
            <strong style={{ color: kpis.visitsSkipped > 0 ? '#92400e' : undefined }}>
              {kpis.visitsSkipped}
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Extra Visits</span>
            <strong
              style={{ color: kpis.extraVisitsCompleted > 0 ? '#5b21b6' : undefined }}
              title="Visits riders started themselves, outside their assigned route. Counted as work done, but not in the completion rate."
            >
              {kpis.extraVisitsCompleted}
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Total Visits Done</span>
            <strong title="Assigned visits completed plus self-started extras">
              {kpis.totalVisitsCompleted}
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Open Flags</span>
            <strong style={{ color: kpis.flagsOpen > 0 ? '#b91c1c' : undefined }}>
              {kpis.flagsOpen}
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Days Present</span>
            <strong>
              {kpis.daysPresent}
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                {' '}
                · {kpis.hoursWorked}h
              </span>
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Collected</span>
            <strong>{money(kpis.collectedTotal)}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Outstanding</span>
            <strong style={{ color: kpis.outstandingTotal > 0 ? '#b45309' : undefined }}>
              {money(kpis.outstandingTotal)}
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Collection Rate</span>
            <strong>{kpis.collectionRatePercent}%</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Returns</span>
            <strong>
              {money(kpis.returnAmount)}
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                {' '}
                ({kpis.returnRatePercent}%)
              </span>
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Avg Order Value</span>
            <strong>{money(kpis.avgOrderValue)}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Strike Rate</span>
            <strong title="Share of completed visits that produced an order">
              {kpis.strikeRatePercent}%
            </strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Tasks Done</span>
            <strong>
              {kpis.tasksCompleted}
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                {' '}
                / {kpis.tasksAssigned} ({kpis.taskCompletionRate}%)
              </span>
            </strong>
          </div>
          {!isSelfOnly && (
            <>
              <div className={styles.kpiCard}>
                <span>Achieved Target</span>
                <strong style={{ color: '#065f46' }}>
                  {kpis.ridersAchieved}
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}> / {kpis.headcount}</span>
                </strong>
              </div>
              <div className={styles.kpiCard}>
                <span>Behind Pace</span>
                <strong style={{ color: kpis.ridersBehind > 0 ? '#b91c1c' : undefined }}>
                  {kpis.ridersBehind}
                </strong>
              </div>
              <div className={styles.kpiCard}>
                <span>Below {kpis.visitThresholdPercent}% Visits</span>
                <strong
                  style={{ color: kpis.ridersBelowVisitThreshold > 0 ? '#b91c1c' : undefined }}
                >
                  {kpis.ridersBelowVisitThreshold}
                </strong>
              </div>
            </>
          )}
        </div>

        <div className={styles.section}>
          <h2>Sales vs Target (last 6 months)</h2>
          <div className={styles.trendChartWrap} id="analytics-sales-trend-chart">
            {trendChart ? (
              <LineTrendChart labels={trendChart.labels} datasets={trendChart.datasets} />
            ) : (
              <div className={styles.emptyState}>No trend data</div>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <h2>Activity (last 6 months)</h2>
          <div className={styles.trendChartWrap} id="analytics-activity-trend-chart">
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
            // The saved target changes achievement everywhere, so every cached report is
            // now wrong — drop them all rather than render a stale copy first.
            analyticsService.invalidate();
            load();
            // The chart's target line is served by the trend endpoint, which `load` no
            // longer refetches, so nudge it explicitly.
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </Layout>
  );
};

export default function AnalyticsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <AnalyticsPage />
    </ProtectedRoute>
  );
}
