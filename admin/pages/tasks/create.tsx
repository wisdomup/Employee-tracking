import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { taskService } from '../../services/taskService';
import { clientService, Client, formatClientSelectLabel, getClientAssignedRouteId } from '../../services/clientService';
import { routeService, Route } from '../../services/routeService';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';

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
    const isCompleting = formData.status === 'completed';
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
        await taskService.completeTask(newId, {});
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
            <SearchableSelect
              id="clientId"
              name="clientId"
              value={formData.clientId}
              onChange={handleClientChange}
              className={styles.select}
              placeholder="Select a client"
              options={[
                { value: '', label: 'Select a client' },
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
              placeholder="Select a route"
              options={[
                { value: '', label: 'Select a route' },
                ...routes.map((route) => ({
                  value: route._id,
                  label: `${route.name} (${route.startingPoint} → ${route.endingPoint})`,
                })),
              ]}
            />
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
