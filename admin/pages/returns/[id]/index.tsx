import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import { returnService, Return } from '../../../services/returnService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const ReturnDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [returnItem, setReturnItem] = useState<Return | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      returnService
        .getReturn(id as string)
        .then(setReturnItem)
        .catch(() => toast.error('Failed to fetch return'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) return <Layout><Loader /></Layout>;
  if (!returnItem) return <Layout><div>Return not found</div></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Return / Claim Details</h1>
          <button className={styles.backButton} onClick={() => router.push('/returns')}>
            ← Back
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Type:</span>
                <span
                  className={styles.value}
                  style={{
                    display: 'inline-block',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '1rem',
                    background: returnItem.returnType === 'return' ? '#dbeafe' : '#fef3c7',
                    color: returnItem.returnType === 'return' ? '#1e40af' : '#92400e',
                    fontWeight: 500,
                  }}
                >
                  {returnItem.returnType.charAt(0).toUpperCase() + returnItem.returnType.slice(1)}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Product:</span>
                <span className={styles.value}>{returnItem.productId?.name || '-'}</span>
              </div>
              {returnItem.productId?.barcode && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Barcode:</span>
                  <span className={styles.value}>{returnItem.productId.barcode}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Dealer:</span>
                <span className={styles.value}>{returnItem.dealerId?.name || '-'}</span>
              </div>
              {returnItem.dealerId?.phone && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Dealer Phone:</span>
                  <span className={styles.value}>{returnItem.dealerId.phone}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Reason:</span>
                <span className={styles.value}>{returnItem.returnReason || '-'}</span>
              </div>
              {returnItem.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {returnItem.createdBy.username ?? returnItem.createdBy.userID ?? '-'}
                    {returnItem.createdBy.role ? ` (${returnItem.createdBy.role})` : ''}
                  </span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Submitted On:</span>
                <span className={styles.value}>
                  {format(new Date(returnItem.createdAt), 'MMM dd, yyyy hh:mm a')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ReturnDetailPageWrapper() {
  return (
    <ProtectedRoute>
      <ReturnDetailPage />
    </ProtectedRoute>
  );
}
