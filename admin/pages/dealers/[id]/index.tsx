import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Table from '../../../components/UI/Table';
import MapView from '../../../components/Map/MapView';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import { dealerService, Dealer } from '../../../services/dealerService';
import { visitService, Visit } from '../../../services/visitService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/DetailPage.module.scss';

const DealerDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [dealer, setDealer] = useState<Dealer | null>(null);
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
      fetchDealer();
    }
  }, [id]);

  useEffect(() => {
    if (id && visitFilterDate) {
      fetchVisits();
    }
  }, [id, visitFilterDate]);

  const fetchDealer = async () => {
    try {
      const data = await dealerService.getDealer(id as string);
      setDealer(data);
    } catch (error) {
      toast.error('Failed to fetch dealer');
    } finally {
      setLoading(false);
    }
  };

  const fetchVisits = async () => {
    if (!id) return;
    try {
      const data = await visitService.getVisits({
        dealerId: id as string,
        startDate: visitFilterDate,
        endDate: visitFilterDate,
      });
      setVisits(Array.isArray(data) ? data : []);
    } catch {
      setVisits([]);
    }
  };

  const handleEdit = () => {
    router.push(`/dealers/${id}/edit`);
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

  if (!dealer) {
    return (
      <Layout>
        <div>Dealer not found</div>
      </Layout>
    );
  }

  const markers =
    dealer.latitude != null && dealer.longitude != null
      ? [
          {
            lat: dealer.latitude,
            lng: dealer.longitude,
            type: 'dealer' as const,
            label: dealer.name,
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
          <h1>Dealer Details</h1>
          <div className={styles.headerActions}>
            <button className={styles.editButton} onClick={handleEdit}>
              Edit
            </button>
            <button
              className={styles.backButton}
              onClick={() => router.push('/dealers')}
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
                <span className={styles.label}>Name:</span>
                <span className={styles.value}>{dealer.name}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Phone:</span>
                <span className={styles.value}>{dealer.phone}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Email:</span>
                <span className={styles.value}>{dealer.email || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span className={styles.value}>
                  <StatusBadge status={dealer.status as 'active' | 'inactive'} />
                </span>
              </div>
              {dealer.category && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Category:</span>
                  <span className={styles.value}>{dealer.category}</span>
                </div>
              )}
              {dealer.rating != null && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Rating:</span>
                  <span className={styles.value}>{dealer.rating}</span>
                </div>
              )}
              {dealer.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {dealer.createdBy.username ?? dealer.createdBy.userID ?? '-'}
                    {dealer.createdBy.role ? ` (${dealer.createdBy.role})` : ''}
                  </span>
                </div>
              )}
            </div>
          </div>

          {dealer.shopImage && (
            <div className={styles.section}>
              <h2>Shop Image</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <img
                    src={imageUrl(dealer.shopImage)}
                    alt={`${dealer.name} shop`}
                    style={{ maxWidth: 240, maxHeight: 240, objectFit: 'cover', borderRadius: 8 }}
                  />
                </div>
              </div>
            </div>
          )}

          {dealer.profilePicture && (
            <div className={styles.section}>
              <h2>Profile Picture</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <img
                    src={imageUrl(dealer.profilePicture)}
                    alt={`${dealer.name} profile`}
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
                <span className={styles.value}>{dealer.address?.street || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>City:</span>
                <span className={styles.value}>{dealer.address?.city || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>State:</span>
                <span className={styles.value}>{dealer.address?.state || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Country:</span>
                <span className={styles.value}>{dealer.address?.country || '-'}</span>
              </div>
            </div>
          </div>

          {dealer.latitude != null && dealer.longitude != null && markers.length > 0 && (
            <div className={styles.section}>
              <h2>Location</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Coordinates:</span>
                  <span className={styles.value}>
                    {dealer.latitude.toFixed(6)}, {dealer.longitude.toFixed(6)}
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
                <label htmlFor="dealer-visit-date-filter" style={{ fontSize: '0.875rem', color: '#6b7280' }}>Date:</label>
                <DatePickerFilter
                  id="dealer-visit-date-filter"
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

export default function DealerDetailPageWrapper() {
  return (
    <ProtectedRoute>
      <DealerDetailPage />
    </ProtectedRoute>
  );
}
