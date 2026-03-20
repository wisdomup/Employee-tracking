import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import { productService, Product } from '../../../services/productService';
import { categoryService, Category } from '../../../services/categoryService';
import { ImageUpload } from '../../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/FormPage.module.scss';

interface ExtrasRow {
  name: string;
  value: string;
}

const EditProductPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [extrasRows, setExtrasRows] = useState<ExtrasRow[]>([]);
  const [formData, setFormData] = useState({
    barcode: '',
    name: '',
    description: '',
    image: '',
    salePrice: '',
    purchasePrice: '',
    onlinePrice: '',
    quantity: '',
    categoryId: '',
  });

  useEffect(() => {
    categoryService.getCategories().then(setCategories).catch(() => {});
    if (id) fetchProduct();
  }, [id]);

  const fetchProduct = async () => {
    try {
      const data: Product = await productService.getProduct(id as string);
      setFormData({
        barcode: data.barcode,
        name: data.name,
        description: data.description || '',
        image: data.image || '',
        salePrice: data.salePrice !== undefined ? data.salePrice.toString() : '',
        purchasePrice: data.purchasePrice !== undefined ? data.purchasePrice.toString() : '',
        onlinePrice: data.onlinePrice !== undefined ? data.onlinePrice.toString() : '',
        quantity: data.quantity !== undefined ? data.quantity.toString() : '',
        categoryId: data.categoryId?._id || data.categoryId || '',
      });
      setExtrasRows(
        data.extras && typeof data.extras === 'object'
          ? Object.entries(data.extras).map(([name, value]) => ({ name, value: String(value) }))
          : [],
      );
    } catch (error) {
      toast.error('Failed to fetch product');
    } finally {
      setFetchLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const addExtrasRow = () => setExtrasRows((prev) => [...prev, { name: '', value: '' }]);

  const removeExtrasRow = (index: number) =>
    setExtrasRows((prev) => prev.filter((_, i) => i !== index));

  const updateExtrasRow = (index: number, field: 'name' | 'value', value: string) =>
    setExtrasRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );

  const buildExtrasFromRows = (): Record<string, string> | undefined => {
    const entries = extrasRows
      .filter((row) => row.name.trim() !== '')
      .map((row) => [row.name.trim(), row.value.trim()] as const);
    const names = entries.map(([n]) => n);
    const uniqueNames = new Set(names);
    if (names.length !== uniqueNames.size) {
      return undefined;
    }
    const obj = Object.fromEntries(entries);
    return Object.keys(obj).length ? obj : undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.barcode?.trim()) {
      toast.error('Please enter Barcode');
      return;
    }
    if (!formData.name?.trim()) {
      toast.error('Please enter Name');
      return;
    }
    if (!formData.categoryId) {
      toast.error('Please select a category');
      return;
    }
    const extras = buildExtrasFromRows();
    if (extras === undefined && extrasRows.some((r) => r.name.trim() !== '')) {
      toast.error('Two fields cannot have the same name');
      return;
    }
    setLoading(true);
    try {
      await productService.updateProduct(id as string, {
        barcode: formData.barcode,
        name: formData.name,
        description: formData.description || undefined,
        image: formData.image || undefined,
        salePrice: formData.salePrice ? parseFloat(formData.salePrice) : undefined,
        purchasePrice: formData.purchasePrice ? parseFloat(formData.purchasePrice) : undefined,
        onlinePrice: formData.onlinePrice ? parseFloat(formData.onlinePrice) : undefined,
        quantity: formData.quantity ? parseInt(formData.quantity) : undefined,
        categoryId: formData.categoryId,
        extras: extras !== undefined ? extras : {},
      });
      toast.success('Product updated successfully');
      router.push(`/products/${id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update product');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Product</h1>
          <button className={styles.backButton} onClick={() => router.push(`/products/${id}`)}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="barcode">Barcode *</label>
            <input
              type="text"
              id="barcode"
              name="barcode"
              value={formData.barcode}
              onChange={handleChange}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="categoryId">Category *</label>
            <select
              id="categoryId"
              name="categoryId"
              value={formData.categoryId}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="">Select a category</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="salePrice">Sale Price</label>
              <input
                type="number"
                id="salePrice"
                name="salePrice"
                value={formData.salePrice}
                onChange={handleChange}
                className={styles.input}
                min={0}
                step="0.01"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="purchasePrice">Purchase Price</label>
              <input
                type="number"
                id="purchasePrice"
                name="purchasePrice"
                value={formData.purchasePrice}
                onChange={handleChange}
                className={styles.input}
                min={0}
                step="0.01"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="onlinePrice">Online Price</label>
              <input
                type="number"
                id="onlinePrice"
                name="onlinePrice"
                value={formData.onlinePrice}
                onChange={handleChange}
                className={styles.input}
                min={0}
                step="0.01"
              />
            </div>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="quantity">Quantity</label>
            <input
              type="number"
              id="quantity"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              className={styles.input}
              min={0}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
            />
          </div>
          <ImageUpload
            value={formData.image}
            onChange={(url) => setFormData((prev) => ({ ...prev, image: url }))}
            category="products"
            label="Image"
          />
          <div className={styles.formGroup} style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <label style={{ margin: 0, fontWeight: 600, color: '#374151' }}>Additional fields (Extras)</label>
              <button type="button" onClick={addExtrasRow} className={styles.submitButton} style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
                + Add field
              </button>
            </div>
            {extrasRows.map((row, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateExtrasRow(idx, 'name', e.target.value)}
                  className={styles.input}
                  placeholder="Field name"
                  style={{ flex: '1 1 140px', minWidth: 0 }}
                />
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateExtrasRow(idx, 'value', e.target.value)}
                  className={styles.input}
                  placeholder="Field value"
                  style={{ flex: '1 1 140px', minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={() => removeExtrasRow(idx)}
                  className={styles.cancelButton}
                  style={{ padding: '0.5rem 0.75rem', flexShrink: 0 }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push(`/products/${id}`)}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update Product'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditProductPageWrapper() {
  return (
    <ProtectedRoute>
      <EditProductPage />
    </ProtectedRoute>
  );
}
