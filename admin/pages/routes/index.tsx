import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { routeService, Route } from '../../services/routeService';
import { routeAssignmentService } from '../../services/routeAssignmentService';
import { employeeService, Employee } from '../../services/employeeService';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';
import modalStyles from '../../styles/Modal.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';

const RoutesPage: React.FC = () => {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignRouteId, setAssignRouteId] = useState<string | null>(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [orderTakers, setOrderTakers] = useState<Employee[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetchRoutes();
  }, []);

  useEffect(() => {
    fetchOrderTakers();
  }, []);

  const fetchRoutes = async () => {
    try {
      const data = await routeService.getRoutes();
      setRoutes(data);
    } catch (error) {
      toast.error('Failed to fetch routes');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderTakers = async () => {
    try {
      const data = await employeeService.getEmployees({ role: 'order_taker' });
      setOrderTakers(data);
    } catch {
      // non-critical
    }
  };

  const openAssignModal = (routeId: string) => {
    setAssignRouteId(routeId);
    setAssignEmployeeId('');
    setShowAssignModal(true);
  };

  const closeAssignModal = () => {
    setShowAssignModal(false);
    setAssignRouteId(null);
    setAssignEmployeeId('');
  };

  const handleAssignRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignRouteId || !assignEmployeeId) {
      toast.error('Please select an employee');
      return;
    }
    setAssigning(true);
    try {
      await routeAssignmentService.assignRouteToEmployee(assignRouteId, assignEmployeeId);
      toast.success('Route assigned successfully');
      closeAssignModal();
      fetchRoutes();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to assign route');
    } finally {
      setAssigning(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this route?')) {
      return;
    }
    try {
      await routeService.deleteRoute(id);
      toast.success('Route deleted successfully');
      fetchRoutes();
    } catch (error) {
      toast.error('Failed to delete route');
    }
  };

  const filteredRoutes = routes.filter(
    (route) =>
      route.name.toLowerCase().includes(search.toLowerCase()) ||
      route.startingPoint.toLowerCase().includes(search.toLowerCase()) ||
      route.endingPoint.toLowerCase().includes(search.toLowerCase()),
  );

  const columns = [
    {
      key: 'name',
      title: 'Route Name',
    },
    {
      key: 'startingPoint',
      title: 'Start',
    },
    {
      key: 'endingPoint',
      title: 'End',
    },
    {
      key: 'assignedEmployee',
      title: 'Assigned To',
      render: (value: Route['assignedEmployee']) => {
        if (!value || typeof value !== 'object') return '-';
        const name = value.username ?? value.userID ?? (value as { name?: string }).name;
        return name && String(name).trim() ? String(name) : '-';
      },
    },
    {
      key: 'createdBy',
      title: 'Created By',
      render: (value: any) =>
        value ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}` : '-',
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: Route) => (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/routes/${row._id}`);
            }}
          >
            View
          </button>
          <button
            type="button"
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/routes/${row._id}/edit`);
            }}
          >
            Edit
          </button>
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
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Routes</h1>
          <button
            className={styles.addButton}
            onClick={() => router.push('/routes/create')}
          >
            + Add Route
          </button>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <input
                type="text"
                placeholder="Search by route name, start, or end..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
            </div>

            <Table
              columns={columns}
              data={filteredRoutes}
              loading={loading}
              onRowClick={(row) => router.push(`/routes/${row._id}`)}
            />
          </div>
        </div>

        {showAssignModal && (
          <div className={modalStyles.modalOverlay} onClick={closeAssignModal}>
            <div className={modalStyles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={modalStyles.modalHeader}>
                <h2>Assign Route</h2>
              </div>
              <form onSubmit={handleAssignRoute}>
                <div className={modalStyles.formGroup}>
                  <label htmlFor="employeeSelect">Select Order Taker *</label>
                  <SearchableSelect
                    id="employeeSelect"
                    name="assignEmployeeId"
                    value={assignEmployeeId}
                    onChange={(e) => setAssignEmployeeId(e.target.value)}
                    placeholder="Select an employee"
                    options={[
                      { value: '', label: 'Select an employee' },
                      ...orderTakers.map((emp) => ({
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

export default function RoutesPageWrapper() {
  return (
    <ProtectedRoute>
      <RoutesPage />
    </ProtectedRoute>
  );
}
