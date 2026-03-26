import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Table from '../../../components/UI/Table';
import MapView from '../../../components/Map/MapView';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import { clientService, Client } from '../../../services/clientService';
import { visitService, Visit } from '../../../services/visitService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/DetailPage.module.scss';

const ClientDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [client, setClient] = useState<Client | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
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
      fetchClient();
    }
  }, [id]);

  useEffect(() => {
    if (id && visitFilterDate) {
      fetchVisits();
    }
  }, [id, visitFilterDate]);

  const fetchClient = async () => {
    try {
      const data = await clientService.getClient(id as string);
      setClient(data);
    } catch (error) {
      toast.error('Failed to fetch client');
    } finally {
      setLoading(false);
    }
  };

  const fetchVisits = async () => {
    if (!id) return;
    try {
      const data = await visitService.getVisits({
        clientId: id as string,
        startDate: visitFilterDate,
        endDate: visitFilterDate,
      });
      setVisits(Array.isArray(data) ? data : []);
    } catch {
      setVisits([]);
    }
  };

  const handleEdit = () => {
    router.push(`/clients/${id}/edit`);
  };

  const visitColumns = [
    {
      key: 'employeeId',
      title: 'Employee',
      render: (value: Visit['employeeId']) => (value?.username ?? value?.userID ?? '-'),
    },
    {
      key: 'routeId',
      title: 'Route',
      render: (value: Visit['routeId']) => value?.name ?? '-',
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

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!client) {
    return (
      <Layout>
        <div>Client not found</div>
      </Layout>
    );
  }

  const markers =
    client.latitude != null && client.longitude != null
      ? [
          {
            lat: client.latitude,
            lng: client.longitude,
            type: 'client' as const,
            label: client.name,
          },
        ]
      : [];

  const apiBase = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
  const imageUrl = (path: string) =>
    path.startsWith('http') ? path : `${apiBase}/api${path.startsWith('/') ? '' : '/'}${path}`;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Client Details</h1>
          <div className={styles.headerActions}>
            <button className={styles.editButton} onClick={handleEdit}>
              Edit
            </button>
            <button
              className={styles.backButton}
              onClick={() => router.push('/clients')}
            >
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Basic Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Client Name:</span>
                <span className={styles.value}>{client.name}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Shop Name:</span>
                <span className={styles.value}>{client.shopName || '-'}</span>
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
                <span className={styles.label}>Status:</span>
                <span className={styles.value}>
                  <StatusBadge status={client.status as 'active' | 'inactive'} />
                </span>
              </div>
              {client.category && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Category:</span>
                  <span className={styles.value}>{client.category}</span>
                </div>
              )}
              {client.rating != null && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Rating:</span>
                  <span className={styles.value}>{client.rating}</span>
                </div>
              )}
              {client.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {client.createdBy.username ?? client.createdBy.userID ?? '-'}
                    {client.createdBy.role ? ` (${client.createdBy.role})` : ''}
                  </span>
                </div>
              )}
            </div>
          </div>

          {client.shopImage && (
            <div className={styles.section}>
              <h2>Shop Image</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <img
                    src={imageUrl(client.shopImage)}
                    alt={`${client.name} shop`}
                    style={{ maxWidth: 240, maxHeight: 240, objectFit: 'cover', borderRadius: 8 }}
                  />
                </div>
              </div>
            </div>
          )}

          {client.profilePicture && (
            <div className={styles.section}>
              <h2>Profile Picture</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <img
                    src={imageUrl(client.profilePicture)}
                    alt={`${client.name} profile`}
                    style={{ maxWidth: 120, maxHeight: 120, borderRadius: 8 }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className={styles.section}>
            <h2>Address</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Street:</span>
                <span className={styles.value}>{client.address?.street || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>City:</span>
                <span className={styles.value}>{client.address?.city || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>State:</span>
                <span className={styles.value}>{client.address?.state || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Country:</span>
                <span className={styles.value}>{client.address?.country || '-'}</span>
              </div>
            </div>
          </div>

          {client.latitude != null && client.longitude != null && markers.length > 0 && (
            <div className={styles.section}>
              <h2>Location</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Coordinates:</span>
                  <span className={styles.value}>
                    {client.latitude.toFixed(6)}, {client.longitude.toFixed(6)}
                  </span>
                </div>
              </div>
              <div style={{ marginTop: '1rem' }}>
                <MapView markers={markers} height="300px" />
              </div>
            </div>
          )}

          <div className={styles.section}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0 }}>Visits ({visits.length})</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="client-visit-date-filter" style={{ fontSize: '0.875rem', color: '#6b7280' }}>Date:</label>
                <DatePickerFilter
                  id="client-visit-date-filter"
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

export default function ClientDetailPageWrapper() {
  return (
    <ProtectedRoute>
      <ClientDetailPage />
    </ProtectedRoute>
  );
}
