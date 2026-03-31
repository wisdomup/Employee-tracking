import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { activityLogService, ActivityLog } from '../../services/activityLogService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const ActivityLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    fetchLogs();
  }, [user?.id, user?.role]);

  const actorId = (employeeId: unknown): string => {
    if (employeeId == null) return '';
    if (typeof employeeId === 'string') return employeeId;
    const o = employeeId as { _id?: string };
    return o._id ?? '';
  };

  const fetchLogs = async () => {
    try {
      let data: ActivityLog[];
      if (user?.role === 'order_taker' && user?.id) {
        data = await activityLogService.getEmployeeActivityLogs(user.id);
      } else {
        data = await activityLogService.getActivityLogs();
      }
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
      title: 'Actor',
      render: (value: any) => {
        const name = value?.username || '-';
        const id = actorId(value);
        if (user?.id && id && id === user.id) {
          return (
            <>
              {name}
              <span style={{ color: '#6b7280', fontWeight: 500, marginLeft: '0.5rem' }}>(You)</span>
            </>
          );
        }
        return name;
      },
    },
    {
      key: 'module',
      title: 'Module',
      render: (value: string) =>
        value
          ? value === 'employee'
            ? 'Employee'
            : value.charAt(0).toUpperCase() + value.slice(1)
          : '-',
    },
    {
      key: 'entityId',
      title: 'Entity',
      render: (value: string, row: ActivityLog) => {
        const entityId = value || '';
        const meta = row.meta || {};

        let label = entityId ? entityId.slice(-8).toUpperCase() : '-';
        let href: string | null = null;

        switch (row.module) {
          case 'client':
            label = `${meta.shopName || meta.name || 'Client'}${meta.name ? ` - ${meta.name}` : ''}${meta.phone ? ` (${meta.phone})` : ''}`;
            href = `/clients/${entityId}`;
            break;
          case 'product':
            label = `${meta.name || 'Product'}${meta.barcode ? ` (${meta.barcode})` : ''}`;
            href = `/products/${entityId}`;
            break;
          case 'order':
            label = `Order ${entityId ? entityId.slice(-8).toUpperCase() : ''}`.trim();
            href = `/orders/${entityId}`;
            break;
          case 'employee':
            label = `${meta.username || 'Employee'}${meta.phone ? ` (${meta.phone})` : ''}`;
            href = `/employees/${entityId}`;
            break;
          case 'category':
            label = String(meta.name || 'Category');
            href = `/categories/${entityId}/edit`;
            break;
          case 'route':
            label = String(meta.name || 'Route');
            href = `/routes/${entityId}`;
            break;
          case 'return':
            label = `Return ${entityId ? entityId.slice(-8).toUpperCase() : ''}`.trim();
            href = `/returns/${entityId}`;
            break;
          case 'visit':
            label = `Visit ${entityId ? entityId.slice(-8).toUpperCase() : ''}`.trim();
            href = `/visits/${entityId}`;
            break;
          case 'task':
            label = String(meta.taskName || row.taskId?.taskName || `Task ${entityId.slice(-8).toUpperCase()}`);
            href = `/tasks/${entityId}`;
            break;
          default:
            href = null;
        }

        if (!href || !entityId) {
          return label;
        }

        return (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#2563eb', textDecoration: 'underline' }}
          >
            {label}
          </Link>
        );
      },
    },
    {
      key: 'action',
      title: 'Action',
      render: (value: string) => (
        <span style={{ textTransform: 'capitalize' }}>
          {value ? value.replace(/_/g, ' ') : '-'}
        </span>
      ),
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
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ActivityLogsPage />
    </ProtectedRoute>
  );
}
