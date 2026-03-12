import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { catalogService } from '../../services/catalogService';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';

export default function CreateCatalogPageWrapper() {
  return (
    <ProtectedRoute>
      <CreateCatalogPage />
    </ProtectedRoute>
  );
}

function CreateCatalogPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!file) { toast.error('Please select a PDF file'); return; }
    if (file.type !== 'application/pdf') { toast.error('Only PDF files are allowed'); return; }
    setLoading(true);
    try {
      await catalogService.createCatalog(name.trim(), file);
      toast.success('Catalog created successfully');
      router.push('/catalogs');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to create catalog');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Add Catalog</h1>
          <button className={styles.backButton} onClick={() => router.push('/catalogs')}>Back</button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name *</label>
            <input type="text" id="name" value={name} onChange={(e) => setName(e.target.value)} required className={styles.input} placeholder="Catalog name" />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="file">PDF File *</label>
            <input type="file" id="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required className={styles.input} />
            {file && <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push('/catalogs')}>Cancel</button>
            <button type="submit" className={styles.submitButton} disabled={loading}>{loading ? 'Creating...' : 'Add Catalog'}</button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
