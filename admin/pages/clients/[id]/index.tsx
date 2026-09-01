import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Table from '../../../components/UI/Table';
import MapView from '../../../components/Map/MapView';
import NavigateButton from '../../../components/Map/NavigateButton';
import StartVisitButton from '../../../components/Visits/StartVisitButton';
import ClientLocationCorrection from '../../../components/Clients/ClientLocationCorrection';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import { clientService, Client } from '../../../services/clientService';
import { orderService, Order } from '../../../services/orderService';
import {
  visitService,
  Visit,
  DealerGalleryEntry,
  DealerLastVisit,
  getVisitCompletionImageUrl,
} from '../../../services/visitService';
import { useAuth } from '../../../contexts/AuthContext';
import { can } from '../../../utils/permissions';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/DetailPage.module.scss';

/** "Yesterday" / "3 days ago" — the phrasing a rider or admin would actually use out loud. */
function describeGap(daysAgo: number): string {
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  return `${daysAgo} days ago`;
}

/**
 * The first thing on a client profile: when this shop was last actually visited.
 *
 * Colour is the signal — a shop untouched for over a fortnight is the one an admin needs to
 * notice, so it turns amber rather than sitting quietly in the same grey as everything else.
 */
function LastVisitBanner({
  lastVisit,
  onOpenVisit,
}: {
  lastVisit: DealerLastVisit | null;
  onOpenVisit: (visitId: string) => void;
}) {
  if (!lastVisit) return null;

  const { visit, daysAgo } = lastVisit;
  const stale = daysAgo != null && daysAgo > 14;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
        padding: '0.9rem 1.25rem',
        marginBottom: '1.5rem',
        borderRadius: '0.75rem',
        border: `1px solid ${visit ? (stale ? '#fcd34d' : '#bbf7d0') : '#e5e7eb'}`,
        background: visit ? (stale ? '#fffbeb' : '#f0fdf4') : '#f9fafb',
      }}
    >
      <div style={{ fontSize: '0.8125rem', color: '#6b7280', fontWeight: 600, letterSpacing: '0.02em' }}>
        LAST VISIT
      </div>
      {!visit || daysAgo == null ? (
        <div style={{ color: '#6b7280', fontSize: '0.95rem' }}>
          This shop has never been visited.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.95rem', color: '#111827' }}>
            <strong>{format(new Date(visit.completedAt as string), 'EEE, MMM dd, yyyy')}</strong>
            {' — '}
            <span style={{ color: stale ? '#b45309' : '#15803d', fontWeight: 600 }}>
              {describeGap(daysAgo)}
            </span>
          </div>
          <div style={{ fontSize: '0.85rem', color: '#4b5563' }}>
            by {visit.employeeId?.fullName || visit.employeeId?.username || visit.employeeId?.userID || 'Unknown rider'}
            {visit.routeId?.name ? ` · ${visit.routeId.name}` : ''}
            {visit.durationMinutes != null ? ` · ${visit.durationMinutes} min` : ''}
          </div>
          <button
            type="button"
            onClick={() => onOpenVisit(visit._id)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              padding: 0,
              color: '#0369a1',
              fontSize: '0.85rem',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            View that visit
          </button>
        </>
      )}
    </div>
  );
}

const ClientDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  /**
   * Field staff can walk into any client they can see and start a visit there, without
   * waiting for it to appear on their route.
   */
  const canStartVisit =
    !!user?.role && ['order_taker', 'delivery_man', 'employee'].includes(user.role);
  /**
   * Field staff can correct the pin and the address of a client they are standing in front of.
   * Everything else on the client record stays on the admin edit form.
   */
  const canCorrectLocation = can(user?.role, 'dealers:fix-location');
  const [client, setClient] = useState<Client | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitFilterDate, setVisitFilterDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [loading, setLoading] = useState(true);
  const [gallery, setGallery] = useState<DealerGalleryEntry[]>([]);
  const [correctingLocation, setCorrectingLocation] = useState(false);
  const [lastVisit, setLastVisit] = useState<DealerLastVisit | null>(null);

  useEffect(() => {
    if (id) {
      fetchClient();
      fetchGallery();
      fetchLastVisit();
      fetchOrders();
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

  /** Shop photos & notes recorded by riders after checking out of this client. */
  const fetchGallery = async () => {
    if (!id) return;
    try {
      const data = await visitService.getDealerGallery(id as string);
      setGallery(Array.isArray(data) ? data : []);
    } catch {
      setGallery([]);
    }
  };

  /** Whoever last stood in this shop, and how long ago — shown the moment the profile opens. */
  const fetchLastVisit = async () => {
    if (!id) return;
    try {
      const data = await visitService.getDealerLastVisit(id as string);
      setLastVisit(data);
    } catch {
      setLastVisit({ visit: null, daysAgo: null });
    }
  };

  /**
   * Everything ever billed to this shop, newest first. The server auto-scopes the list for
   * order_takers, so a rider looking at a client still only sees the orders they punched.
   */
  const fetchOrders = async () => {
    if (!id) return;
    try {
      const data = await orderService.getOrders({ clientId: id as string });
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to fetch order history');
      setOrders([]);
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

  const orderColumns = [
    {
      key: 'invoiceNumber',
      title: 'Invoice No',
      render: (value: number | undefined, row: Order) =>
        value != null && Number.isFinite(value)
          ? `INV-${String(Math.floor(value)).padStart(6, '0')}`
          : row._id.slice(-8).toUpperCase(),
    },
    {
      key: 'createdAt',
      title: 'Order Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value as Order['status']} />,
    },
    {
      key: 'paymentType',
      title: 'Payment Type',
      render: (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '-'),
    },
    {
      key: 'createdBy',
      title: 'Created By',
      render: (value: any) => (value ? value.username ?? value.userID ?? '-' : '-'),
    },
    {
      key: 'grandTotal',
      title: 'Grand Total',
      render: (value: number) => (value != null ? `Rs. ${Number(value).toFixed(2)}` : '-'),
      total: 'sum' as const,
      totalRender: (value: number) => `Rs. ${value.toFixed(2)}`,
    },
  ];

  const handleOrderRowClick = (row: Order) => {
    router.push(`/orders/${row._id}`);
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
            {canStartVisit && (
              <StartVisitButton
                dealerId={id as string}
                clientName={client.name}
                className={styles.navigateButton}
              />
            )}
            {canCorrectLocation && (
              <button
                className={styles.navigateButton}
                onClick={() => setCorrectingLocation(true)}
                title="Fix the map pin or the postal address for this client"
              >
                Fix Location
              </button>
            )}
            {can(undefined, 'dealers:edit') && (
              <button className={styles.editButton} onClick={handleEdit}>
                Edit
              </button>
            )}
            <button
              className={styles.backButton}
              onClick={() => router.push('/clients')}
            >
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <LastVisitBanner lastVisit={lastVisit} onOpenVisit={(visitId) => router.push(`/visits/${visitId}`)} />

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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <h2 style={{ margin: 0 }}>Location</h2>
                <NavigateButton
                  destination={{ lat: client.latitude, lng: client.longitude }}
                  className={styles.navigateButton}
                  title={`Open driving directions to ${client.name}`}
                />
              </div>
              <div className={styles.infoGrid} style={{ marginTop: '1rem' }}>
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

          {gallery.length > 0 && (
            <div className={styles.section}>
              <h2>Shop Photo Gallery</h2>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
                Photos and notes captured by riders after checking out of this shop.
              </p>
              <div style={{ display: 'grid', gap: '1.25rem' }}>
                {gallery.map((entry) => (
                  <div
                    key={entry._id}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.5rem',
                      padding: '1rem',
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: '1rem',
                        flexWrap: 'wrap',
                        marginBottom: '0.75rem',
                      }}
                    >
                      <strong style={{ color: '#1f2937' }}>
                        {entry.employeeId?.username ?? entry.employeeId?.userID ?? 'Unknown rider'}
                      </strong>
                      <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
                        {entry.galleryUpdatedAt
                          ? format(new Date(entry.galleryUpdatedAt), 'MMM dd, yyyy hh:mm a')
                          : entry.completedAt
                            ? format(new Date(entry.completedAt), 'MMM dd, yyyy hh:mm a')
                            : ''}
                      </span>
                    </div>
                    {entry.visitNotes && (
                      <p
                        style={{
                          whiteSpace: 'pre-wrap',
                          color: '#374151',
                          fontSize: '0.9375rem',
                          marginBottom: (entry.galleryImages?.length ?? 0) > 0 ? '0.75rem' : 0,
                        }}
                      >
                        {entry.visitNotes}
                      </p>
                    )}
                    {(entry.galleryImages?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {entry.galleryImages!.map((img, idx) => (
                          <a
                            key={`${img.url}-${idx}`}
                            href={getVisitCompletionImageUrl(img.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={img.caption || `Shop photo ${idx + 1}`}
                          >
                            <img
                              src={getVisitCompletionImageUrl(img.url)}
                              alt={img.caption || `Shop photo ${idx + 1}`}
                              style={{
                                width: 130,
                                height: 130,
                                objectFit: 'cover',
                                borderRadius: '0.5rem',
                                border: '2px solid #e5e7eb',
                              }}
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => router.push(`/visits/${entry._id}`)}
                      style={{
                        marginTop: '0.75rem',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: '#0369a1',
                        fontSize: '0.8125rem',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      View the visit this came from
                    </button>
                  </div>
                ))}
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
                  exportFileName={`client-visits-${client?.shopName || client?.name || id}`}
                  exportPdfTitle={`Visits — ${client?.shopName || client?.name || "Client"}`}
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

          <div className={styles.section}>
            <h2>Orders ({orders.length})</h2>
            {orders.length > 0 ? (
              <div style={{ marginTop: '1rem' }}>
                <Table
                  columns={orderColumns}
                  data={orders}
                  loading={false}
                  onRowClick={handleOrderRowClick}
                />
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                  Click on a row to view the order
                </p>
              </div>
            ) : (
              <p style={{ color: '#6b7280', marginTop: '1rem' }}>
                No orders placed for this client yet.
              </p>
            )}
          </div>
        </div>
      </div>

      {correctingLocation && (
        <ClientLocationCorrection
          client={client}
          onSaved={setClient}
          onClose={() => setCorrectingLocation(false)}
        />
      )}
    </Layout>
  );
};

export default function ClientDetailPageWrapper() {
  return (
    <ProtectedRoute permission="dealers:view">
      <ClientDetailPage />
    </ProtectedRoute>
  );
}
