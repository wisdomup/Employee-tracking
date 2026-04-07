import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { visitService, Visit, VisitCompletionImage } from '../../services/visitService';
import { clientService, Client, formatClientSelectLabel } from '../../services/clientService';
import { routeService, Route } from '../../services/routeService';
import { employeeService, Employee } from '../../services/employeeService';
import { ImageUpload } from '../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';

const CreateVisitPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [formData, setFormData] = useState({
    clientId: '',
    employeeId: '',
    routeId: '',
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
    clientService.getClients().then(setClients).catch(() => {});
    routeService.getRoutes().then(setRoutes).catch(() => {});
    employeeService.getEmployees().then(setEmployees).catch(() => {});
  }, []);

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
    if (!formData.clientId || !formData.employeeId) {
      toast.error('Please select client and employee');
      return;
    }
    const isCompleting = formData.status === 'completed';
    if (isCompleting) {
      if (latitude == null || longitude == null || !shopImageUrl || !selfieImageUrl) {
        toast.error('To mark as completed, please provide location, shop image, and selfie.');
        return;
      }
    }
    setLoading(true);
    try {
      if (isCompleting) {
        const created = await visitService.createVisit({
          dealerId: formData.clientId,
          employeeId: formData.employeeId,
          routeId: formData.routeId || undefined,
          visitDate: formData.visitDate || undefined,
          status: 'todo',
        } as any);
        const newId = (created as { _id: string })._id;
        const completionImages: VisitCompletionImage[] = [
          { type: 'shop', url: shopImageUrl },
          { type: 'selfie', url: selfieImageUrl },
        ];
        await visitService.completeVisit(newId, {
          latitude: latitude as number,
          longitude: longitude as number,
          completionImages,
        });
        toast.success('Visit created and marked as completed');
        router.push(`/visits/${newId}`);
      } else {
        await visitService.createVisit({
          dealerId: formData.clientId,
          employeeId: formData.employeeId,
          routeId: formData.routeId || undefined,
          visitDate: formData.visitDate || undefined,
          status: formData.status as Visit['status'],
        });
        toast.success('Visit created successfully');
        router.push('/visits');
      }
    } catch (error: unknown) {
      const msg =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(msg || 'Failed to create visit');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Schedule Visit</h1>
          <button className={styles.backButton} onClick={() => router.push('/visits')}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="clientId">Client *</label>
            <SearchableSelect
              id="clientId"
              name="clientId"
              value={formData.clientId}
              onChange={handleChange}
              className={styles.select}
              placeholder="Select a client"
              options={[
                { value: '', label: 'Select a client' },
                ...clients.map((d) => ({ value: d._id, label: formatClientSelectLabel(d) })),
              ]}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="employeeId">Employee *</label>
            <SearchableSelect
              id="employeeId"
              name="employeeId"
              value={formData.employeeId}
              onChange={handleChange}
              className={styles.select}
              placeholder="Select an employee"
              options={[
                { value: '', label: 'Select an employee' },
                ...employees.map((e) => ({
                  value: e._id,
                  label: `${e.username} — ${e.role}`,
                })),
              ]}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="routeId">Route (optional)</label>
            <SearchableSelect
              id="routeId"
              name="routeId"
              value={formData.routeId}
              onChange={handleChange}
              className={styles.select}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...routes.map((r) => ({ value: r._id, label: r.name })),
              ]}
            />
          </div>
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
            <label htmlFor="status">Status</label>
            <SearchableSelect
              id="status"
              name="status"
              value={formData.status}
              onChange={handleChange}
              className={styles.select}
              placeholder="Status"
              options={[
                { value: 'todo', label: 'To Do' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'completed', label: 'Completed' },
                { value: 'incomplete', label: 'Incomplete' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          </div>

          {formData.status === 'completed' && (
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

          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push('/visits')}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Creating...' : 'Schedule Visit'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateVisitPageWrapper() {
  return (
    <ProtectedRoute>
      <CreateVisitPage />
    </ProtectedRoute>
  );
}
