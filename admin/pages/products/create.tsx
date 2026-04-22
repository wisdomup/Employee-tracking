import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { productService } from '../../services/productService';
import { categoryService, Category } from '../../services/categoryService';
import { ImageUpload } from '../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';

interface ExtrasRow {
  name: string;
  value: string;
}

const CreateProductPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
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
    survivalQuantity: '',
    categoryId: '',
  });

  useEffect(() => {
    categoryService.getCategories().then(setCategories).catch(() => {});
  }, []);

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
      await productService.createProduct({
        barcode: formData.barcode,
        name: formData.name,
        description: formData.description || undefined,
        image: formData.image || undefined,
        salePrice: formData.salePrice ? parseFloat(formData.salePrice) : undefined,
        purchasePrice: formData.purchasePrice ? parseFloat(formData.purchasePrice) : undefined,
        onlinePrice: formData.onlinePrice ? parseFloat(formData.onlinePrice) : undefined,
        quantity: formData.quantity ? parseInt(formData.quantity) : undefined,
        survivalQuantity: formData.survivalQuantity ? parseInt(formData.survivalQuantity) : undefined,
        categoryId: formData.categoryId,
        extras,
      });
      toast.success('Product created successfully');
      router.push('/products');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create product');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Create Product</h1>
          <button className={styles.backButton} onClick={() => router.push('/products')}>
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
              placeholder="Product barcode"
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
              placeholder="Product name"
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="categoryId">Category *</label>
            <SearchableSelect
              id="categoryId"
              name="categoryId"
              value={formData.categoryId}
              onChange={handleChange}
              className={styles.select}
              placeholder="Select a category"
              options={[
                { value: '', label: 'Select a category' },
                ...categories.map((c) => ({ value: c._id, label: c.name })),
              ]}
            />
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
                placeholder="0.00"
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
                placeholder="0.00"
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
                placeholder="0.00"
              />
            </div>
          </div>
          <div className={styles.formRow}>
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
                placeholder="Stock quantity"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="survivalQuantity">Survival Qty</label>
              <input
                type="number"
                id="survivalQuantity"
                name="survivalQuantity"
                value={formData.survivalQuantity}
                onChange={handleChange}
                className={styles.input}
                min={0}
                placeholder="Low stock threshold"
              />
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#6b7280' }}>
                Triggers low stock alert when current stock falls to or below this value.
              </p>
            </div>
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
            <button type="button" className={styles.cancelButton} onClick={() => router.push('/products')}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Creating...' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateProductPageWrapper() {
  return (
    <ProtectedRoute>
      <CreateProductPage />
    </ProtectedRoute>
  );
}
