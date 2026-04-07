import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import {
  broadcastNotificationService,
  BroadcastNotification,
  BroadcastAudienceType,
  BROADCAST_AUDIENCE_LABELS,
  audienceTypeFromApi,
} from '../../services/broadcastNotificationService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';

const AUDIENCE_FILTER_KEYS: { value: string; label: string }[] = [
  { value: '', label: 'All audiences' },
  ...(
    [
      'all',
      'all_employees',
      'role_order_taker',
      'role_delivery_man',
      'role_warehouse_manager',
      'specific_users',
    ] as BroadcastAudienceType[]
  ).map((k) => ({ value: k, label: BROADCAST_AUDIENCE_LABELS[k] })),
];

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
        audienceType: targetFilter || undefined,
      });
      setNotifications(data);
    } catch {
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
    } catch (error: unknown) {
      const msg =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg || 'Failed to delete notification');
    }
  };

  const audienceLabel = (row: BroadcastNotification) => {
    const at = audienceTypeFromApi(row);
    return BROADCAST_AUDIENCE_LABELS[at] ?? at;
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
      key: 'audienceType',
      title: 'Audience',
      render: (_: unknown, row: BroadcastNotification) => (
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
          {audienceLabel(row)}
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
            type="button"
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/broadcast-notifications/${row._id}/edit`);
            }}
          >
            Edit
          </button>
          <button
            type="button"
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
            type="button"
            className={styles.addButton}
            onClick={() => router.push('/broadcast-notifications/create')}
          >
            + New Notification
          </button>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <SearchableSelect
                name="targetFilter"
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 320 }}
                placeholder="All audiences"
                options={AUDIENCE_FILTER_KEYS}
              />
            </div>
            <Table columns={columns} data={notifications} loading={loading} />
          </div>
        </div>
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
