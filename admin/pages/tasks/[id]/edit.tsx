import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import { taskService, Task, getTaskDocumentUrl } from '../../../services/taskService';
import type { CompletionImage } from '../../../services/taskService';
import { clientService, Client, formatClientSelectLabel } from '../../../services/clientService';
import { routeService, Route } from '../../../services/routeService';
import { ImageUpload } from '../../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/FormPage.module.scss';
import SearchableSelect from '../../../components/UI/SearchableSelect';

const EditTaskPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [formData, setFormData] = useState({
    taskName: '',
    description: '',
    employeeNotes: '',
    quantity: 0,
    clientId: '',
    routeId: '',
    status: 'pending' as 'pending' | 'in_progress' | 'completed',
  });
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [currentDocumentUrl, setCurrentDocumentUrl] = useState<string | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [shopImageUrl, setShopImageUrl] = useState('');
  const [selfieImageUrl, setSelfieImageUrl] = useState('');

  useEffect(() => {
    if (id) {
      fetchTask();
      fetchClients();
      fetchRoutes();
    }
  }, [id]);

  const fetchTask = async () => {
    try {
      const data: Task = await taskService.getTask(id as string);
      setTask(data);
      setFormData({
        taskName: data.taskName,
        description: data.description || '',
        employeeNotes: data.employeeNotes || '',
        quantity: data.quantity || 0,
        clientId: data.dealerId?._id || (data.dealerId as string) || '',
        routeId: data.routeId?._id || (data.routeId as string) || '',
        status: data.status,
      });
      setCurrentDocumentUrl(data.document || null);
    } catch (error) {
      toast.error('Failed to fetch task');
    } finally {
      setFetchLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const data = await clientService.getClients({ status: 'active' });
      setClients(data);
    } catch (error) {
      toast.error('Failed to fetch clients');
    }
  };

  const fetchRoutes = async () => {
    try {
      const data = await routeService.getRoutes();
      setRoutes(data);
    } catch (error) {
      toast.error('Failed to fetch routes');
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === 'quantity'
          ? parseInt(value as string) || 0
          : name === 'status'
            ? (value as 'pending' | 'in_progress' | 'completed')
            : value,
    }));
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }
    setLocationError(null);
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setLocationLoading(false);
      },
      () => {
        setLocationError('Could not get location. You can enter coordinates manually.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.taskName?.trim()) {
      toast.error('Please enter Task name');
      return;
    }
    const isCompleting = formData.status === 'completed' && !task?.completedAt;
    if (isCompleting) {
      if (latitude == null || longitude == null || !shopImageUrl || !selfieImageUrl) {
        toast.error('To mark as completed, please provide location, shop image, and selfie.');
        return;
      }
    }
    setLoading(true);
    try {
      if (isCompleting) {
        const completionImages: CompletionImage[] = [
          { type: 'shop', url: shopImageUrl },
          { type: 'selfie', url: selfieImageUrl },
        ];
        await taskService.completeTask(id as string, {
          latitude: latitude as number,
          longitude: longitude as number,
          completionImages,
        });
        toast.success('Task marked as completed');
        router.push(`/tasks/${id}`);
      } else {
        const taskData = {
          taskName: formData.taskName,
          description: formData.description || undefined,
          employeeNotes: formData.employeeNotes || undefined,
          quantity: formData.quantity || undefined,
          clientId: formData.clientId || undefined,
          routeId: formData.routeId || undefined,
          status: formData.status,
          ...(documentFile && { document: documentFile }),
        };
        await taskService.updateTask(id as string, taskData);
        toast.success('Task updated successfully');
        router.push(`/tasks/${id}`);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to update task');
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
          <h1>Edit Task</h1>
          <button
            className={styles.backButton}
            onClick={() => router.push(`/tasks/${id}`)}
          >
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="taskName">Task Name *</label>
            <input
              type="text"
              id="taskName"
              name="taskName"
              value={formData.taskName}
              onChange={handleChange}
              required
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="clientId">Client (optional)</label>
            <SearchableSelect
              id="clientId"
              name="clientId"
              value={formData.clientId}
              onChange={handleChange}
              className={styles.select}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...clients.map((client) => ({
                  value: client._id,
                  label: formatClientSelectLabel(client),
                })),
              ]}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="routeId">Route (optional)</label>
            <SearchableSelect
              id="routeId"
              name="routeId"
              value={formData.routeId}
              onChange={handleChange}
              className={styles.select}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...routes.map((route) => ({
                  value: route._id,
                  label: `${route.name} (${route.startingPoint} → ${route.endingPoint})`,
                })),
              ]}
            />
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

          <div className={styles.formGroup}>
            <label htmlFor="employeeNotes">Employee notes</label>
            <textarea
              id="employeeNotes"
              name="employeeNotes"
              value={formData.employeeNotes}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
              placeholder="Optional notes for the employee"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="quantity">Quantity</label>
            <input
              type="number"
              id="quantity"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              className={styles.input}
              min={0}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Document (optional)</label>
            {currentDocumentUrl && (
              <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                Current:{' '}
                <a
                  href={getTaskDocumentUrl(currentDocumentUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View / download
                </a>
              </p>
            )}
            <input
              type="file"
              id="document"
              accept=".pdf,.doc,.docx,image/*"
              onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
              className={styles.input}
            />
            {documentFile && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                New file: {documentFile.name} (will replace current document)
              </p>
            )}
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="status">Status</label>
            <SearchableSelect
              id="status"
              name="status"
              value={formData.status}
              onChange={handleChange}
              className={styles.select}
              placeholder="Status"
              options={[
                { value: 'pending', label: 'Pending' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'completed', label: 'Completed' },
              ]}
            />
          </div>

          {formData.status === 'completed' && !task?.completedAt && (
            <>
              <div className={styles.formGroup}>
                <label>Completion details</label>
                <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  To mark this task as completed, provide your current location, a shop image, and a selfie.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    className={styles.submitButton}
                    onClick={handleGetLocation}
                    disabled={locationLoading}
                  >
                    {locationLoading ? 'Getting location…' : 'Get my location'}
                  </button>
                  {latitude != null && longitude != null && (
                    <span style={{ fontSize: '0.875rem' }}>
                      Lat: {latitude.toFixed(6)}, Lng: {longitude.toFixed(6)}
                    </span>
                  )}
                </div>
                {locationError && (
                  <span style={{ fontSize: '0.875rem', color: '#dc2626', display: 'block', marginBottom: '0.5rem' }}>
                    {locationError}
                  </span>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={latitude ?? ''}
                    onChange={(e) => setLatitude(e.target.value ? Number(e.target.value) : null)}
                    className={styles.input}
                    style={{ maxWidth: 140 }}
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={longitude ?? ''}
                    onChange={(e) => setLongitude(e.target.value ? Number(e.target.value) : null)}
                    className={styles.input}
                    style={{ maxWidth: 140 }}
                  />
                </div>
              </div>
              <div className={styles.formGroup}>
                <ImageUpload
                  label="Shop image"
                  category="completions"
                  value={shopImageUrl}
                  onChange={setShopImageUrl}
                />
              </div>
              <div className={styles.formGroup}>
                <ImageUpload
                  label="Selfie (employee)"
                  category="completions"
                  value={selfieImageUrl}
                  onChange={setSelfieImageUrl}
                />
              </div>
            </>
          )}

          {formData.status === 'completed' && task?.completedAt && (
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              This task is already completed. You can change other fields above and save.
            </p>
          )}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push(`/tasks/${id}`)}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update Task'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditTaskPageWrapper() {
  return (
    <ProtectedRoute>
      <EditTaskPage />
    </ProtectedRoute>
  );
}
