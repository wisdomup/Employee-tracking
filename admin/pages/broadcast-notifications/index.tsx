import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import {
  broadcastNotificationService,
  BroadcastNotification,
} from '../../services/broadcastNotificationService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const BroadcastNotificationsPage: React.FC = () => {
  const [notifications, setNotifications] = useState<BroadcastNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetFilter, setTargetFilter] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchNotifications();
  }, [targetFilter]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const data = await broadcastNotificationService.getNotifications({
        broadcastTo: targetFilter || undefined,
      });
      setNotifications(data);
    } catch (error) {
      toast.error('Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this notification?')) return;
    try {
      await broadcastNotificationService.deleteNotification(id);
      toast.success('Notification deleted');
      fetchNotifications();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete notification');
    }
  };

  const columns = [
    { key: 'title', title: 'Title' },
    {
      key: 'description',
      title: 'Description',
      render: (value: string) =>
        value ? (value.length > 60 ? value.slice(0, 60) + '...' : value) : '-',
    },
    {
      key: 'broadcastTo',
      title: 'Target',
      render: (value: string) => (
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.75rem',
            borderRadius: '1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            background: '#e0e7ff',
            color: '#3730a3',
          }}
        >
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </span>
      ),
    },
    {
      key: 'startAt',
      title: 'Start',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: 'endAt',
      title: 'End',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: '_id',
      title: 'Actions',
      render: (_: string, row: BroadcastNotification) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/broadcast-notifications/${row._id}/edit`);
            }}
          >
            Edit
          </button>
          <button
            className={styles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row._id);
            }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Broadcast Notifications</h1>
          <button
            className={styles.addButton}
            onClick={() => router.push('/broadcast-notifications/create')}
          >
            + New Notification
          </button>
        </div>
        <div className={styles.searchBar}>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 200 }}
          >
            <option value="">All Targets</option>
            <option value="all">All</option>
            <option value="employees">Employees</option>
            <option value="clients">Clients</option>
            <option value="customers">Customers</option>
          </select>
        </div>
        <Table columns={columns} data={notifications} loading={loading} />
      </div>
    </Layout>
  );
};

export default function BroadcastNotificationsPageWrapper() {
  return (
    <ProtectedRoute>
      <BroadcastNotificationsPage />
    </ProtectedRoute>
  );
}
