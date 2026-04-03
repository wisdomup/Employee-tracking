import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Loader from '../../../components/UI/Loader';
import {
  approvalService,
  Approval,
  APPROVAL_TYPE_LABELS,
  ApprovalType,
} from '../../../services/approvalService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { getApiErrorMessage } from '../../../utils/apiError';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const ApprovalDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [row, setRow] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  useEffect(() => {
    if (id) {
      approvalService
        .getApproval(id as string)
        .then(setRow)
        .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to fetch approval')))
        .finally(() => setLoading(false));
    }
  }, [id]);

  const handleStatusChange = async (status: 'approved' | 'rejected') => {
    setUpdating(true);
    try {
      await approvalService.updateApprovalStatus(id as string, status);
      toast.success(`Approval ${status} successfully`);
      const updated = await approvalService.getApproval(id as string);
      setRow(updated);
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, `Failed to ${status} approval`));
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this approval?')) return;
    setUpdating(true);
    try {
      await approvalService.deleteApproval(id as string);
      toast.success('Approval deleted');
      router.push('/approvals');
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, 'Failed to delete approval'));
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <Layout><Loader /></Layout>;
  if (!row) return <Layout><div>Approval not found</div></Layout>;

  const ownerId =
    typeof row.employeeId === 'string'
      ? row.employeeId
      : (row.employeeId as { _id?: string })?._id ?? '';

  const canOrderTakerMutate =
    isOrderTaker && user?.id && ownerId === user.id && row.status === 'pending';

  const approvalType: ApprovalType = row.approvalType ?? 'leave';
  const durationLabel =
    approvalType === 'leave' && row.leaveType
      ? row.leaveType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : '—';

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Approval details</h1>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {(isAdmin || canOrderTakerMutate) && (
              <button
                type="button"
                className={styles.backButton}
                style={{ background: '#dbeafe', color: '#1e40af' }}
                onClick={() => router.push(`/approvals/${id}/edit`)}
              >
                Edit
              </button>
            )}
            {(isAdmin || canOrderTakerMutate) && (
              <button
                className={styles.backButton}
                style={row.status !== 'pending' ? undefined : { background: '#fee2e2', color: '#991b1b' }}
                onClick={handleDelete}
                disabled={updating || row.status === 'approved' || (isOrderTaker && row.status !== 'pending')}
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
            <button className={styles.backButton} onClick={() => router.push('/approvals')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>Information</h2>
              {isAdmin && row.status === 'pending' && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    disabled={updating}
                    onClick={() => handleStatusChange('approved')}
                    style={{
                      padding: '0.5rem 1.25rem',
                      background: '#059669',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.875rem',
                      opacity: updating ? 0.6 : 1,
                    }}
                  >
                    Approve
                  </button>
                  <button
                    disabled={updating}
                    onClick={() => handleStatusChange('rejected')}
                    style={{
                      padding: '0.5rem 1.25rem',
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.875rem',
                      opacity: updating ? 0.6 : 1,
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>

            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Employee:</span>
                <span className={styles.value}>{row.employeeId?.username || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Employee phone:</span>
                <span className={styles.value}>{row.employeeId?.phone || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Approval type:</span>
                <span className={styles.value}>{APPROVAL_TYPE_LABELS[approvalType]}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Duration:</span>
                <span className={styles.value}>{durationLabel}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Date:</span>
                <span className={styles.value}>
                  {format(new Date(row.leaveDate), 'MMM dd, yyyy')}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>{approvalType === 'leave' ? 'Reason:' : 'Details:'}</span>
                <span className={styles.value}>{row.leaveReason || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span className={styles.value}><StatusBadge status={row.status} /></span>
              </div>
              {row.approvedBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Reviewed by:</span>
                  <span className={styles.value}>{row.approvedBy?.username || '-'}</span>
                </div>
              )}
              {row.approvedAt && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Reviewed at:</span>
                  <span className={styles.value}>
                    {format(new Date(row.approvedAt), 'MMM dd, yyyy hh:mm a')}
                  </span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Submitted:</span>
                <span className={styles.value}>
                  {format(new Date(row.createdAt), 'MMM dd, yyyy hh:mm a')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ApprovalDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ApprovalDetailPage />
    </ProtectedRoute>
  );
}
