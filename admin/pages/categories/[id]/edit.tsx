import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import { categoryService } from '../../../services/categoryService';
import { ImageUpload } from '../../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/FormPage.module.scss';

const EditCategoryPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image: '',
  });

  useEffect(() => {
    if (id) fetchCategory();
  }, [id]);

  const fetchCategory = async () => {
    try {
      const data = await categoryService.getCategory(id as string);
      setFormData({
        name: data.name,
        description: data.description || '',
        image: data.image || '',
      });
    } catch (error) {
      toast.error('Failed to fetch category');
    } finally {
      setFetchLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      toast.error('Please enter Name');
      return;
    }
    setLoading(true);
    try {
      await categoryService.updateCategory(id as string, {
        name: formData.name,
        description: formData.description || undefined,
        image: formData.image || undefined,
      });
      toast.success('Category updated successfully');
      router.push('/categories');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update category');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Category</h1>
          <button className={styles.backButton} onClick={() => router.push('/categories')}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
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
            category="categories"
            label="Image"
          />
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push('/categories')}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update Category'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditCategoryPageWrapper() {
  return (
    <ProtectedRoute>
      <EditCategoryPage />
    </ProtectedRoute>
  );
}
