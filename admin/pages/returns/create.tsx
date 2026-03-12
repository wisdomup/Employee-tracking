import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { returnService } from '../../services/returnService';
import { dealerService, Dealer } from '../../services/dealerService';
import { productService, Product } from '../../services/productService';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';

const CreateReturnPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [formData, setFormData] = useState({
    productId: '',
    dealerId: '',
    returnType: 'return',
    returnReason: '',
  });

  useEffect(() => {
    dealerService.getDealers().then(setDealers).catch(() => {});
    productService.getProducts().then(setProducts).catch(() => {});
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.productId || !formData.dealerId) {
      toast.error('Please select product and dealer');
      return;
    }
    if (!formData.returnType || !['return', 'claim'].includes(formData.returnType)) {
      toast.error('Please select Return type');
      return;
    }
    setLoading(true);
    try {
      await returnService.createReturn({
        productId: formData.productId,
        dealerId: formData.dealerId,
        returnType: formData.returnType as 'return' | 'claim',
        returnReason: formData.returnReason || undefined,
      });
      toast.success('Return created successfully');
      router.push('/returns');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create return');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>New Return / Claim</h1>
          <button className={styles.backButton} onClick={() => router.push('/returns')}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="productId">Product *</label>
            <select
              id="productId"
              name="productId"
              value={formData.productId}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="">Select a product</option>
              {products.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({p.barcode})
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="dealerId">Dealer *</label>
            <select
              id="dealerId"
              name="dealerId"
              value={formData.dealerId}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="">Select a dealer</option>
              {dealers.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name} — {d.phone}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="returnType">Return Type *</label>
            <select
              id="returnType"
              name="returnType"
              value={formData.returnType}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="return">Return</option>
              <option value="claim">Claim</option>
            </select>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="returnReason">Reason</label>
            <textarea
              id="returnReason"
              name="returnReason"
              value={formData.returnReason}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
              placeholder="Describe the reason for the return or claim"
            />
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push('/returns')}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Return'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateReturnPageWrapper() {
  return (
    <ProtectedRoute>
      <CreateReturnPage />
    </ProtectedRoute>
  );
}
