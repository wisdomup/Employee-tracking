import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import {
  approvalService,
  Approval,
  APPROVAL_TYPE_LABELS,
  ApprovalType,
} from '../../services/approvalService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { getApiErrorMessage } from '../../utils/apiError';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const ApprovalsPage: React.FC = () => {
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  useEffect(() => {
    if (!user) return;
    if (isOrderTaker && !user.id) return;
    fetchRows();
  }, [statusFilter, typeFilter, user?.id, user?.role]);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof approvalService.getApprovals>[0] = {
        status: statusFilter || undefined,
        approvalType: typeFilter || undefined,
      };
      if (user?.role === 'order_taker' && user?.id) {
        params.employeeId = user.id;
      }
      const data = await approvalService.getApprovals(params);
      setRows(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to fetch approvals'));
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await approvalService.updateApprovalStatus(id, status);
      toast.success(`Approval ${status} successfully`);
      fetchRows();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, `Failed to ${status} approval`));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this approval?')) return;
    try {
      await approvalService.deleteApproval(id);
      toast.success('Approval deleted');
      fetchRows();
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, 'Failed to delete approval'));
    }
  };

  const formatDuration = (row: Approval) => {
    if (row.approvalType !== 'leave' || !row.leaveType) return '—';
    return row.leaveType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const effectiveType = (row: Approval): ApprovalType =>
    row.approvalType ?? 'leave';

  const columns = [
    {
      key: 'employeeId',
      title: 'Employee',
      render: (value: any) => value?.username || '-',
    },
    {
      key: 'approvalType',
      title: 'Approval type',
      render: (_: unknown, row: Approval) => APPROVAL_TYPE_LABELS[effectiveType(row)] ?? '-',
    },
    {
      key: 'leaveType',
      title: 'Duration',
      render: (_: unknown, row: Approval) => formatDuration(row),
    },
    {
      key: 'leaveDate',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: 'leaveReason',
      title: 'Details',
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
      render: (_: string, row: Approval) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/approvals/${row._id}`);
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
                router.push(`/approvals/${row._id}/edit`);
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
                  ? 'Approved requests cannot be deleted'
                  : isOrderTaker && row.status !== 'pending'
                    ? 'Only pending approvals can be deleted'
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
          <h1>Approvals</h1>
          <button className={styles.addButton} onClick={() => router.push('/approvals/create')}>
            + New approval
          </button>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={styles.searchInput}
                style={{ maxWidth: 180 }}
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className={styles.searchInput}
                style={{ maxWidth: 200 }}
              >
                <option value="">All types</option>
                {(Object.keys(APPROVAL_TYPE_LABELS) as ApprovalType[]).map((t) => (
                  <option key={t} value={t}>
                    {APPROVAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <Table
              columns={columns}
              data={rows}
              loading={loading}
              onRowClick={(row) => router.push(`/approvals/${row._id}`)}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ApprovalsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ApprovalsPage />
    </ProtectedRoute>
  );
}
