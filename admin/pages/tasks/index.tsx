import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { taskService, Task } from '../../services/taskService';
import { employeeService, Employee } from '../../services/employeeService';
import { useAuth } from '../../contexts/AuthContext';
import { ALL_ROLES } from '../../utils/permissions';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';
import modalStyles from '../../styles/Modal.module.scss';

const TasksPage: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTaskId, setAssignTaskId] = useState<string | null>(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';
  const seesOnlyOwnTasks =
    !!user?.role &&
    user.role !== 'admin' &&
    ['order_taker', 'employee', 'warehouse_manager', 'delivery_man'].includes(user.role);

  useEffect(() => {
    fetchTasks();
  }, [statusFilter, user?.id]);

  useEffect(() => {
    if (!isOrderTaker) {
      fetchEmployees();
    }
  }, [isOrderTaker]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await taskService.getTasks({
        status: statusFilter || undefined,
        assignedTo: seesOnlyOwnTasks && user?.id ? user.id : undefined,
      });
      setTasks(data);
    } catch (error) {
      toast.error('Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      const data = await employeeService.getEmployees({ isActive: true });
      setEmployees(data);
    } catch {
      // non-critical
    }
  };

  const openAssignModal = (taskId: string) => {
    setAssignTaskId(taskId);
    setAssignEmployeeId('');
    setShowAssignModal(true);
  };

  const closeAssignModal = () => {
    setShowAssignModal(false);
    setAssignTaskId(null);
    setAssignEmployeeId('');
  };

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTaskId || !assignEmployeeId) {
      toast.error('Please select an employee');
      return;
    }
    setAssigning(true);
    try {
      await taskService.assignTask(assignTaskId, assignEmployeeId);
      toast.success('Task assigned successfully');
      closeAssignModal();
      fetchTasks();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to assign task');
    } finally {
      setAssigning(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await taskService.deleteTask(id);
      toast.success('Task deleted successfully');
      fetchTasks();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete task');
    }
  };

  const filteredTasks = useMemo(() => {
    const q = search.toLowerCase();
    return tasks
      .filter((task) => task.taskName.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [tasks, search]);

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (statusFilter) parts.push(`Status: ${statusFilter.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`);
    if (search) parts.push(`Search: "${search}"`);
    return parts;
  }, [statusFilter, search]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Tasks — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Tasks';

  const exportFileName = activeFilterLabels.length
    ? `tasks-${activeFilterLabels.map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase()).join('_')}`
    : 'tasks';

  const columns = [
    { key: 'taskName', title: 'Task Name' },
    {
      key: 'dealerId',
      title: 'Client',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'routeId',
      title: 'Route',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => (
        <StatusBadge status={value as Task['status']} />
      ),
    },
    {
      key: 'assignedTo',
      title: 'Assigned To',
      render: (value: any) => value?.username || '-',
    },
    {
      key: 'quantity',
      title: 'Quantity',
      render: (value: number) => value || '-',
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: Task) => (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/tasks/${row._id}`);
            }}
          >
            View
          </button>
          {!isOrderTaker && row.status !== 'in_progress' && (
            <button
              type="button"
              className={styles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                openAssignModal(row._id);
              }}
            >
              Assign
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              className={styles.deleteButton}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(row._id);
              }}
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Tasks</h1>
          {!isOrderTaker && (
            <button className={styles.addButton} onClick={() => router.push('/tasks/create')}>
              + Add Task
            </button>
          )}
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <input
                type="text"
                placeholder="Search by task name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
              <SearchableSelect
                name="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 180 }}
                placeholder="All Statuses"
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'completed', label: 'Completed' },
                ]}
              />
            </div>

            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {filteredTasks.length} record{filteredTasks.length !== 1 ? 's' : ''} — filtered by:{' '}
                {activeFilterLabels.join(' · ')}
              </p>
            )}
            <Table
              columns={columns}
              data={filteredTasks}
              loading={loading}
              onRowClick={(row) => router.push(`/tasks/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
            />
          </div>
        </div>

        {showAssignModal && (
          <div className={modalStyles.modalOverlay} onClick={closeAssignModal}>
            <div className={modalStyles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={modalStyles.modalHeader}>
                <h2>Assign Task</h2>
              </div>
              <form onSubmit={handleAssignTask}>
                <div className={modalStyles.formGroup}>
                  <label htmlFor="employeeSelect">Select Employee *</label>
                  <SearchableSelect
                    id="employeeSelect"
                    name="assignEmployeeId"
                    value={assignEmployeeId}
                    onChange={(e) => setAssignEmployeeId(e.target.value)}
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
                    onClick={closeAssignModal}
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
      </div>
    </Layout>
  );
};

export default function TasksPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <TasksPage />
    </ProtectedRoute>
  );
}
