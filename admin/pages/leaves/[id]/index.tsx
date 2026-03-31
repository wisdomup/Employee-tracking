import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Loader from '../../../components/UI/Loader';
import { leaveService, Leave } from '../../../services/leaveService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const LeaveDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [leave, setLeave] = useState<Leave | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  useEffect(() => {
    if (id) {
      leaveService
        .getLeave(id as string)
        .then(setLeave)
        .catch(() => toast.error('Failed to fetch leave'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  const handleStatusChange = async (status: 'approved' | 'rejected') => {
    setUpdating(true);
    try {
      await leaveService.updateLeaveStatus(id as string, status);
      toast.success(`Leave ${status} successfully`);
      const updated = await leaveService.getLeave(id as string);
      setLeave(updated);
    } catch (error: any) {
      toast.error(error.response?.data?.message || `Failed to ${status} leave`);
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this leave request?')) return;
    setUpdating(true);
    try {
      await leaveService.deleteLeave(id as string);
      toast.success('Leave request deleted');
      router.push('/leaves');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete leave');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <Layout><Loader /></Layout>;
  if (!leave) return <Layout><div>Leave request not found</div></Layout>;

  const leaveOwnerId =
    typeof leave.employeeId === 'string'
      ? leave.employeeId
      : (leave.employeeId as { _id?: string })?._id ?? '';

  const canOrderTakerMutate =
    isOrderTaker && user?.id && leaveOwnerId === user.id && leave.status === 'pending';

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Leave Request Details</h1>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {(isAdmin || canOrderTakerMutate) && (
              <button
                type="button"
                className={styles.backButton}
                style={{ background: '#dbeafe', color: '#1e40af' }}
                onClick={() => router.push(`/leaves/${id}/edit`)}
              >
                Edit
              </button>
            )}
            {(isAdmin || canOrderTakerMutate) && (
              <button
                className={styles.backButton}
                style={leave.status !== 'pending' ? undefined : { background: '#fee2e2', color: '#991b1b' }}
                onClick={handleDelete}
                disabled={updating || leave.status === 'approved' || (isOrderTaker && leave.status !== 'pending')}
                title={
                  leave.status === 'approved'
                    ? 'Approved leaves cannot be deleted'
                    : isOrderTaker && leave.status !== 'pending'
                      ? 'Only pending leaves can be deleted'
                      : undefined
                }
              >
                Delete
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/leaves')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>Leave Information</h2>
              {isAdmin && leave.status === 'pending' && (
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
                <span className={styles.value}>{leave.employeeId?.username || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Employee Phone:</span>
                <span className={styles.value}>{leave.employeeId?.phone || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Leave Type:</span>
                <span className={styles.value}>
                  {leave.leaveType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Leave Date:</span>
                <span className={styles.value}>
                  {format(new Date(leave.leaveDate), 'MMM dd, yyyy')}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Reason:</span>
                <span className={styles.value}>{leave.leaveReason || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span className={styles.value}><StatusBadge status={leave.status} /></span>
              </div>
              {leave.approvedBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Reviewed By:</span>
                  <span className={styles.value}>{leave.approvedBy?.username || '-'}</span>
                </div>
              )}
              {leave.approvedAt && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Reviewed At:</span>
                  <span className={styles.value}>
                    {format(new Date(leave.approvedAt), 'MMM dd, yyyy hh:mm a')}
                  </span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Submitted:</span>
                <span className={styles.value}>
                  {format(new Date(leave.createdAt), 'MMM dd, yyyy hh:mm a')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function LeaveDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <LeaveDetailPage />
    </ProtectedRoute>
  );
}
