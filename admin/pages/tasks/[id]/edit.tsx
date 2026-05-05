import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import { taskService, Task, getTaskDocumentUrl } from '../../../services/taskService';
import { clientService, Client, formatClientSelectLabel, getClientAssignedRouteId } from '../../../services/clientService';
import { routeService, Route } from '../../../services/routeService';
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

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const clientId = e.target.value;
    const client = clients.find((c) => c._id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      routeId: getClientAssignedRouteId(client),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.taskName?.trim()) {
      toast.error('Please enter Task name');
      return;
    }
    const isCompleting = formData.status === 'completed' && !task?.completedAt;
    setLoading(true);
    try {
      if (isCompleting) {
        await taskService.completeTask(id as string, {});
        toast.success('Task marked as completed');
        router.push(`/tasks/${id}`);
      } else {
        const taskData = {
          taskName: formData.taskName,
          description: formData.description || undefined,
          employeeNotes: formData.employeeNotes || undefined,
          quantity: formData.quantity || undefined,
          dealerId: formData.clientId || undefined,
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
              onChange={handleClientChange}
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
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#6b7280' }}>
              Filled automatically from the client&apos;s assigned route; you can change it or clear it.
            </p>
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
