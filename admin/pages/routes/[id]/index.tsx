import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import { routeService, Route } from '../../../services/routeService';
import { clientService, Client } from '../../../services/clientService';
import { visitService, Visit } from '../../../services/visitService';
import { routeAssignmentService, RouteAssignment } from '../../../services/routeAssignmentService';
import StatusBadge from '../../../components/UI/StatusBadge';
import Table from '../../../components/UI/Table';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/DetailPage.module.scss';

const RouteDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [route, setRoute] = useState<Route | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [routeAssignment, setRouteAssignment] = useState<RouteAssignment | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitFilterDate, setVisitFilterDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [loading, setLoading] = useState(true);
  const [creatingVisits, setCreatingVisits] = useState(false);

  useEffect(() => {
    if (id) {
      fetchRoute();
      fetchClientsForRoute();
      fetchRouteAssignment();
    }
  }, [id]);

  useEffect(() => {
    if (id && visitFilterDate) {
      fetchVisits();
    }
  }, [id, visitFilterDate]);

  const fetchRoute = async () => {
    try {
      const data = await routeService.getRoute(id as string);
      setRoute(data);
    } catch (error) {
      toast.error('Failed to fetch route');
    } finally {
      setLoading(false);
    }
  };

  const fetchClientsForRoute = async () => {
    if (!id) return;
    try {
      const data = await clientService.getClients({ routeId: id as string });
      setClients(data);
    } catch {
      setClients([]);
    }
  };

  const fetchRouteAssignment = async () => {
    if (!id) return;
    try {
      const data = await routeAssignmentService.getByRoute(id as string);
      setRouteAssignment(data ?? null);
    } catch {
      setRouteAssignment(null);
    }
  };

  const fetchVisits = async () => {
    if (!id) return;
    try {
      const data = await visitService.getVisits({
        routeId: id as string,
        startDate: visitFilterDate,
        endDate: visitFilterDate,
      });
      setVisits(Array.isArray(data) ? data : []);
    } catch {
      setVisits([]);
    }
  };

  const handleEdit = () => {
    router.push(`/routes/${id}/edit`);
  };

  const visitColumns = [
    {
      key: 'employeeId',
      title: 'Employee',
      render: (value: Visit['employeeId']) => (value?.username ?? value?.userID ?? '-'),
    },
    {
      key: 'clientId',
      title: 'Client',
      render: (value: Visit['clientId']) => value?.name ?? '-',
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

  const canCreateVisits = Boolean(routeAssignment && clients.length > 0);
  const createVisitsDisabledReason = !routeAssignment
    ? 'Assign an employee to this route first.'
    : clients.length === 0
      ? 'Add clients to this route first.'
      : null;

  const handleCreateVisits = async () => {
    if (!id || creatingVisits) return;
    if (!routeAssignment) {
      toast.error('Assign an employee to this route first.');
      return;
    }
    if (clients.length === 0) {
      toast.error('Add clients to this route first.');
      return;
    }
    setCreatingVisits(true);
    try {
      const result = await visitService.createVisitsForRoute(id as string);
      if (result.skipped > 0) {
        toast.success(`Created ${result.created} visit(s). ${result.skipped} already existed for today.`);
      } else {
        toast.success(`Created ${result.created} visit(s) for today.`);
      }
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err && typeof (err as { response?: { data?: { message?: string } } }).response?.data?.message === 'string'
        ? (err as { response: { data: { message: string } } }).response.data.message
        : 'Failed to create visits';
      toast.error(msg);
    } finally {
      setCreatingVisits(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!route) {
    return (
      <Layout>
        <div>Route not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Route Details</h1>
          <div className={styles.headerActions}>
            <button className={styles.editButton} onClick={handleEdit}>
              Edit
            </button>
            <button
              className={styles.backButton}
              onClick={() => router.push('/routes')}
            >
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Route Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Route Name:</span>
                <span className={styles.value}>{route.name}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Start:</span>
                <span className={styles.value}>{route.startingPoint}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>End:</span>
                <span className={styles.value}>{route.endingPoint}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Clients assigned:</span>
                <span className={styles.value}>
                  {route.clientCount !== undefined ? route.clientCount : clients.length}
                </span>
              </div>
              {routeAssignment?.employeeId && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Assigned To:</span>
                  <span className={styles.value}>
                    {routeAssignment.employeeId.username ?? routeAssignment.employeeId.userID ?? '-'}
                  </span>
                </div>
              )}
              {route.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {route.createdBy.username ?? route.createdBy.userID ?? '-'}
                    {route.createdBy.role ? ` (${route.createdBy.role})` : ''}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0 }}>
                Clients on this route (
                {route.clientCount !== undefined ? route.clientCount : clients.length}
                )
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={handleCreateVisits}
                  disabled={creatingVisits || !canCreateVisits}
                  title={createVisitsDisabledReason ?? undefined}
                >
                  {creatingVisits ? 'Creating…' : 'Create visits'}
                </button>
                {!canCreateVisits && createVisitsDisabledReason && (
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {createVisitsDisabledReason}
                  </span>
                )}
              </div>
            </div>
            {clients.length === 0 ? (
              <p style={{ color: '#6b7280', margin: 0 }}>No clients assigned to this route.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {clients.map((client) => (
                  <li
                    key={client._id}
                    style={{
                      padding: '0.75rem 0',
                      borderBottom: '1px solid #e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{ color: '#1f2937', fontSize: '1rem' }}>
                      <strong>{client.name}</strong>
                      {client.phone && ` — ${client.phone}`}
                    </span>
                    <Link href={`/clients/${client._id}`} className={styles.editButton} style={{ textDecoration: 'none' }}>
                      View client
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0 }}>Visits ({visits.length})</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="route-visit-date-filter" style={{ fontSize: '0.875rem', color: '#6b7280' }}>Date:</label>
                <DatePickerFilter
                  id="route-visit-date-filter"
                  value={visitFilterDate}
                  onChange={setVisitFilterDate}
                  placeholder="Select date"
                />
              </div>
            </div>
            {visits.length > 0 ? (
              <div style={{ marginTop: '1rem' }}>
                <Table
                  columns={visitColumns}
                  data={visits}
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
        </div>
      </div>
    </Layout>
  );
};

export default function RouteDetailPageWrapper() {
  return (
    <ProtectedRoute>
      <RouteDetailPage />
    </ProtectedRoute>
  );
}
