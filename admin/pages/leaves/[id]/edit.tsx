import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import Loader from '../../../components/UI/Loader';
import { useAuth } from '../../../contexts/AuthContext';
import { leaveService, Leave } from '../../../services/leaveService';
import { toast } from 'react-toastify';
import styles from '../../../styles/FormPage.module.scss';

const EditLeavePage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [leave, setLeave] = useState<Leave | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [formData, setFormData] = useState({
    leaveType: 'full_day' as 'full_day' | 'half_day' | 'short_leave',
    leaveDate: '',
    leaveReason: '',
    status: 'pending' as 'pending' | 'approved' | 'rejected',
  });

  useEffect(() => {
    if (id) fetchLeave();
  }, [id]);

  const fetchLeave = async () => {
    try {
      const data = await leaveService.getLeave(id as string);
      setLeave(data);
      setFormData({
        leaveType: data.leaveType,
        leaveDate: data.leaveDate ? data.leaveDate.slice(0, 10) : '',
        leaveReason: data.leaveReason || '',
        status: data.status,
      });
    } catch (error) {
      toast.error('Failed to fetch leave request');
      router.push('/leaves');
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
          ? (value as 'full_day' | 'half_day' | 'short_leave')
          : name === 'status'
            ? (value as 'pending' | 'approved' | 'rejected')
            : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.leaveDate?.trim()) {
      toast.error('Please select a leave date');
      return;
    }
    setLoading(true);
    try {
      const payload: Parameters<typeof leaveService.updateLeave>[1] = {
        leaveType: formData.leaveType,
        leaveDate: formData.leaveDate,
        leaveReason: formData.leaveReason?.trim() || undefined,
      };
      if (isAdmin) payload.status = formData.status;
      await leaveService.updateLeave(id as string, payload);
      toast.success('Leave request updated successfully');
      router.push(`/leaves/${id}`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to update leave request');
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

  if (!leave) {
    return null;
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Leave</h1>
          <button className={styles.backButton} onClick={() => router.push(`/leaves/${id}`)}>
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="leaveType">Leave Type *</label>
            <select
              id="leaveType"
              name="leaveType"
              value={formData.leaveType}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="full_day">Full Day</option>
              <option value="half_day">Half Day</option>
              <option value="short_leave">Short Leave</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="leaveDate">Leave Date *</label>
            <DatePickerFilter
              id="leaveDate"
              value={formData.leaveDate}
              onChange={(value) => setFormData((prev) => ({ ...prev, leaveDate: value }))}
              placeholder="Select leave date"
              fullWidth
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="leaveReason">Reason (optional)</label>
            <textarea
              id="leaveReason"
              name="leaveReason"
              value={formData.leaveReason}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
              placeholder="Reason for leave"
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
              onClick={() => router.push(`/leaves/${id}`)}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update Leave Request'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditLeavePageWrapper() {
  return (
    <ProtectedRoute>
      <EditLeavePage />
    </ProtectedRoute>
  );
}
