import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import Loader from '../../../components/UI/Loader';
import { useAuth } from '../../../contexts/AuthContext';
import {
  approvalService,
  Approval,
  ApprovalType,
  APPROVAL_TYPE_LABELS,
  LeaveDurationType,
} from '../../../services/approvalService';
import { toast } from 'react-toastify';
import { getApiErrorMessage } from '../../../utils/apiError';
import styles from '../../../styles/FormPage.module.scss';

const EditApprovalPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';
  const [row, setRow] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [formData, setFormData] = useState({
    approvalType: 'leave' as ApprovalType,
    leaveType: 'full_day' as LeaveDurationType,
    leaveDate: '',
    leaveReason: '',
    status: 'pending' as 'pending' | 'approved' | 'rejected',
  });

  useEffect(() => {
    if (!id) return;
    fetchApproval();
  }, [id, user?.id, isOrderTaker]);

  const fetchApproval = async () => {
    try {
      const data = await approvalService.getApproval(id as string);
      if (isOrderTaker && user?.id) {
        const ownerId =
          typeof data.employeeId === 'string'
            ? data.employeeId
            : (data.employeeId as { _id?: string })?._id ?? '';
        if (ownerId !== user.id || data.status !== 'pending') {
          toast.error('You can only edit your own pending approvals');
          router.push('/approvals');
          return;
        }
      }
      setRow(data);
      const at = data.approvalType ?? 'leave';
      setFormData({
        approvalType: at,
        leaveType: data.leaveType ?? 'full_day',
        leaveDate: data.leaveDate ? data.leaveDate.slice(0, 10) : '',
        leaveReason: data.leaveReason || '',
        status: data.status,
      });
    } catch {
      toast.error('Failed to fetch approval');
      router.push('/approvals');
    } finally {
      setFetchLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === 'leaveType'
          ? (value as LeaveDurationType)
          : name === 'status'
            ? (value as 'pending' | 'approved' | 'rejected')
            : name === 'approvalType'
              ? (value as ApprovalType)
              : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.leaveDate?.trim()) {
      toast.error('Please select a date');
      return;
    }
    if (formData.approvalType !== 'leave' && !formData.leaveReason?.trim()) {
      toast.error('Please enter details for this approval type');
      return;
    }
    setLoading(true);
    try {
      const payload: Parameters<typeof approvalService.updateApproval>[1] = {
        approvalType: formData.approvalType,
        leaveDate: formData.leaveDate,
        leaveReason: formData.leaveReason?.trim() || undefined,
      };
      if (formData.approvalType === 'leave') {
        payload.leaveType = formData.leaveType;
      }
      if (isAdmin) payload.status = formData.status;
      await approvalService.updateApproval(id as string, payload);
      toast.success('Approval updated successfully');
      router.push(`/approvals/${id}`);
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, 'Failed to update approval'));
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!row) {
    return null;
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit approval</h1>
          <button className={styles.backButton} onClick={() => router.push(`/approvals/${id}`)}>
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="approvalType">Approval type *</label>
            <select
              id="approvalType"
              name="approvalType"
              value={formData.approvalType}
              onChange={handleChange}
              className={styles.select}
            >
              {(Object.keys(APPROVAL_TYPE_LABELS) as ApprovalType[]).map((t) => (
                <option key={t} value={t}>
                  {APPROVAL_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {formData.approvalType === 'leave' && (
            <div className={styles.formGroup}>
              <label htmlFor="leaveType">Duration *</label>
              <select
                id="leaveType"
                name="leaveType"
                value={formData.leaveType}
                onChange={handleChange}
                required
                className={styles.select}
              >
                <option value="full_day">Full day</option>
                <option value="half_day">Half day</option>
                <option value="short_leave">Short leave</option>
              </select>
            </div>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="leaveDate">Date *</label>
            <DatePickerFilter
              id="leaveDate"
              value={formData.leaveDate}
              onChange={(value) => setFormData((prev) => ({ ...prev, leaveDate: value }))}
              placeholder="Select date"
              fullWidth
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="leaveReason">
              {formData.approvalType === 'leave' ? 'Reason (optional)' : 'Details *'}
            </label>
            <textarea
              id="leaveReason"
              name="leaveReason"
              value={formData.leaveReason}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
              placeholder={
                formData.approvalType === 'leave'
                  ? 'Reason (for leave-type requests)'
                  : 'Describe this approval request'
              }
              required={formData.approvalType !== 'leave'}
            />
          </div>

          {isAdmin && (
            <div className={styles.formGroup}>
              <label htmlFor="status">Status</label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                className={styles.select}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <small style={{ color: '#6b7280', fontSize: '0.875rem', display: 'block', marginTop: '0.25rem' }}>
                Approved/rejected will record you as the reviewer.
              </small>
            </div>
          )}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push(`/approvals/${id}`)}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update approval'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditApprovalPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <EditApprovalPage />
    </ProtectedRoute>
  );
}
