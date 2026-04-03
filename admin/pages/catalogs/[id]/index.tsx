import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import { catalogService, Catalog, getCatalogDownloadUrl } from '../../../services/catalogService';
import { useAuth } from '../../../contexts/AuthContext';
import { can } from '../../../utils/permissions';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const CatalogDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const canEditCatalog = can(user?.role, 'catalogs:edit');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      catalogService
        .getCatalog(id as string)
        .then(setCatalog)
        .catch(() => toast.error('Failed to fetch catalog'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) return <Layout><Loader /></Layout>;
  if (!catalog) return <Layout><div>Catalog not found</div></Layout>;

  const downloadUrl = getCatalogDownloadUrl(catalog.fileUrl);

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Catalog Details</h1>
          <div className={styles.headerActions}>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.editButton}
              style={{ textDecoration: 'none' }}
            >
              Download PDF
            </a>
            {canEditCatalog && (
              <button className={styles.editButton} onClick={() => router.push(`/catalogs/${id}/edit`)}>
                Edit
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/catalogs')}>
              Back
            </button>
          </div>
        </div>
        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Name:</span>
                <span className={styles.value}>{catalog.name}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Added:</span>
                <span className={styles.value}>
                  {format(new Date(catalog.createdAt), 'MMM dd, yyyy HH:mm')}
                </span>
              </div>
              {catalog.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {catalog.createdBy.username ?? catalog.createdBy.userID ?? '-'}
                    {catalog.createdBy.role ? ` (${catalog.createdBy.role})` : ''}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className={styles.section}>
            <h2>Preview</h2>
            <p style={{ marginBottom: '0.75rem', color: '#6b7280', fontSize: '0.875rem' }}>
              Open the PDF in a new tab to view or download.
            </p>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.editButton}
              style={{ display: 'inline-block', textDecoration: 'none' }}
            >
              Open PDF
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function CatalogDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <CatalogDetailPage />
    </ProtectedRoute>
  );
}
