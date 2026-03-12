import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { activityLogService, ActivityLog } from '../../services/activityLogService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const ActivityLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const data = await activityLogService.getActivityLogs();
      setLogs(data);
    } catch (error) {
      toast.error('Failed to fetch activity logs');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: 'employeeId',
      title: 'Employee',
      render: (value: any) => value?.username || '-',
    },
    {
      key: 'taskId',
      title: 'Task',
      render: (value: any) => value?.taskName || '-',
    },
    {
      key: 'action',
      title: 'Action',
      render: (value: string) => (
        <span style={{ textTransform: 'capitalize' }}>{value.replace(/_/g, ' ')}</span>
      ),
    },
    {
      key: 'latitude',
      title: 'GPS Location',
      render: (_: any, row: ActivityLog) =>
        `${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}`,
    },
    {
      key: 'timestamp',
      title: 'Timestamp',
      render: (value: string) =>
        value ? format(new Date(value), 'MMM dd, yyyy hh:mm a') : '-',
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Activity Logs</h1>
        </div>
        <Table columns={columns} data={logs} loading={loading} />
      </div>
    </Layout>
  );
};

export default function ActivityLogsPageWrapper() {
  return (
    <ProtectedRoute>
      <ActivityLogsPage />
    </ProtectedRoute>
  );
}
