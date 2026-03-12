import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import { leaveService } from '../../services/leaveService';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';

const CreateLeavePage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    leaveType: 'full_day' as 'full_day' | 'half_day' | 'short_leave',
    leaveDate: '',
    leaveReason: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'leaveType' ? (value as 'full_day' | 'half_day' | 'short_leave') : value,
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
      await leaveService.createLeave({
        leaveType: formData.leaveType,
        leaveDate: formData.leaveDate,
        leaveReason: formData.leaveReason?.trim() || undefined,
      });
      toast.success('Leave request submitted successfully');
      router.push('/leaves');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to submit leave request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Add Leave</h1>
          <button className={styles.backButton} onClick={() => router.push('/leaves')}>
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

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/leaves')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateLeavePageWrapper() {
  return (
    <ProtectedRoute>
      <CreateLeavePage />
    </ProtectedRoute>
  );
}
