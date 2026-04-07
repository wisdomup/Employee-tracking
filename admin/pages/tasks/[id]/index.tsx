import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import MapView from '../../../components/Map/MapView';
import ImageModal from '../../../components/UI/ImageModal';
import Loader from '../../../components/UI/Loader';
import { taskService, Task, getTaskDocumentUrl, getTaskCompletionImageUrl } from '../../../services/taskService';
import { employeeService, Employee } from '../../../services/employeeService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';
import modalStyles from '../../../styles/Modal.module.scss';
import SearchableSelect from '../../../components/UI/SearchableSelect';

const TaskDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const { user } = useAuth();
  const isOrderTaker = user?.role === 'order_taker';
  const isAdmin = user?.role === 'admin';
  const assignedToId = typeof task?.assignedTo === 'object' ? task?.assignedTo?._id : task?.assignedTo;
  const isAssignedToMe = assignedToId === user?.id;

  useEffect(() => {
    if (id) {
      fetchTask();
      if (!isOrderTaker) fetchEmployees();
    }
  }, [id]);

  const fetchTask = async () => {
    try {
      const data = await taskService.getTask(id as string);
      setTask(data);
    } catch (error) {
      toast.error('Failed to fetch task');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const data = await employeeService.getEmployees();
      setEmployees(data);
    } catch (error) {
      // non-critical
    }
  };

  const handleStartTask = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setActionLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await taskService.startTask(id as string, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          toast.success('Task started successfully');
          fetchTask();
        } catch (error: any) {
          toast.error(error.response?.data?.message || 'Failed to start task');
        } finally {
          setActionLoading(false);
        }
      },
      () => {
        toast.error('Could not get your location. Please enable location access.');
        setActionLoading(false);
      },
    );
  };

  const handleCompleteTask = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setActionLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await taskService.completeTask(id as string, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            completionImages: [],
          });
          toast.success('Task completed successfully');
          fetchTask();
        } catch (error: any) {
          toast.error(error.response?.data?.message || 'Failed to complete task');
        } finally {
          setActionLoading(false);
        }
      },
      () => {
        toast.error('Could not get your location. Please enable location access.');
        setActionLoading(false);
      },
    );
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }
    setAssigning(true);
    try {
      await taskService.assignTask(id as string, selectedEmployee);
      toast.success('Task assigned successfully');
      setShowAssignModal(false);
      setSelectedEmployee('');
      fetchTask();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to assign task');
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!task) {
    return (
      <Layout>
        <div>Task not found</div>
      </Layout>
    );
  }

  const client = task.dealerId;
  const markers: { lat: number; lng: number; type: 'client' | 'completion'; label: string }[] = [];

  if (client?.latitude && client?.longitude) {
    markers.push({
      lat: client.latitude,
      lng: client.longitude,
      type: 'client',
      label: `Client: ${client.name}`,
    });
  }
  if (task.status === 'completed' && task.latitude && task.longitude) {
    markers.push({
      lat: task.latitude,
      lng: task.longitude,
      type: 'completion',
      label: `Completed by: ${task.assignedTo?.username || 'Employee'}`,
    });
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Task Details</h1>
          <div className={styles.headerActions}>
            {isOrderTaker && isAssignedToMe && task?.status === 'pending' && (
              <button
                className={styles.editButton}
                onClick={handleStartTask}
                disabled={actionLoading}
              >
                {actionLoading ? 'Starting...' : 'Start Task'}
              </button>
            )}
            {isOrderTaker && isAssignedToMe && task?.status === 'in_progress' && (
              <button
                className={styles.editButton}
                onClick={handleCompleteTask}
                disabled={actionLoading}
                style={{ backgroundColor: '#16a34a', color: '#fff' }}
              >
                {actionLoading ? 'Completing...' : 'Complete Task'}
              </button>
            )}
            {!isOrderTaker && (
              <button
                className={styles.editButton}
                onClick={() => router.push(`/tasks/${id}/edit`)}
              >
                Edit
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/tasks')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          {/* Task Information */}
          <div className={styles.section}>
            <h2>Task Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Task Name:</span>
                <span className={styles.value}>{task.taskName}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span className={styles.value}>
                  <StatusBadge status={task.status} />
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Description:</span>
                <span className={styles.value}>{task.description || '-'}</span>
              </div>
              {task.employeeNotes && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Employee notes:</span>
                  <span className={styles.value}>{task.employeeNotes}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Quantity:</span>
                <span className={styles.value}>{task.quantity ?? '-'}</span>
              </div>
              {task.document && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Document:</span>
                  <span className={styles.value}>
                    <a
                      href={getTaskDocumentUrl(task.document)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View / download
                    </a>
                  </span>
                </div>
              )}
              {task.routeId && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Route:</span>
                  <span className={styles.value}>
                    {task.routeId?.name
                      ? `${task.routeId.name} (${task.routeId.startingPoint} → ${task.routeId.endingPoint})`
                      : '-'}
                  </span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Created By:</span>
                <span className={styles.value}>{task.createdBy?.username || '-'}</span>
              </div>
            </div>
            {task.referenceImage && (
              <div style={{ marginTop: '1rem' }}>
                <span className={styles.label}>Reference Image:</span>
                <img
                  src={task.referenceImage}
                  alt="Reference"
                  style={{ maxWidth: '300px', marginTop: '0.5rem', borderRadius: '0.5rem' }}
                />
              </div>
            )}
          </div>

          {/* Client Information */}
          {client && (
            <div className={styles.section}>
              <h2>Client Information</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Client Name:</span>
                  <span className={styles.value}>{client.name}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Phone:</span>
                  <span className={styles.value}>{client.phone}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Email:</span>
                  <span className={styles.value}>{client.email || '-'}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Address:</span>
                  <span className={styles.value}>
                    {client.address
                      ? `${client.address.street || ''} ${client.address.city || ''} ${client.address.state || ''}`
                          .trim() || '-'
                      : '-'}
                  </span>
                </div>
              </div>
              {client.latitude && client.longitude && (
                <div style={{ marginTop: '1rem' }}>
                  <MapView
                    markers={[{ lat: client.latitude, lng: client.longitude, type: 'client', label: client.name }]}
                    height="300px"
                  />
                </div>
              )}
            </div>
          )}

          {/* Assignment Details */}
          <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>Assignment Details</h2>
              {!isOrderTaker && task.status !== 'in_progress' && (
                <button
                  className={styles.editButton}
                  onClick={() => setShowAssignModal(true)}
                >
                  {task.assignedTo ? 'Reassign Task' : 'Assign Task'}
                </button>
              )}
            </div>

            {task.assignedTo ? (
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Assigned To:</span>
                  <span className={styles.value}>{task.assignedTo?.username || '-'}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Employee Phone:</span>
                  <span className={styles.value}>{task.assignedTo?.phone || '-'}</span>
                </div>
                {task.assignedBy && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Assigned By:</span>
                    <span className={styles.value}>{task.assignedBy?.username || '-'}</span>
                  </div>
                )}
                {task.startedAt && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Started At:</span>
                    <span className={styles.value}>
                      {format(new Date(task.startedAt), 'MMM dd, yyyy hh:mm a')}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ color: '#6b7280' }}>This task has not been assigned yet.</p>
            )}

            {/* Completion Details */}
            {task.status === 'completed' && task.completedAt && (
              <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
                  Completion Information
                </h3>
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <span className={styles.label} style={{ color: '#374151' }}>Completed At:</span>
                    <span className={styles.value}>
                      {format(new Date(task.completedAt), 'MMM dd, yyyy hh:mm a')}
                    </span>
                  </div>
                  {task.latitude && task.longitude && (
                    <>
                      <div className={styles.infoItem}>
                        <span className={styles.label} style={{ color: '#374151' }}>GPS Location:</span>
                        <span className={styles.value}>
                          Lat: {task.latitude.toFixed(6)}, Lng: {task.longitude.toFixed(6)}
                        </span>
                      </div>
                      {task.distanceFromClient !== undefined && (
                        <div className={styles.infoItem}>
                          <span className={styles.label} style={{ color: '#374151' }}>Distance from Client:</span>
                          <span className={styles.value}>
                            {task.distanceFromClient.toFixed(2)} meters
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {task.completionImages && task.completionImages.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <span className={styles.label} style={{ color: '#374151', display: 'block', marginBottom: '0.5rem' }}>Completion Images:</span>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {task.completionImages.map((img, idx) => (
                        <div key={idx} style={{ position: 'relative' }}>
                          <img
                            src={getTaskCompletionImageUrl(img.url)}
                            alt={img.type}
                            style={{
                              width: '150px',
                              height: '150px',
                              objectFit: 'cover',
                              borderRadius: '0.5rem',
                              cursor: 'pointer',
                              border: '2px solid #e5e7eb',
                            }}
                            onClick={() => setShowImageModal(true)}
                          />
                          <span
                            style={{
                              position: 'absolute',
                              bottom: '0.5rem',
                              left: '0.5rem',
                              background: 'rgba(0,0,0,0.7)',
                              color: 'white',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '0.25rem',
                              fontSize: '0.75rem',
                              textTransform: 'capitalize',
                            }}
                          >
                            {img.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {task.latitude && task.longitude && markers.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <span className={styles.label} style={{ color: '#374151', display: 'block', marginBottom: '0.5rem' }}>Completion Location Map:</span>
                    <div style={{ marginTop: '0.5rem' }}>
                      <MapView markers={markers} height="400px" />
                    </div>
                    {markers.length > 1 && (
                      <p style={{ fontSize: '0.875rem', color: '#374151', marginTop: '0.5rem' }}>
                        Blue marker: Client location | Green marker: Completion location
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Assign Task Modal */}
        {showAssignModal && (
          <div className={modalStyles.modalOverlay} onClick={() => setShowAssignModal(false)}>
            <div className={modalStyles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={modalStyles.modalHeader}>
                <h2>{task.assignedTo ? 'Reassign Task' : 'Assign Task'}</h2>
              </div>
              <form onSubmit={handleAssign}>
                <div className={modalStyles.formGroup}>
                  <label htmlFor="employeeSelect">Select Employee *</label>
                  <SearchableSelect
                    id="employeeSelect"
                    name="selectedEmployee"
                    value={selectedEmployee}
                    onChange={(e) => setSelectedEmployee(e.target.value)}
                    placeholder="Select an employee"
                    options={[
                      { value: '', label: 'Select an employee' },
                      ...employees.map((emp) => ({
                        value: emp._id,
                        label: `${emp.username} — ${emp.role} — ${emp.phone}`,
                      })),
                    ]}
                  />
                </div>
                <div className={modalStyles.modalActions}>
                  <button
                    type="button"
                    className={modalStyles.cancelButton}
                    onClick={() => setShowAssignModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={modalStyles.submitButton}
                    disabled={assigning}
                  >
                    {assigning ? 'Assigning...' : 'Assign'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {task.completionImages && task.completionImages.length > 0 && (
          <ImageModal
            images={task.completionImages.map((img) => ({
              ...img,
              url: getTaskCompletionImageUrl(img.url),
            }))}
            isOpen={showImageModal}
            onClose={() => setShowImageModal(false)}
          />
        )}
      </div>
    </Layout>
  );
};

export default function TaskDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <TaskDetailPage />
    </ProtectedRoute>
  );
}
