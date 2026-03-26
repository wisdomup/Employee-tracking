import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { taskService } from '../../services/taskService';
import type { CompletionImage } from '../../services/taskService';
import { clientService, Client } from '../../services/clientService';
import { routeService, Route } from '../../services/routeService';
import { ImageUpload } from '../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';

const CreateTaskPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
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
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [shopImageUrl, setShopImageUrl] = useState('');
  const [selfieImageUrl, setSelfieImageUrl] = useState('');

  useEffect(() => {
    fetchClients();
    fetchRoutes();
  }, []);

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
    const isCompleting = formData.status === 'completed';
    if (isCompleting) {
      if (latitude == null || longitude == null || !shopImageUrl || !selfieImageUrl) {
        toast.error('To mark as completed, please provide location, shop image, and selfie.');
        return;
      }
    }
    setLoading(true);
    try {
      const taskData = {
        taskName: formData.taskName,
        description: formData.description || undefined,
        employeeNotes: formData.employeeNotes || undefined,
        quantity: formData.quantity || undefined,
        clientId: formData.clientId || undefined,
        routeId: formData.routeId || undefined,
        ...(documentFile && { document: documentFile }),
      };
      if (isCompleting) {
        const created = await taskService.createTask(taskData);
        const newId = (created as { _id: string })._id;
        const completionImages: CompletionImage[] = [
          { type: 'shop', url: shopImageUrl },
          { type: 'selfie', url: selfieImageUrl },
        ];
        await taskService.completeTask(newId, {
          latitude: latitude as number,
          longitude: longitude as number,
          completionImages,
        });
        toast.success('Task created and marked as completed');
        router.push(`/tasks/${newId}`);
      } else {
        await taskService.createTask(taskData);
        toast.success('Task created successfully');
        router.push('/tasks');
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Create Task</h1>
          <button className={styles.backButton} onClick={() => router.push('/tasks')}>
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
            <select
              id="clientId"
              name="clientId"
              value={formData.clientId}
              onChange={handleChange}
              className={styles.select}
            >
              <option value="">Select a client</option>
              {clients.map((client) => (
                <option key={client._id} value={client._id}>
                  {client.name} - {client.phone}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="routeId">Route (optional)</label>
            <select
              id="routeId"
              name="routeId"
              value={formData.routeId}
              onChange={handleChange}
              className={styles.select}
            >
              <option value="">Select a route</option>
              {routes.map((route) => (
                <option key={route._id} value={route._id}>
                  {route.name} ({route.startingPoint} → {route.endingPoint})
                </option>
              ))}
            </select>
            <small style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              Assign a specific employee to this task from the task detail page.
            </small>
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
            <label htmlFor="document">Document (optional)</label>
            <input
              type="file"
              id="document"
              accept=".pdf,.doc,.docx,image/*"
              onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
              className={styles.input}
            />
            {documentFile && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                Selected: {documentFile.name} (PDF, Word, or image)
              </p>
            )}
          </div>

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
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {formData.status === 'completed' && (
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

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/tasks')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateTaskPageWrapper() {
  return (
    <ProtectedRoute>
      <CreateTaskPage />
    </ProtectedRoute>
  );
}
