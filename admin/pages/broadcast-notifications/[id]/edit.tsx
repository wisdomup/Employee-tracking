import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import {
  broadcastNotificationService,
  BroadcastNotification,
  BroadcastTarget,
} from '../../../services/broadcastNotificationService';
import { toast } from 'react-toastify';
import Loader from '../../../components/UI/Loader';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import styles from '../../../styles/FormPage.module.scss';

const EditBroadcastNotificationPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    broadcastTo: 'all' as BroadcastTarget,
    startAt: '',
    endAt: '',
  });

  useEffect(() => {
    if (id) fetchNotification();
  }, [id]);

  const fetchNotification = async () => {
    try {
      const data: BroadcastNotification = await broadcastNotificationService.getNotification(
        id as string,
      );
      setFormData({
        title: data.title,
        description: data.description || '',
        broadcastTo: data.broadcastTo,
        startAt: data.startAt ? data.startAt.slice(0, 10) : '',
        endAt: data.endAt ? data.endAt.slice(0, 10) : '',
      });
    } catch (error) {
      toast.error('Failed to fetch notification');
    } finally {
      setFetchLoading(false);
    }
  };

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
      await broadcastNotificationService.updateNotification(id as string, {
        title: formData.title,
        description: formData.description || undefined,
        broadcastTo: formData.broadcastTo,
        startAt: formData.startAt || undefined,
        endAt: formData.endAt || undefined,
      });
      toast.success('Notification updated successfully');
      router.push('/broadcast-notifications');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update notification');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Notification</h1>
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
              <option value="dealers">Dealers</option>
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
              {loading ? 'Updating...' : 'Update Notification'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditBroadcastNotificationPageWrapper() {
  return (
    <ProtectedRoute>
      <EditBroadcastNotificationPage />
    </ProtectedRoute>
  );
}
