import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import {
  broadcastNotificationService,
  BroadcastTarget,
} from '../../services/broadcastNotificationService';
import { toast } from 'react-toastify';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import styles from '../../styles/FormPage.module.scss';

const CreateBroadcastNotificationPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    broadcastTo: 'all' as BroadcastTarget,
    startAt: '',
    endAt: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title?.trim()) {
      toast.error('Please enter Title');
      return;
    }
    if (!formData.broadcastTo) {
      toast.error('Please select Broadcast To');
      return;
    }
    setLoading(true);
    try {
      await broadcastNotificationService.createNotification({
        title: formData.title,
        description: formData.description || undefined,
        broadcastTo: formData.broadcastTo,
        startAt: formData.startAt || undefined,
        endAt: formData.endAt || undefined,
      });
      toast.success('Notification created successfully');
      router.push('/broadcast-notifications');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create notification');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>New Broadcast Notification</h1>
          <button
            className={styles.backButton}
            onClick={() => router.push('/broadcast-notifications')}
          >
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="title">Title *</label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
              className={styles.input}
              placeholder="Notification title"
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="broadcastTo">Broadcast To *</label>
            <select
              id="broadcastTo"
              name="broadcastTo"
              value={formData.broadcastTo}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="all">All</option>
              <option value="employees">Employees</option>
              <option value="clients">Clients</option>
              <option value="customers">Customers</option>
            </select>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              className={styles.textarea}
              rows={4}
              placeholder="Notification message body"
            />
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="startAt">Start Date</label>
              <DatePickerFilter
                id="startAt"
                value={formData.startAt}
                onChange={(value) => setFormData((prev) => ({ ...prev, startAt: value }))}
                placeholder="Select start date"
                title="Start Date"
                fullWidth
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="endAt">End Date</label>
              <DatePickerFilter
                id="endAt"
                value={formData.endAt}
                onChange={(value) => setFormData((prev) => ({ ...prev, endAt: value }))}
                placeholder="Select end date"
                title="End Date"
                fullWidth
              />
            </div>
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/broadcast-notifications')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Creating...' : 'Create Notification'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateBroadcastNotificationPageWrapper() {
  return (
    <ProtectedRoute>
      <CreateBroadcastNotificationPage />
    </ProtectedRoute>
  );
}
