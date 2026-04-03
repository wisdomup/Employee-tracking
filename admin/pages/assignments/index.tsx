import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { routeAssignmentService, RouteAssignment } from '../../services/routeAssignmentService';
import { routeService, Route } from '../../services/routeService';
import { employeeService, Employee } from '../../services/employeeService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';
import modalStyles from '../../styles/Modal.module.scss';

const AssignmentsPage: React.FC = () => {
  const [routeAssignments, setRouteAssignments] = useState<RouteAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [orderTakers, setOrderTakers] = useState<Employee[]>([]);
  const [formData, setFormData] = useState({ routeId: '', employeeId: '' });

  useEffect(() => {
    fetchRouteAssignments();
    fetchRoutes();
    fetchOrderTakers();
  }, []);

  const fetchRouteAssignments = async () => {
    try {
      const data = await routeAssignmentService.getRouteAssignments();
      setRouteAssignments(data);
    } catch (error) {
      toast.error('Failed to fetch route assignments');
    } finally {
      setLoading(false);
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

  const fetchOrderTakers = async () => {
    try {
      const data = await employeeService.getEmployees({ role: 'order_taker' });
      setOrderTakers(data);
    } catch (error) {
      toast.error('Failed to fetch order takers');
    }
  };

  const openModal = () => {
    setFormData({ routeId: '', employeeId: '' });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setFormData({ routeId: '', employeeId: '' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.routeId || !formData.employeeId) {
      toast.error('Please select both route and order taker');
      return;
    }
    try {
      await routeAssignmentService.assignRouteToEmployee(formData.routeId, formData.employeeId);
      toast.success('Route assigned successfully');
      closeModal();
      fetchRouteAssignments();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to assign route');
    }
  };

  const handleUnassign = async (routeId: string) => {
    if (!window.confirm('Unassign this route from the order taker?')) return;
    try {
      await routeAssignmentService.unassignRoute(routeId);
      toast.success('Route unassigned');
      fetchRouteAssignments();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to unassign route');
    }
  };

  const routeAssignmentColumns = [
    {
      key: 'routeId',
      title: 'Route',
      render: (value: any) =>
        value?.name ? `${value.name} (${value.startingPoint} → ${value.endingPoint})` : '-',
    },
    {
      key: 'employeeId',
      title: 'Order Taker',
      render: (value: any) =>
        value ? `${value.username} — ${value.phone}` : '-',
    },
    {
      key: 'assignedAt',
      title: 'Assigned Date',
      render: (value: string) =>
        value ? format(new Date(value), 'MMM dd, yyyy') : '-',
    },
    {
      key: '_id',
      title: 'Actions',
      render: (_: string, row: RouteAssignment) => (
        <div className={styles.actions}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleUnassign(row.routeId?._id || row.routeId);
            }}
            className={styles.deleteButton}
          >
            Unassign
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Route Assignments</h1>
          <button className={styles.addButton} onClick={openModal}>
            + Assign Route
          </button>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <p style={{ color: '#6b7280', marginBottom: 16, fontSize: '0.875rem', marginTop: 0 }}>
              Routes can only be assigned to users with the <strong>Order Taker</strong> role. Tasks are assigned
              individually to any employee from the task detail page.
            </p>

            <Table
              columns={routeAssignmentColumns}
              data={routeAssignments}
              loading={loading}
            />
          </div>
        </div>

        {showModal && (
          <div className={modalStyles.modalOverlay} onClick={closeModal}>
            <div className={modalStyles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={modalStyles.modalHeader}>
                <h2>Assign Route to Order Taker</h2>
              </div>
              <form onSubmit={handleSubmit}>
                <div className={modalStyles.formGroup}>
                  <label htmlFor="routeId">Select Route *</label>
                  <select
                    id="routeId"
                    name="routeId"
                    value={formData.routeId}
                    onChange={handleChange}
                    required
                  >
                    <option value="">Select a route</option>
                    {routes.map((route) => (
                      <option key={route._id} value={route._id}>
                        {route.name} ({route.startingPoint} → {route.endingPoint})
                      </option>
                    ))}
                  </select>
                </div>
                <div className={modalStyles.formGroup}>
                  <label htmlFor="employeeId">Select Order Taker *</label>
                  <select
                    id="employeeId"
                    name="employeeId"
                    value={formData.employeeId}
                    onChange={handleChange}
                    required
                  >
                    <option value="">Select an order taker</option>
                    {orderTakers.map((emp) => (
                      <option key={emp._id} value={emp._id}>
                        {emp.username} — {emp.phone}
                      </option>
                    ))}
                  </select>
                  {orderTakers.length === 0 && (
                    <small style={{ color: '#ef4444' }}>
                      No order takers found. Create a user with the order_taker role first.
                    </small>
                  )}
                </div>
                <div className={modalStyles.modalActions}>
                  <button
                    type="button"
                    className={modalStyles.cancelButton}
                    onClick={closeModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={modalStyles.submitButton}
                    disabled={orderTakers.length === 0}
                  >
                    Assign Route
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

export default function AssignmentsPageWrapper() {
  return (
    <ProtectedRoute>
      <AssignmentsPage />
    </ProtectedRoute>
  );
}
