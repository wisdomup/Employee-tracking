import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import MapView from '../../../components/Map/MapView';
import NavigateButton from '../../../components/Map/NavigateButton';
import ImageModal from '../../../components/UI/ImageModal';
import Loader from '../../../components/UI/Loader';
import { useAuth } from '../../../contexts/AuthContext';
import {
  visitService,
  Visit,
  getVisitCompletionImageUrl,
  VISIT_DURATION_LIMIT_MINUTES,
} from '../../../services/visitService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';
import { type LatLng } from '../../../utils/googleMapsNavigation';

const VisitDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const isOrderTaker = user?.role === 'order_taker';
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImageModal, setShowImageModal] = useState(false);

  useEffect(() => {
    if (id) fetchVisit();
  }, [id]);

  const fetchVisit = async () => {
    try {
      const data = await visitService.getVisit(id as string);
      setVisit(data);
    } catch {
      toast.error('Failed to fetch visit');
    } finally {
      setLoading(false);
    }
  };

  const dealerCoords = useMemo((): LatLng | null => {
    if (!visit) return null;
    const c = visit.dealerId;
    if (c?.latitude == null || c?.longitude == null) return null;
    return { lat: c.latitude, lng: c.longitude };
  }, [visit]);

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!visit) {
    return (
      <Layout>
        <div>Visit not found</div>
      </Layout>
    );
  }

  const client = visit.dealerId;
  const markers: { lat: number; lng: number; type: 'client' | 'completion'; label: string }[] = [];
  if (client?.latitude != null && client?.longitude != null) {
    markers.push({
      lat: client.latitude,
      lng: client.longitude,
      type: 'client',
      label: `Client: ${client.name}`,
    });
  }
  if (visit.status === 'completed' && visit.latitude != null && visit.longitude != null) {
    markers.push({
      lat: visit.latitude,
      lng: visit.longitude,
      type: 'completion',
      label: 'Completion location',
    });
  }

  const completionImagesForModal =
    visit.completionImages?.map((img) => ({
      type: img.type,
      url: getVisitCompletionImageUrl(img.url),
    })) ?? [];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Visit Details</h1>
          <div className={styles.headerActions}>
            <NavigateButton
              destination={dealerCoords}
              className={styles.navigateButton}
              title="Open Google Maps: drive from your location to this visit’s client"
              missingCoordsMessage="This client has no map coordinates on file."
            />
            {(() => {
              if (!isOrderTaker) {
                return (
                  <button className={styles.editButton} onClick={() => router.push(`/visits/${id}/edit`)}>
                    Edit
                  </button>
                );
              }
              if (visit.status === 'todo' || visit.status === 'in_progress') {
                return (
                  <button className={styles.editButton} onClick={() => router.push(`/visits/${id}/edit`)}>
                    Check In
                  </button>
                );
              }
              if (visit.status === 'checked_in') {
                return (
                  <button className={styles.editButton} onClick={() => router.push(`/visits/${id}/edit`)}>
                    Complete Visit
                  </button>
                );
              }
              return null;
            })()}
            <button className={styles.backButton} onClick={() => router.push('/visits')}>
              ← Back
            </button>
          </div>
        </div>

        {visit.overstayFlagged && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.625rem',
              padding: '0.875rem 1rem',
              marginBottom: '1rem',
              borderRadius: '0.5rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
            }}
          >
            <span aria-hidden style={{ fontSize: '1.125rem', lineHeight: 1.2 }}>⚠️</span>
            <div>
              <strong>Overstay flagged</strong>
              <div style={{ fontSize: '0.875rem', marginTop: '0.125rem' }}>
                {visit.employeeId?.username ?? visit.employeeId?.userID ?? 'This rider'} spent{' '}
                {visit.durationMinutes} minutes at this store, over the{' '}
                {VISIT_DURATION_LIMIT_MINUTES} minute limit.
              </div>
            </div>
          </div>
        )}

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Visit Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Client:</span>
                <span className={styles.value}>{client?.name ?? '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Employee:</span>
                <span className={styles.value}>
                  {visit.employeeId?.username ?? visit.employeeId?.userID ?? '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Route:</span>
                <span className={styles.value}>{visit.routeId?.name ?? '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Origin:</span>
                <span className={styles.value}>
                  {visit.isSelfInitiated ? (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: '#ede9fe',
                        color: '#5b21b6',
                      }}
                      title="The rider chose this client themselves — it was not on their assigned route, so it is excluded from the 75% adherence rate."
                    >
                      Extra — rider chose this shop
                    </span>
                  ) : (
                    'Assigned route visit'
                  )}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Visit Date:</span>
                <span className={styles.value}>
                  {visit.visitDate
                    ? format(new Date(visit.visitDate), 'MMM dd, yyyy')
                    : '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span className={styles.value}>
                  <StatusBadge status={visit.status as Visit['status']} />
                </span>
              </div>
              {dealerCoords && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Dealer location:</span>
                  <span className={styles.value}>
                    {dealerCoords.lat.toFixed(6)}, {dealerCoords.lng.toFixed(6)}
                  </span>
                </div>
              )}
            </div>
            {dealerCoords && (
              <p className={styles.navigateHint}>
                <strong>Navigate</strong> opens Google Maps for this visit only—from your current
                location to this dealer (no other stops). If location access is denied, Maps will
                ask you to choose a starting point.
              </p>
            )}
          </div>

          {(visit.status === 'checked_in' || visit.status === 'completed') && visit.checkedInAt && (
            <div
              style={{
                marginTop: '1.5rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: '#0369a1' }}>
                Check-In Information
              </h3>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label} style={{ color: '#374151' }}>Checked In At:</span>
                  <span className={styles.value}>
                    {format(new Date(visit.checkedInAt), 'MMM dd, yyyy hh:mm a')}
                  </span>
                </div>
                {visit.checkedInLatitude != null && visit.checkedInLongitude != null && (
                  <div className={styles.infoItem}>
                    <span className={styles.label} style={{ color: '#374151' }}>Check-In GPS:</span>
                    <span className={styles.value}>
                      Lat: {visit.checkedInLatitude.toFixed(6)}, Lng: {visit.checkedInLongitude.toFixed(6)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {visit.status === 'completed' && visit.completedAt && (
            <div
              style={{
                marginTop: '1.5rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: '#1f2937' }}>
                Completion Information
              </h3>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label} style={{ color: '#374151' }}>Checked Out At:</span>
                  <span className={styles.value}>
                    {format(new Date(visit.completedAt), 'MMM dd, yyyy hh:mm a')}
                  </span>
                </div>
                {visit.durationMinutes != null && (
                  <div className={styles.infoItem}>
                    <span className={styles.label} style={{ color: '#374151' }}>Time At Store:</span>
                    <span
                      className={styles.value}
                      style={visit.overstayFlagged ? { color: '#b91c1c', fontWeight: 600 } : undefined}
                    >
                      {visit.durationMinutes} min
                      {visit.overstayFlagged
                        ? ` — over the ${VISIT_DURATION_LIMIT_MINUTES} min limit`
                        : ''}
                    </span>
                  </div>
                )}
                {visit.latitude != null && visit.longitude != null && (
                  <div className={styles.infoItem}>
                    <span className={styles.label} style={{ color: '#374151' }}>GPS Location:</span>
                    <span className={styles.value}>
                      Lat: {visit.latitude.toFixed(6)}, Lng: {visit.longitude.toFixed(6)}
                    </span>
                  </div>
                )}
              </div>
              {visit.completionImages && visit.completionImages.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <span className={styles.label} style={{ color: '#374151', display: 'block', marginBottom: '0.5rem' }}>Completion Images:</span>
                  <div
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      marginTop: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    {visit.completionImages.map((img, idx) => (
                      <div key={idx} style={{ position: 'relative' }}>
                        <img
                          src={getVisitCompletionImageUrl(img.url)}
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
              {visit.latitude != null && visit.longitude != null && markers.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      flexWrap: 'wrap',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <span className={styles.label} style={{ color: '#374151' }}>
                      Completion Location Map:
                    </span>
                    <NavigateButton
                      destination={{ lat: visit.latitude, lng: visit.longitude }}
                      label="Navigate to checkout point"
                      variant="link"
                      title="Open driving directions to where this visit was checked out"
                    />
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <MapView markers={markers} height="300px" />
                  </div>
                  {markers.length > 1 && (
                    <p style={{ fontSize: '0.875rem', color: '#374151', marginTop: '0.5rem' }}>
                      Client location and completion location
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {((visit.galleryImages?.length ?? 0) > 0 || visit.visitNotes) && (
            <div
              style={{
                marginTop: '1.5rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem', color: '#1f2937' }}>
                Shop Photos &amp; Notes
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
                Added by {visit.employeeId?.username ?? visit.employeeId?.userID ?? 'the rider'}
                {visit.galleryUpdatedAt
                  ? ` on ${format(new Date(visit.galleryUpdatedAt), 'MMM dd, yyyy hh:mm a')}`
                  : ''}
                .
              </p>
              {visit.visitNotes && (
                <p
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    padding: '0.75rem',
                    color: '#374151',
                    fontSize: '0.9375rem',
                    marginBottom: '1rem',
                  }}
                >
                  {visit.visitNotes}
                </p>
              )}
              {(visit.galleryImages?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {visit.galleryImages!.map((img, idx) => (
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
                          width: '150px',
                          height: '150px',
                          objectFit: 'cover',
                          borderRadius: '0.5rem',
                          border: '2px solid #e5e7eb',
                        }}
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {completionImagesForModal.length > 0 && (
          <ImageModal
            images={completionImagesForModal}
            isOpen={showImageModal}
            onClose={() => setShowImageModal(false)}
          />
        )}
      </div>
    </Layout>
  );
};

export default function VisitDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'sales_manager', 'order_taker']}>
      <VisitDetailPage />
    </ProtectedRoute>
  );
}
