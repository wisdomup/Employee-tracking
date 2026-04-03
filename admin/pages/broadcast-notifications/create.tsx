import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import BroadcastAudienceFields from '../../components/Broadcast/BroadcastAudienceFields';
import { broadcastNotificationService, BroadcastAudienceType } from '../../services/broadcastNotificationService';
import { employeeService, Employee } from '../../services/employeeService';
import { toast } from 'react-toastify';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import styles from '../../styles/FormPage.module.scss';

const CreateBroadcastNotificationPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
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
      await broadcastNotificationService.createNotification({
        title: formData.title,
        description: formData.description || undefined,
        audienceType: formData.audienceType,
        targetUserIds:
          formData.audienceType === 'specific_users' ? formData.targetUserIds : undefined,
        startAt: formData.startAt || undefined,
        endAt: formData.endAt || undefined,
      });
      toast.success('Notification created successfully');
      router.push('/broadcast-notifications');
    } catch (error: unknown) {
      const msg =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(msg || 'Failed to create notification');
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
              placeholder="Notification title"
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
