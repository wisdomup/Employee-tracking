import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { routeService } from '../../services/routeService';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';

const CreateRoutePage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [startingPoint, setStartingPoint] = useState('');
  const [endingPoint, setEndingPoint] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Route name is required');
      return;
    }
    if (!startingPoint.trim()) {
      toast.error('Starting point is required');
      return;
    }
    if (!endingPoint.trim()) {
      toast.error('Ending point is required');
      return;
    }
    setLoading(true);
    try {
      await routeService.createRoute({
        name: name.trim(),
        startingPoint: startingPoint.trim(),
        endingPoint: endingPoint.trim(),
      });
      toast.success('Route created successfully');
      router.push('/routes');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create route');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Create Route</h1>
          <button
            className={styles.backButton}
            onClick={() => router.push('/routes')}
          >
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="name">Route Name *</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Office to Warehouse"
              required
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="startingPoint">Starting Point *</label>
            <input
              type="text"
              id="startingPoint"
              value={startingPoint}
              onChange={(e) => setStartingPoint(e.target.value)}
              placeholder="Enter starting point"
              required
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="endingPoint">Ending Point *</label>
            <input
              type="text"
              id="endingPoint"
              value={endingPoint}
              onChange={(e) => setEndingPoint(e.target.value)}
              placeholder="Enter ending point"
              required
              className={styles.input}
            />
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/routes')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Route'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateRoutePageWrapper() {
  return (
    <ProtectedRoute>
      <CreateRoutePage />
    </ProtectedRoute>
  );
}
