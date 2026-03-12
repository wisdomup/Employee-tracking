import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import { catalogService, Catalog } from '../../../services/catalogService';
import { toast } from 'react-toastify';
import styles from '../../../styles/FormPage.module.scss';

const EditCatalogPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (id) {
      catalogService
        .getCatalog(id as string)
        .then((data: Catalog) => setName(data.name))
        .catch(() => toast.error('Failed to fetch catalog'))
        .finally(() => setFetchLoading(false));
    }
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (file && file.type !== 'application/pdf') {
      toast.error('Only PDF files are allowed');
      return;
    }
    setLoading(true);
    try {
      await catalogService.updateCatalog(id as string, {
        name: name.trim(),
        ...(file && { file }),
      });
      toast.success('Catalog updated successfully');
      router.push(`/catalogs/${id}`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to update catalog');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Catalog</h1>
          <button className={styles.backButton} onClick={() => router.push(`/catalogs/${id}`)}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name *</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={styles.input}
              placeholder="Catalog name"
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="file">Replace PDF (optional)</label>
            <input
              type="file"
              id="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className={styles.input}
            />
            {file && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                New file: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <p style={{ marginTop: '0.5rem', fontSize: '0.8125rem', color: '#6b7280' }}>
              Leave empty to keep the current PDF.
            </p>
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push(`/catalogs/${id}`)}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update Catalog'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditCatalogPageWrapper() {
  return (
    <ProtectedRoute>
      <EditCatalogPage />
    </ProtectedRoute>
  );
}
