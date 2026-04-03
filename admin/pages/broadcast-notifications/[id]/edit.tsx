import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import BroadcastAudienceFields from '../../../components/Broadcast/BroadcastAudienceFields';
import {
  broadcastNotificationService,
  BroadcastNotification,
  BroadcastAudienceType,
  audienceTypeFromApi,
} from '../../../services/broadcastNotificationService';
import { employeeService, Employee } from '../../../services/employeeService';
import { toast } from 'react-toastify';
import Loader from '../../../components/UI/Loader';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import styles from '../../../styles/FormPage.module.scss';

const EditBroadcastNotificationPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [employeeOptions, setEmployeeOptions] = useState<{ _id: string; username: string }[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    audienceType: 'all' as BroadcastAudienceType,
    targetUserIds: [] as string[],
    startAt: '',
    endAt: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const list: Employee[] = await employeeService.getEmployees({ isActive: true });
        setEmployeeOptions(
          list.filter((u) => u.role !== 'admin').map((u) => ({ _id: u._id, username: u.username })),
        );
      } catch {
        toast.error('Could not load employees for audience picker');
      }
    })();
  }, []);

  useEffect(() => {
    if (id) fetchNotification();
  }, [id]);

  const fetchNotification = async () => {
    try {
      const data: BroadcastNotification = await broadcastNotificationService.getNotification(
        id as string,
      );
      const at = audienceTypeFromApi(data);
      const targets = (data.targetUserIds || []).map(String);
      setFormData({
        title: data.title,
        description: data.description || '',
        audienceType: at,
        targetUserIds: at === 'specific_users' ? targets : [],
        startAt: data.startAt ? data.startAt.slice(0, 10) : '',
        endAt: data.endAt ? data.endAt.slice(0, 10) : '',
      });
    } catch {
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
    if (formData.audienceType === 'specific_users' && formData.targetUserIds.length === 0) {
      toast.error('Select at least one employee');
      return;
    }
    setLoading(true);
    try {
      await broadcastNotificationService.updateNotification(id as string, {
        title: formData.title,
        description: formData.description || undefined,
        audienceType: formData.audienceType,
        targetUserIds:
          formData.audienceType === 'specific_users' ? formData.targetUserIds : undefined,
        startAt: formData.startAt || undefined,
        endAt: formData.endAt || undefined,
      });
      toast.success('Notification updated successfully');
      router.push('/broadcast-notifications');
    } catch (error: unknown) {
      const msg =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg || 'Failed to update notification');
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

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Notification</h1>
          <button
            type="button"
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
          <BroadcastAudienceFields
            audienceType={formData.audienceType}
            targetUserIds={formData.targetUserIds}
            onAudienceTypeChange={(audienceType) =>
              setFormData((prev) => ({ ...prev, audienceType }))
            }
            onTargetUserIdsChange={(targetUserIds) => setFormData((prev) => ({ ...prev, targetUserIds }))}
            employeeOptions={employeeOptions}
          />
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
