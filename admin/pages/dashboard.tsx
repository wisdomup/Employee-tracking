import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Layout from '../components/Layout/Layout';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
import Loader from '../components/UI/Loader';
import MapView from '../components/Map/MapView';
import DatePickerFilter from '../components/UI/DatePickerFilter';
import {
  dashboardService,
  DashboardReports,
  DashboardStats,
  RecentActivityEntry,
} from '../services/dashboardService';
import { format } from 'date-fns';
import styles from '../styles/Dashboard.module.scss';

const LineTrendChart = dynamic(() => import('../components/UI/LineTrendChart'), {
  ssr: false,
});

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reports, setReports] = useState<DashboardReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'year'>('month');

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    const run = async () => {
      setReportLoading(true);
      try {
        const data = await dashboardService.getReports({ startDate, endDate, groupBy, viewBy: 'item' });
        setReports(data);
      } catch (error) {
        console.error('Failed to fetch dashboard reports:', error);
      } finally {
        setReportLoading(false);
      }
    };
    run();
  }, [startDate, endDate, groupBy]);

  const fetchInitialData = async () => {
    try {
      const [statsData, reportData] = await Promise.all([
        dashboardService.getStats(),
        dashboardService.getReports({ startDate, endDate, groupBy, viewBy: 'item' }),
      ]);
      setStats(statsData);
      setReports(reportData);
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    } finally {
      setLoading(false);
      setReportLoading(false);
    }
  };

  const salesValues = useMemo(
    () => reports?.salesTrend.map((row) => row.totalSales) ?? [],
    [reports],
  );

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!stats) {
    return (
      <Layout>
        <div>Failed to load dashboard data</div>
      </Layout>
    );
  }

  const mapMarkers = stats.completedTasksForMap.flatMap((task) => {
    const markers = [];
    if (task.clientLocation) {
      markers.push({
        lat: task.clientLocation.latitude,
        lng: task.clientLocation.longitude,
        type: 'client' as const,
        label: task.clientLocation.name,
      });
    }
    if (task.completionLocation) {
      markers.push({
        lat: task.completionLocation.latitude,
        lng: task.completionLocation.longitude,
        type: 'completion' as const,
        label: `${task.taskName} - ${task.employeeName}`,
      });
    }
    return markers;
  });

  const getActivityIcon = (activity: RecentActivityEntry) => {
    if (activity.action === 'started_task') return '▶️';
    if (activity.action === 'completed_task') return '✅';
    if (activity.action === 'deleted') return '🗑️';
    if (activity.action === 'status_changed') return '🔄';
    if (activity.action === 'updated') return '✏️';
    return '➕';
  };

  const getActivityText = (activity: RecentActivityEntry) => {
    const actor = activity.employeeId?.username || 'System';
    const actionText = activity.action.replace(/_/g, ' ');
    const moduleText = activity.module ? activity.module.replace(/_/g, ' ') : 'item';
    const taskName = activity.taskId?.taskName;
    const entityShort = activity.entityId ? activity.entityId.slice(-6).toUpperCase() : '';
    if (taskName) {
      return `${actor} ${actionText} ${taskName}`;
    }
    return `${actor} ${actionText} ${moduleText}${entityShort ? ` (${entityShort})` : ''}`;
  };

  return (
    <Layout>
      <div className={styles.dashboard}>
        <h1 className={styles.title}>Dashboard</h1>

        <div className={styles.statsGrid}>
          <Link href="/employees" className={styles.statCard}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalEmployees}</div>
              <div className={styles.statLabel}>Total Employees</div>
            </div>
          </Link>

          <Link href="/clients" className={styles.statCard}>
            <div className={styles.statIcon}>🏪</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalClients}</div>
              <div className={styles.statLabel}>Total Clients</div>
            </div>
          </Link>

          <Link href="/tasks" className={styles.statCard}>
            <div className={styles.statIcon}>📋</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalTasks}</div>
              <div className={styles.statLabel}>Total Tasks</div>
            </div>
          </Link>

          <Link href="/tasks" className={styles.statCard}>
            <div className={styles.statIcon}>✅</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.stats.tasksCompletedToday}
              </div>
              <div className={styles.statLabel}>Completed Today</div>
            </div>
          </Link>

          <Link href="/tasks" className={styles.statCard}>
            <div className={styles.statIcon}>⏳</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.tasksInProgress}</div>
              <div className={styles.statLabel}>In Progress</div>
            </div>
          </Link>
        </div>

        <div className={styles.section}>
          <div className={styles.reportHeader}>
            <h2 className={styles.sectionTitle}>Sales & Stock Highlights</h2>
            <Link href="/reports" className={styles.reportsLink}>Open Full Reports</Link>
          </div>
          <div className={styles.reportFilters}>
            <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="Start date" />
            <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="End date" />
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'day' | 'month' | 'year')}
              className={styles.reportSelect}
            >
              <option value="day">Daily</option>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </select>
          </div>

          {reportLoading || !reports ? (
            <Loader />
          ) : (
            <>
              <div className={styles.reportGrid}>
                <div className={styles.reportCard}>
                  <span>Earned (Delivered Sales)</span>
                  <strong>{reports.kpis.salesInRange.toFixed(2)}</strong>
                </div>
                <div className={styles.reportCard}>
                  <span>Booked Sales (Open Orders)</span>
                  <strong>{reports.kpis.bookedSalesInRange.toFixed(2)}</strong>
                </div>
                <div className={styles.reportCard}>
                  <span>Paid Back (Returns)</span>
                  <strong>{reports.kpis.totalReturnPayout.toFixed(2)}</strong>
                </div>
                <div className={styles.reportCard}>
                  <span>Net After Returns</span>
                  <strong>{reports.kpis.netAfterReturns.toFixed(2)}</strong>
                </div>
                <div className={styles.reportCard}>
                  <span>Current Stock</span>
                  <strong>{reports.kpis.totalCurrentStock}</strong>
                </div>
                <div className={styles.reportCard}>
                  <span>Damaged Stock</span>
                  <strong>{reports.kpis.totalDamagedQty}</strong>
                </div>
                <div className={styles.reportCard}>
                  <span>Stock Hold</span>
                  <strong>{reports.kpis.totalHoldStock}</strong>
                </div>
              </div>
              <div className={styles.sparkline}>
                <LineTrendChart
                  labels={reports.salesTrend.map((row) => row.period)}
                  values={salesValues}
                  height={200}
                  compact
                  emptyText="No sales data"
                />
              </div>
            </>
          )}
        </div>

        <div className={styles.contentGrid}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Activity</h2>
            <div className={styles.activityList}>
              {stats.recentActivity.length === 0 ? (
                <div className={styles.emptyState}>No recent activity</div>
              ) : (
                stats.recentActivity.map((activity: any) => (
                  <div key={activity._id} className={styles.activityItem}>
                    <div className={styles.activityIcon}>
                      {getActivityIcon(activity)}
                    </div>
                    <div className={styles.activityContent}>
                      <div className={styles.activityText}>
                        {getActivityText(activity)}
                      </div>
                      <div className={styles.activityTime}>
                        {format(new Date(activity.timestamp), 'MMM dd, yyyy hh:mm a')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Completed Tasks Map</h2>
            {mapMarkers.length > 0 ? (
              <MapView markers={mapMarkers} height="400px" />
            ) : (
              <div className={styles.emptyState}>
                No completed tasks with location data
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  );
}
