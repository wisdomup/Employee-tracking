import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import { returnService, Return, getReturnImageUrl } from '../../../services/returnService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending: { bg: '#fef3c7', color: '#92400e' },
  approved: { bg: '#dbeafe', color: '#1e40af' },
  picked: { bg: '#ede9fe', color: '#5b21b6' },
  completed: { bg: '#d1fae5', color: '#065f46' },
};

const ReturnDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [returnItem, setReturnItem] = useState<Return | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageOpen, setImageOpen] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

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

  const statusColors = STATUS_COLORS[returnItem.status] || { bg: '#f3f4f6', color: '#374151' };
  const invoiceUrl = returnItem.invoiceImage ? getReturnImageUrl(returnItem.invoiceImage) : '';
  const returnCreatorId =
    returnItem.createdBy == null
      ? ''
      : typeof returnItem.createdBy === 'object' && '_id' in returnItem.createdBy
        ? String((returnItem.createdBy as { _id: string })._id)
        : String(returnItem.createdBy);
  const isOwnReturn = !!user?.id && returnCreatorId === user.id;
  const showEdit =
    isAdmin || (isOrderTaker && returnItem.status === 'pending' && isOwnReturn);

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Return / Damage Details</h1>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {showEdit && (
              <button
                className={styles.backButton}
                onClick={() => router.push(`/returns/${id}/edit`)}
                style={{ background: 'var(--admin-primary)', color: '#fff', borderColor: 'var(--admin-primary)' }}
              >
                Edit
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/returns')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.infoGrid}>

              {/* Status */}
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '1rem',
                    background: statusColors.bg,
                    color: statusColors.color,
                    fontWeight: 600,
                    fontSize: '0.875rem',
                  }}
                >
                  {returnItem.status
                    ? returnItem.status.charAt(0).toUpperCase() + returnItem.status.slice(1)
                    : '-'}
                </span>
              </div>

              {/* Type */}
              <div className={styles.infoItem}>
                <span className={styles.label}>Type:</span>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '1rem',
                    background: returnItem.returnType === 'return' ? '#dbeafe' : '#fef3c7',
                    color: returnItem.returnType === 'return' ? '#1e40af' : '#92400e',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                  }}
                >
                  {returnItem.returnType
                    ? returnItem.returnType.charAt(0).toUpperCase() + returnItem.returnType.slice(1)
                    : '-'}
                </span>
              </div>

              {/* Client */}
              <div className={styles.infoItem}>
                <span className={styles.label}>Client:</span>
                <span className={styles.value}>{returnItem.dealerId?.name || '-'}</span>
              </div>
              {returnItem.dealerId?.phone && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Client Phone:</span>
                  <span className={styles.value}>{returnItem.dealerId.phone}</span>
                </div>
              )}

              {/* Amount */}
              {returnItem.amount != null && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Total Amount:</span>
                  <span className={styles.value} style={{ fontWeight: 600 }}>
                    Rs. {returnItem.amount.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Reason */}
              <div className={styles.infoItem}>
                <span className={styles.label}>Reason:</span>
                <span className={styles.value}>{returnItem.returnReason || '-'}</span>
              </div>

              {/* Created by */}
              {returnItem.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {returnItem.createdBy.username ?? returnItem.createdBy.userID ?? '-'}
                    {returnItem.createdBy.role ? ` (${returnItem.createdBy.role})` : ''}
                  </span>
                </div>
              )}

              {/* Date */}
              <div className={styles.infoItem}>
                <span className={styles.label}>Submitted On:</span>
                <span className={styles.value}>
                  {format(new Date(returnItem.createdAt), 'MMM dd, yyyy hh:mm a')}
                </span>
              </div>
            </div>
          </div>

          {/* Products Table */}
          <div className={styles.section} style={{ marginTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>
              Products
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.875rem',
                  color: '#1f2937',
                }}
              >
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>
                      Product
                    </th>
                    <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>
                      Barcode
                    </th>
                    <th style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>
                      Qty
                    </th>
                    <th style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>
                      Unit Price
                    </th>
                    <th style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(returnItem.products || []).map((p: any, idx: number) => {
                    const product = p.productId;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '0.625rem 0.75rem' }}>{product?.name || '-'}</td>
                        <td style={{ padding: '0.625rem 0.75rem', color: '#6b7280' }}>
                          {product?.barcode || '-'}
                        </td>
                        <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right' }}>{p.quantity}</td>
                        <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right' }}>
                          Rs. {(p.price ?? 0).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 500 }}>
                          Rs. {((p.quantity ?? 0) * (p.price ?? 0)).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f9fafb' }}>
                    <td colSpan={4} style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#374151' }}>
                      Products Total:
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>
                      Rs.{' '}
                      {(returnItem.products || [])
                        .reduce((s: number, p: any) => s + (p.quantity ?? 0) * (p.price ?? 0), 0)
                        .toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Invoice Image */}
          {invoiceUrl && (
            <div className={styles.section} style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>
                Invoice Image
              </h2>
              <div
                style={{ cursor: 'pointer', display: 'inline-block' }}
                onClick={() => setImageOpen(true)}
              >
                <img
                  src={invoiceUrl}
                  alt="Invoice"
                  style={{
                    maxHeight: 200,
                    maxWidth: '100%',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    display: 'block',
                  }}
                />
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                  Click to view full size
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {imageOpen && invoiceUrl && (
        <div
          onClick={() => setImageOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={invoiceUrl}
            alt="Invoice full size"
            style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: 8 }}
          />
        </div>
      )}
    </Layout>
  );
};

export default function ReturnDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ReturnDetailPage />
    </ProtectedRoute>
  );
}
