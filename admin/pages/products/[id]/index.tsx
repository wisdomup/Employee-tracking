import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import { productService, Product } from '../../../services/productService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const ProductDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
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
            <button className={styles.editButton} onClick={() => router.push(`/products/${id}/edit`)}>
              Edit
            </button>
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
                <span className={styles.label}>Stock Quantity:</span>
                <span className={styles.value}>
                  {product.quantity !== undefined ? product.quantity : '-'}
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
    <ProtectedRoute>
      <ProductDetailPage />
    </ProtectedRoute>
  );
}
