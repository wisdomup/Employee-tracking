import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout/Layout';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
import Loader from '../components/UI/Loader';
import MapView from '../components/Map/MapView';
import { dashboardService, DashboardStats } from '../services/dashboardService';
import { format } from 'date-fns';
import styles from '../styles/Dashboard.module.scss';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const data = await dashboardService.getStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

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
    if (task.dealerLocation) {
      markers.push({
        lat: task.dealerLocation.latitude,
        lng: task.dealerLocation.longitude,
        type: 'dealer' as const,
        label: task.dealerLocation.name,
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

  return (
    <Layout>
      <div className={styles.dashboard}>
        <h1 className={styles.title}>Dashboard</h1>

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalEmployees}</div>
              <div className={styles.statLabel}>Total Employees</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>🏪</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalDealers}</div>
              <div className={styles.statLabel}>Total Dealers</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>📋</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalTasks}</div>
              <div className={styles.statLabel}>Total Tasks</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>✅</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.stats.tasksCompletedToday}
              </div>
              <div className={styles.statLabel}>Completed Today</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>⏳</div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.tasksInProgress}</div>
              <div className={styles.statLabel}>In Progress</div>
            </div>
          </div>
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
                      {activity.action === 'started_task' ? '▶️' : '✅'}
                    </div>
                    <div className={styles.activityContent}>
                      <div className={styles.activityText}>
                        <strong>{activity.employeeId?.username}</strong>{' '}
                        {activity.action === 'started_task'
                          ? 'started'
                          : 'completed'}{' '}
                        <strong>
                          {activity.taskAssignmentId?.taskId?.taskName}
                        </strong>
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
