import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { leaveService, Leave } from '../../services/leaveService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const LeavesPage: React.FC = () => {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  useEffect(() => {
    if (!user) return;
    if (isOrderTaker && !user.id) return;
    fetchLeaves();
  }, [statusFilter, user?.id, user?.role]);

  const fetchLeaves = async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof leaveService.getLeaves>[0] = {
        status: statusFilter || undefined,
      };
      if (user?.role === 'order_taker' && user?.id) {
        params.employeeId = user.id;
      }
      const data = await leaveService.getLeaves(params);
      setLeaves(data);
    } catch (error) {
      toast.error('Failed to fetch leaves');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await leaveService.updateLeaveStatus(id, status);
      toast.success(`Leave ${status} successfully`);
      fetchLeaves();
    } catch (error: any) {
      toast.error(error.response?.data?.message || `Failed to ${status} leave`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this leave request?')) return;
    try {
      await leaveService.deleteLeave(id);
      toast.success('Leave request deleted');
      fetchLeaves();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete leave');
    }
  };

  const columns = [
    {
      key: 'employeeId',
      title: 'Employee',
      render: (value: any) => value?.username || '-',
    },
    {
      key: 'leaveType',
      title: 'Type',
      render: (value: string) =>
        value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    },
    {
      key: 'leaveDate',
      title: 'Leave Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: 'leaveReason',
      title: 'Reason',
      render: (value: string) => value || '-',
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: '_id',
      title: 'Actions',
      render: (_: string, row: Leave) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/leaves/${row._id}`);
            }}
          >
            View
          </button>
          {(isAdmin || (isOrderTaker && row.status === 'pending')) && (
            <button
              type="button"
              className={styles.editButton}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(`/leaves/${row._id}/edit`);
              }}
            >
              Edit
            </button>
          )}
          {isAdmin && row.status === 'pending' && (
            <>
              <button
                style={{
                  padding: '0.375rem 0.75rem',
                  background: '#d1fae5',
                  color: '#065f46',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStatusChange(row._id, 'approved');
                }}
              >
                Approve
              </button>
              <button
                style={{
                  padding: '0.375rem 0.75rem',
                  background: '#fee2e2',
                  color: '#991b1b',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStatusChange(row._id, 'rejected');
                }}
              >
                Reject
              </button>
            </>
          )}
          {(isAdmin || (isOrderTaker && row.status === 'pending')) && (
            <button
              className={styles.deleteButton}
              onClick={(e) => {
                e.stopPropagation();
                if (row.status !== 'approved') handleDelete(row._id);
              }}
              disabled={row.status === 'approved' || (isOrderTaker && row.status !== 'pending')}
              title={
                row.status === 'approved'
                  ? 'Approved leaves cannot be deleted'
                  : isOrderTaker && row.status !== 'pending'
                    ? 'Only pending leaves can be deleted'
                    : undefined
              }
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Leave Requests</h1>
          <button className={styles.addButton} onClick={() => router.push('/leaves/create')}>
            + Add Leave
          </button>
        </div>
        <div className={styles.searchBar}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 180 }}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <Table
          columns={columns}
          data={leaves}
          loading={loading}
          onRowClick={(row) => router.push(`/leaves/${row._id}`)}
        />
      </div>
    </Layout>
  );
};

export default function LeavesPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <LeavesPage />
    </ProtectedRoute>
  );
}
