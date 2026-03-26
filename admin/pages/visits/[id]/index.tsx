import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import MapView from '../../../components/Map/MapView';
import ImageModal from '../../../components/UI/ImageModal';
import Loader from '../../../components/UI/Loader';
import { visitService, Visit, getVisitCompletionImageUrl } from '../../../services/visitService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const VisitDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
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
            <button
              className={styles.editButton}
              onClick={() => router.push(`/visits/${id}/edit`)}
            >
              Edit
            </button>
            <button className={styles.backButton} onClick={() => router.push('/visits')}>
              ← Back
            </button>
          </div>
        </div>

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
            </div>
          </div>

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
                  <span className={styles.label} style={{ color: '#374151' }}>Completed At:</span>
                  <span className={styles.value}>
                    {format(new Date(visit.completedAt), 'MMM dd, yyyy hh:mm a')}
                  </span>
                </div>
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
                  <span className={styles.label} style={{ color: '#374151', display: 'block', marginBottom: '0.5rem' }}>Completion Location Map:</span>
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
    <ProtectedRoute>
      <VisitDetailPage />
    </ProtectedRoute>
  );
}
