import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import { visitService, Visit, VisitCompletionImage } from '../../../services/visitService';
import { ImageUpload } from '../../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import Loader from '../../../components/UI/Loader';
import styles from '../../../styles/FormPage.module.scss';

const EditVisitPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [formData, setFormData] = useState({
    visitDate: '',
    status: 'todo',
  });
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [shopImageUrl, setShopImageUrl] = useState('');
  const [selfieImageUrl, setSelfieImageUrl] = useState('');

  useEffect(() => {
    if (id) fetchVisit();
  }, [id]);

  const fetchVisit = async () => {
    try {
      const data: Visit = await visitService.getVisit(id as string);
      setVisit(data);
      setFormData({
        visitDate: data.visitDate ? data.visitDate.slice(0, 10) : '',
        status: data.status,
      });
    } catch (error) {
      toast.error('Failed to fetch visit');
    } finally {
      setFetchLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }
    setLocationError(null);
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setLocationLoading(false);
      },
      () => {
        setLocationError('Could not get location. You can enter coordinates manually.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCompleting = formData.status === 'completed' && !visit?.completedAt;
    if (isCompleting) {
      if (latitude == null || longitude == null || !shopImageUrl || !selfieImageUrl) {
        toast.error('To mark as completed, please provide location, shop image, and selfie.');
        return;
      }
    }
    setLoading(true);
    try {
      if (isCompleting) {
        const completionImages: VisitCompletionImage[] = [
          { type: 'shop', url: shopImageUrl },
          { type: 'selfie', url: selfieImageUrl },
        ];
        await visitService.completeVisit(id as string, {
          latitude: latitude as number,
          longitude: longitude as number,
          completionImages,
        });
        toast.success('Visit marked as completed');
        router.push(`/visits/${id}`);
      } else {
        const dealerId =
          typeof visit?.dealerId === 'string'
            ? visit.dealerId
            : (visit?.dealerId as { _id?: string })?._id ?? visit?.dealerId;
        const employeeId =
          typeof visit?.employeeId === 'string'
            ? visit.employeeId
            : (visit?.employeeId as { _id?: string })?._id ?? visit?.employeeId;
        if (!dealerId || !employeeId) {
          toast.error('Visit data is missing dealer or employee. Cannot update.');
          setLoading(false);
          return;
        }
        await visitService.updateVisit(id as string, {
          dealerId,
          employeeId,
          visitDate: formData.visitDate || undefined,
          status: formData.status as Visit['status'],
        });
        toast.success('Visit updated successfully');
        router.push('/visits');
      }
    } catch (error: unknown) {
      const msg =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(msg || 'Failed to update visit');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Visit</h1>
          <button className={styles.backButton} onClick={() => router.push('/visits')}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="visitDate">Visit Date</label>
            <input
              type="date"
              id="visitDate"
              name="visitDate"
              value={formData.visitDate}
              onChange={handleChange}
              className={styles.input}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="status">Status *</label>
            <select
              id="status"
              name="status"
              value={formData.status}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="incomplete">Incomplete</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {formData.status === 'completed' && !visit?.completedAt && (
            <>
              <div className={styles.formGroup}>
                <label>Completion details</label>
                <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  To mark this visit as completed, provide your current location, a shop image, and a selfie.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    className={styles.submitButton}
                    onClick={handleGetLocation}
                    disabled={locationLoading}
                  >
                    {locationLoading ? 'Getting location…' : 'Get my location'}
                  </button>
                  {latitude != null && longitude != null && (
                    <span style={{ fontSize: '0.875rem' }}>
                      Lat: {latitude.toFixed(6)}, Lng: {longitude.toFixed(6)}
                    </span>
                  )}
                </div>
                {locationError && (
                  <span style={{ fontSize: '0.875rem', color: '#dc2626', display: 'block', marginBottom: '0.5rem' }}>
                    {locationError}
                  </span>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={latitude ?? ''}
                    onChange={(e) => setLatitude(e.target.value ? Number(e.target.value) : null)}
                    className={styles.input}
                    style={{ maxWidth: 140 }}
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={longitude ?? ''}
                    onChange={(e) => setLongitude(e.target.value ? Number(e.target.value) : null)}
                    className={styles.input}
                    style={{ maxWidth: 140 }}
                  />
                </div>
              </div>
              <div className={styles.formGroup}>
                <ImageUpload
                  label="Shop image"
                  category="completions"
                  value={shopImageUrl}
                  onChange={setShopImageUrl}
                />
              </div>
              <div className={styles.formGroup}>
                <ImageUpload
                  label="Selfie (employee)"
                  category="completions"
                  value={selfieImageUrl}
                  onChange={setSelfieImageUrl}
                />
              </div>
            </>
          )}

          {formData.status === 'completed' && visit?.completedAt && (
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              This visit is already completed. You can change the visit date above and save.
            </p>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push('/visits')}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update Visit'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditVisitPageWrapper() {
  return (
    <ProtectedRoute>
      <EditVisitPage />
    </ProtectedRoute>
  );
}
