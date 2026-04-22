import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import { productService, Product } from '../../../services/productService';
import { useAuth } from '../../../contexts/AuthContext';
import { can } from '../../../utils/permissions';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const ProductDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const canEditProduct = can(user?.role, 'products:edit');
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      productService
        .getProduct(id as string)
        .then(setProduct)
        .catch(() => toast.error('Failed to fetch product'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) return <Layout><Loader /></Layout>;
  if (!product) return <Layout><div>Product not found</div></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Product Details</h1>
          <div className={styles.headerActions}>
            {canEditProduct && (
              <button className={styles.editButton} onClick={() => router.push(`/products/${id}/edit`)}>
                Edit
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/products')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            {product.image && (
              <div style={{ marginBottom: '1.5rem' }}>
                <img
                  src={`${process.env.NEXT_PUBLIC_API_URL}${product.image}`}
                  alt={product.name}
                  style={{ maxWidth: '300px', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}
                />
              </div>
            )}
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Barcode:</span>
                <span className={styles.value}>{product.barcode}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Name:</span>
                <span className={styles.value}>{product.name}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Category:</span>
                <span className={styles.value}>{product.categoryId?.name || '-'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Sale Price:</span>
                <span className={styles.value}>
                  {product.salePrice !== undefined ? `Rs. ${product.salePrice.toFixed(2)}` : '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Purchase Price:</span>
                <span className={styles.value}>
                  {product.purchasePrice !== undefined ? `Rs. ${product.purchasePrice.toFixed(2)}` : '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Online Price:</span>
                <span className={styles.value}>
                  {product.onlinePrice !== undefined ? `Rs. ${product.onlinePrice.toFixed(2)}` : '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Stock Quantity:</span>
                <span className={styles.value}>
                  {product.quantity !== undefined ? product.quantity : '-'}
                  {product.survivalQuantity !== undefined &&
                    product.quantity !== undefined &&
                    product.quantity <= product.survivalQuantity && (
                      <span
                        style={{
                          marginLeft: '0.5rem',
                          display: 'inline-block',
                          background: product.quantity === 0 ? '#fef2f2' : '#fffbeb',
                          color: product.quantity === 0 ? '#b91c1c' : '#b45309',
                          border: `1px solid ${product.quantity === 0 ? '#fecaca' : '#fde68a'}`,
                          borderRadius: '0.375rem',
                          padding: '0.1rem 0.5rem',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                        }}
                      >
                        {product.quantity === 0 ? 'Out of stock' : 'Low stock'}
                      </span>
                    )}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Survival Qty:</span>
                <span className={styles.value}>
                  {product.survivalQuantity !== undefined ? (
                    <>
                      {product.survivalQuantity}
                      <span style={{ marginLeft: '0.4rem', fontSize: '0.8125rem', color: '#6b7280' }}>
                        (low stock alert threshold)
                      </span>
                    </>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>Not set</span>
                  )}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Description:</span>
                <span className={styles.value}>{product.description || '-'}</span>
              </div>
              {product.extras && typeof product.extras === 'object' && Object.keys(product.extras).length > 0 && (
                <>
                  {Object.entries(product.extras).map(([key, value]) => (
                    <div key={key} className={styles.infoItem}>
                      <span className={styles.label}>
                        {key.replace(/\b\w/g, (c) => c.toUpperCase())}:
                      </span>
                      <span className={styles.value}>{String(value)}</span>
                    </div>
                  ))}
                </>
              )}
              {product.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {product.createdBy.username ?? product.createdBy.userID ?? '-'}
                    {product.createdBy.role ? ` (${product.createdBy.role})` : ''}
                  </span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Created:</span>
                <span className={styles.value}>
                  {format(new Date(product.createdAt), 'MMM dd, yyyy')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ProductDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ProductDetailPage />
    </ProtectedRoute>
  );
}
