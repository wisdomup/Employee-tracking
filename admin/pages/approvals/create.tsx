import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import {
  approvalService,
  ApprovalType,
  APPROVAL_TYPE_LABELS,
  LeaveDurationType,
} from '../../services/approvalService';
import { toast } from 'react-toastify';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/FormPage.module.scss';

const CreateApprovalPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    approvalType: 'leave' as ApprovalType,
    leaveType: 'full_day' as LeaveDurationType,
    leaveDate: '',
    leaveReason: '',
  });

  const handleApprovalTypeChange = (value: ApprovalType) => {
    setFormData((prev) => ({
      ...prev,
      approvalType: value,
      leaveReason: value === 'leave' ? prev.leaveReason : prev.leaveReason,
    }));
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    if (name === 'approvalType') {
      handleApprovalTypeChange(value as ApprovalType);
      return;
    }
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'leaveType' ? (value as LeaveDurationType) : value,
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
      await approvalService.createApproval({
        approvalType: formData.approvalType,
        leaveType: formData.approvalType === 'leave' ? formData.leaveType : undefined,
        leaveDate: formData.leaveDate,
        leaveReason: formData.leaveReason?.trim() || undefined,
      });
      toast.success('Approval submitted successfully');
      router.push('/approvals');
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, 'Failed to submit approval'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>New approval</h1>
          <button className={styles.backButton} onClick={() => router.push('/approvals')}>
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
                  ? 'Reason (optional for leave)'
                  : 'Describe this approval request'
              }
              required={formData.approvalType !== 'leave'}
            />
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/approvals')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Submitting...' : 'Submit approval'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateApprovalPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <CreateApprovalPage />
    </ProtectedRoute>
  );
}
