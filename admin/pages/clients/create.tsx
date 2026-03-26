import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { clientService, Client } from '../../services/clientService';
import { routeService, Route } from '../../services/routeService';
import { ImageUpload } from '../../components/UI/ImageUpload';
import MapPicker from '../../components/Map/MapPicker';
import GeolocationPromptDialog from '../../components/UI/GeolocationPromptDialog';
import { useGeolocationPicker } from '../../hooks/useGeolocationPicker';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';

const DEALER_CATEGORIES = [
  { value: '', label: '— Select category —' },
  { value: 'retailer', label: 'Retailer' },
  { value: 'wholesaler', label: 'Wholesaler' },
];

const CreateClientPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    shopName: '',
    phone: '',
    email: '',
    address: {
      street: '',
      city: '',
      state: '',
      country: '',
      postalCode: '',
    },
    latitude: 0,
    longitude: 0,
    shopImage: '',
    profilePicture: '',
    category: '',
    rating: '' as number | '',
    status: 'active' as 'active' | 'inactive',
    routeId: '',
  });

  useEffect(() => {
    routeService.getRoutes().then(setRoutes).catch(() => toast.error('Failed to load routes'));
  }, []);

  const onLocationSuccess = useCallback((lat: number, lng: number) => {
    setFormData((prev) => ({ ...prev, latitude: lat, longitude: lng }));
  }, []);

  const {
    locationLoading,
    geoVariant,
    openPicker,
    confirmConsent,
    closeDialog,
  } = useGeolocationPicker(onLocationSuccess);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    if (name.startsWith('address.')) {
      const addressField = name.split('.')[1];
      setFormData((prev) => ({
        ...prev,
        address: {
          ...prev.address,
          [addressField]: value,
        },
      }));
    } else if (name === 'latitude' || name === 'longitude') {
      setFormData((prev) => ({
        ...prev,
        [name]: parseFloat(value) || 0,
      }));
    } else if (name === 'rating') {
      setFormData((prev) => ({
        ...prev,
        rating: value === '' ? '' : Number(value),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.routeId) {
      toast.error('Please select a route');
      return;
    }
    if (!formData.shopImage) {
      toast.error('Please upload a shop image');
      return;
    }
    if (!formData.profilePicture) {
      toast.error('Please upload a profile picture');
      return;
    }
    if (formData.latitude === 0 && formData.longitude === 0) {
      toast.error('Please pick a client location on the map');
      return;
    }
    if (!formData.category) {
      toast.error('Please select a category');
      return;
    }
    setLoading(true);

    try {
      const addressEntries = Object.entries(formData.address).filter(([, v]) => v);

      const payload: Record<string, unknown> = {
        name: formData.name,
        shopName: formData.shopName,
        phone: formData.phone,
        route: formData.routeId,
        status: formData.status,
        shopImage: formData.shopImage,
        profilePicture: formData.profilePicture,
        latitude: formData.latitude,
        longitude: formData.longitude,
        category: formData.category,
        ...(formData.email         && { email: formData.email }),
        ...(formData.rating !== '' && formData.rating != null && { rating: formData.rating }),
        ...(addressEntries.length > 0 && { address: Object.fromEntries(addressEntries) }),
      };

      await clientService.createClient(payload as Partial<Client>);
      toast.success('Client created successfully');
      router.push('/clients');
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || 'Failed to create client'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Create Client</h1>
          <button
            className={styles.backButton}
            onClick={() => router.push('/clients')}
          >
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="name">Client Name *</label>
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
            <label htmlFor="shopName">Shop Name</label>
            <input
              type="text"
              id="shopName"
              name="shopName"
              value={formData.shopName}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="phone">Phone *</label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              required
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="address.street">Street</label>
            <input
              type="text"
              id="address.street"
              name="address.street"
              value={formData.address.street}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="address.city">City</label>
              <input
                type="text"
                id="address.city"
                name="address.city"
                value={formData.address.city}
                onChange={handleChange}
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="address.state">State</label>
              <input
                type="text"
                id="address.state"
                name="address.state"
                value={formData.address.state}
                onChange={handleChange}
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="address.country">Country</label>
              <input
                type="text"
                id="address.country"
                name="address.country"
                value={formData.address.country}
                onChange={handleChange}
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="address.postalCode">Postal Code</label>
              <input
                type="text"
                id="address.postalCode"
                name="address.postalCode"
                value={formData.address.postalCode}
                onChange={handleChange}
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Client location *</label>
            <p className={styles.hint} style={{ marginBottom: '0.75rem', color: '#6b7280', fontSize: '0.875rem' }}>
              Click on the map to pick a location, or enter latitude and longitude below.
            </p>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => void openPicker()}
              disabled={locationLoading}
              style={{ marginBottom: '0.75rem' }}
            >
              {locationLoading ? 'Getting location…' : 'Use current location'}
            </button>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="latitude">Latitude</label>
                <input
                  type="number"
                  id="latitude"
                  name="latitude"
                  value={formData.latitude === 0 ? '' : formData.latitude}
                  onChange={handleChange}
                  placeholder="e.g. 31.52"
                  min={-90}
                  max={90}
                  step="any"
                  className={styles.input}
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="longitude">Longitude</label>
                <input
                  type="number"
                  id="longitude"
                  name="longitude"
                  value={formData.longitude === 0 ? '' : formData.longitude}
                  onChange={handleChange}
                  placeholder="e.g. 74.35"
                  min={-180}
                  max={180}
                  step="any"
                  className={styles.input}
                />
              </div>
            </div>
            <MapPicker
              latitude={formData.latitude}
              longitude={formData.longitude}
              onLocationSelect={(lat, lng) =>
                setFormData((prev) => ({ ...prev, latitude: lat, longitude: lng }))
              }
              height="300px"
            />
          </div>

          <ImageUpload
            value={formData.shopImage}
            onChange={(url) => setFormData((prev) => ({ ...prev, shopImage: url }))}
            category="shops"
            label="Shop image *"
          />

          <ImageUpload
            value={formData.profilePicture}
            onChange={(url) => setFormData((prev) => ({ ...prev, profilePicture: url }))}
            category="profiles"
            label="Profile picture *"
          />

          <div className={styles.formGroup}>
            <label htmlFor="category">Category *</label>
            <select
              id="category"
              name="category"
              value={formData.category}
              onChange={handleChange}
              className={styles.select}
            >
              {DEALER_CATEGORIES.map((c) => (
                <option key={c.value || 'none'} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="rating">Rating</label>
            <input
              type="number"
              id="rating"
              name="rating"
              value={formData.rating === '' ? '' : formData.rating}
              onChange={handleChange}
              min={0}
              max={5}
              step={0.1}
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="routeId">Route *</label>
            <select
              id="routeId"
              name="routeId"
              value={formData.routeId}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="">— Select route —</option>
              {routes.map((route) => (
                <option key={route._id} value={route._id}>
                  {route.name} ({route.startingPoint} → {route.endingPoint})
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="status">Status</label>
            <select
              id="status"
              name="status"
              value={formData.status}
              onChange={handleChange}
              className={styles.select}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/clients')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </form>

        <GeolocationPromptDialog
          variant={geoVariant}
          onClose={closeDialog}
          onConsentContinue={confirmConsent}
        />
      </div>
    </Layout>
  );
};

export default function CreateClientPageWrapper() {
  return (
    <ProtectedRoute>
      <CreateClientPage />
    </ProtectedRoute>
  );
}
