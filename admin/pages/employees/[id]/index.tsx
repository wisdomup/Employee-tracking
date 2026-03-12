import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Table from '../../../components/UI/Table';
import { employeeService, Employee } from '../../../services/employeeService';
import { routeAssignmentService, RouteAssignment } from '../../../services/routeAssignmentService';
import { taskService, Task } from '../../../services/taskService';
import { visitService, Visit } from '../../../services/visitService';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/DetailPage.module.scss';

const EmployeeDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [assignedTasks, setAssignedTasks] = useState<Task[]>([]);
  const [assignedRoutes, setAssignedRoutes] = useState<RouteAssignment[]>([]);
  const [assignedVisits, setAssignedVisits] = useState<Visit[]>([]);
  const [visitFilterDate, setVisitFilterDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchEmployeeData();
    }
  }, [id]);

  useEffect(() => {
    if (id && visitFilterDate) {
      fetchAssignedVisits();
    }
  }, [id, visitFilterDate]);

  const fetchAssignedVisits = async () => {
    if (!id) return;
    try {
      const data = await visitService.getVisits({
        employeeId: id as string,
        startDate: visitFilterDate,
        endDate: visitFilterDate,
      });
      setAssignedVisits(Array.isArray(data) ? data : []);
    } catch {
      setAssignedVisits([]);
    }
  };

  const fetchEmployeeData = async () => {
    try {
      const [employeeData, tasksData, routesData] = await Promise.all([
        employeeService.getEmployee(id as string),
        taskService.getTasks({ assignedTo: id as string }),
        routeAssignmentService.getByEmployee(id as string),
      ]);

      setEmployee(employeeData);
      setAssignedTasks(Array.isArray(tasksData) ? tasksData : []);
      setAssignedRoutes(Array.isArray(routesData) ? routesData : []);
    } catch (error) {
      toast.error('Failed to fetch employee data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!employee) {
    return (
      <Layout>
        <div>Employee not found</div>
      </Layout>
    );
  }

  const taskColumns = [
    {
      key: 'taskName',
      title: 'Task',
      render: (value: string) => value || '-',
    },
    {
      key: 'dealerId',
      title: 'Dealer',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value as Task['status']} />,
    },
    {
      key: 'startedAt',
      title: 'Started',
      render: (value: string) =>
        value ? format(new Date(value), 'MMM dd, yyyy') : '-',
    },
    {
      key: 'completedAt',
      title: 'Completed',
      render: (value: string) =>
        value ? format(new Date(value), 'MMM dd, yyyy') : '-',
    },
  ];

  const handleTaskRowClick = (row: Task) => {
    router.push(`/tasks/${row._id}`);
  };

  const visitColumns = [
    {
      key: 'dealerId',
      title: 'Dealer',
      render: (value: any) => value?.name ?? '-',
    },
    {
      key: 'routeId',
      title: 'Route',
      render: (value: any) => value?.name ?? '-',
    },
    {
      key: 'visitDate',
      title: 'Visit date',
      render: (value: string) =>
        value ? format(new Date(value), 'MMM dd, yyyy') : '-',
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value as Visit['status']} />,
    },
  ];

  const handleVisitRowClick = (row: Visit) => {
    router.push(`/visits/${row._id}`);
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Employee Details</h1>
          <div className={styles.headerActions}>
            <button
              className={styles.editButton}
              onClick={() => router.push(`/employees/${id}/edit`)}
            >
              Edit
            </button>
            <button
              className={styles.backButton}
              onClick={() => router.push('/employees')}
            >
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          {/* Employee Information */}
          <div className={styles.section}>
            <h2>Personal Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Name:</span>
                <span className={styles.value}>{employee.username}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Phone:</span>
                <span className={styles.value}>{employee.phone}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Email:</span>
                <span className={styles.value}>{employee.email || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Role:</span>
                <span className={styles.value}>{employee.role || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Designation:</span>
                <span className={styles.value}>{employee.designation || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Salary:</span>
                <span className={styles.value}>
                  {employee.perks?.salary != null ? String(employee.perks.salary) : '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Target:</span>
                <span className={styles.value}>{employee.target || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Target Achieved:</span>
                <span className={styles.value}>{employee.achivedTarget || '-'}</span>
              </div>
              {(employee.extraNotes || employee.lastExperience) && (
                <>
                  {employee.extraNotes && (
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Extra Notes:</span>
                      <span className={styles.value}>{employee.extraNotes}</span>
                    </div>
                  )}
                  {employee.lastExperience && (
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Last Experience:</span>
                      <span className={styles.value}>{employee.lastExperience}</span>
                    </div>
                  )}
                </>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span className={styles.value}>
                  <StatusBadge status={employee.isActive ? 'active' : 'inactive'} />
                </span>
              </div>
              {employee.address && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Address:</span>
                  <span className={styles.value}>
                    {[
                      employee.address.street,
                      employee.address.city,
                      employee.address.state,
                      employee.address.country,
                    ]
                      .filter(Boolean)
                      .join(', ') || '-'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Assigned Routes */}
          <div className={styles.section}>
            <h2>Assigned Routes ({assignedRoutes.length})</h2>
            {assignedRoutes.length > 0 ? (
              <div style={{ marginTop: '1rem' }}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {assignedRoutes.map((ra) => {
                    const route = ra.routeId;
                    const routeId = route?._id || ra.routeId;
                    return (
                      <li
                        key={ra._id}
                        style={{
                          padding: '0.75rem 1rem',
                          marginBottom: '0.5rem',
                          background: '#f9fafb',
                          borderRadius: '0.5rem',
                          border: '1px solid #e5e7eb',
                          cursor: 'pointer',
                        }}
                        onClick={() => routeId && router.push(`/routes/${routeId}`)}
                      >
                        <div style={{ fontWeight: 600 }}>{route?.name || 'Route'}</div>
                        <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          {route?.startingPoint || ''} → {route?.endingPoint || ''}
                        </div>
                        {ra.assignedAt && (
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                            Assigned {format(new Date(ra.assignedAt), 'MMM dd, yyyy')}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                  Click a route to view its details
                </p>
              </div>
            ) : (
              <p style={{ color: '#6b7280', marginTop: '1rem' }}>
                No routes assigned to this employee yet. Assign routes from the Assignments page.
              </p>
            )}
          </div>

          {/* Assigned visits */}
          <div className={styles.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0 }}>Assigned visits ({assignedVisits.length})</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="visit-date-filter" style={{ fontSize: '0.875rem', color: '#6b7280' }}>Date:</label>
                <DatePickerFilter
                  id="visit-date-filter"
                  value={visitFilterDate}
                  onChange={setVisitFilterDate}
                  placeholder="Select date"
                />
              </div>
            </div>
            {assignedVisits.length > 0 ? (
              <div style={{ marginTop: '1rem' }}>
                <Table
                  columns={visitColumns}
                  data={assignedVisits}
                  loading={false}
                  onRowClick={handleVisitRowClick}
                />
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                  Click on a row to view or edit the visit
                </p>
              </div>
            ) : (
              <p style={{ color: '#6b7280', marginTop: '1rem' }}>
                No visits for the selected date.
              </p>
            )}
          </div>

          {/* Assigned Tasks */}
          <div className={styles.section}>
            <h2>Assigned Tasks ({assignedTasks.length})</h2>
            {assignedTasks.length > 0 ? (
              <div style={{ marginTop: '1rem' }}>
                <Table
                  columns={taskColumns}
                  data={assignedTasks}
                  loading={false}
                  onRowClick={handleTaskRowClick}
                />
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                  Click on any task row to view its details
                </p>
              </div>
            ) : (
              <p style={{ color: '#6b7280', marginTop: '1rem' }}>
                No tasks assigned to this employee yet.
              </p>
            )}
          </div>

          {/* Statistics */}
          <div className={styles.section}>
            <h2>Task Statistics</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Total Assigned:</span>
                <span className={styles.value}>{assignedTasks.length}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Pending:</span>
                <span className={styles.value}>
                  {assignedTasks.filter((t) => t.status === 'pending').length}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>In Progress:</span>
                <span className={styles.value}>
                  {assignedTasks.filter((t) => t.status === 'in_progress').length}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Completed:</span>
                <span className={styles.value}>
                  {assignedTasks.filter((t) => t.status === 'completed').length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function EmployeeDetailPageWrapper() {
  return (
    <ProtectedRoute>
      <EmployeeDetailPage />
    </ProtectedRoute>
  );
}
