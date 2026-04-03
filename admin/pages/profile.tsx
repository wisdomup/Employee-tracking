import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout/Layout';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
import { ImageUpload } from '../components/UI/ImageUpload';
import Loader from '../components/UI/Loader';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/profileService';
import { ALL_ROLES } from '../utils/permissions';
import { toast } from 'react-toastify';
import styles from '../styles/FormPage.module.scss';

const ProfilePage: React.FC = () => {
  const { refreshUser } = useAuth();
  const [fetchLoading, setFetchLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    userID: '',
    role: '',
    username: '',
    phone: '',
    email: '',
    profileImage: '',
    address: {
      street: '',
      city: '',
      state: '',
      country: '',
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await profileService.getProfileDocument();
        if (cancelled) return;
        setFormData({
          userID: data.userID || '',
          role: data.role || '',
          username: data.username || '',
          phone: data.phone || '',
          email: data.email || '',
          profileImage: data.profileImage || '',
          address: {
            street: data.address?.street || '',
            city: data.address?.city || '',
            state: data.address?.state || '',
            country: data.address?.country || '',
          },
        });
      } catch {
        toast.error('Failed to load profile');
      } finally {
        if (!cancelled) setFetchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name.startsWith('address.')) {
      const key = name.split('.')[1] as keyof typeof formData.address;
      setFormData((prev) => ({
        ...prev,
        address: { ...prev.address, [key]: value },
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.username.trim()) {
      toast.error('Username is required');
      return;
    }
    if (!formData.phone.trim()) {
      toast.error('Phone is required');
      return;
    }
    setLoading(true);
    try {
      await profileService.updateProfile({
        username: formData.username.trim(),
        phone: formData.phone.trim(),
        email: formData.email.trim(),
        address: {
          street: formData.address.street,
          city: formData.address.city,
          state: formData.address.state,
          country: formData.address.country,
        },
        profileImage: formData.profileImage || '',
      });
      try {
        await refreshUser();
      } catch {
        toast.success('Profile updated');
        toast.warning('Could not refresh session; reload the page if the header looks out of date.');
        return;
      }
      toast.success('Profile updated');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string; errors?: string[] } } }).response?.data
              ?.message ||
            (err as { response?: { data?: { errors?: string[] } } }).response?.data?.errors?.join(', ')
          : null;
      toast.error(msg || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>My profile</h1>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="userID">User ID</label>
              <input id="userID" className={styles.input} value={formData.userID} readOnly disabled />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="role">Role</label>
              <input id="role" className={styles.input} value={formData.role} readOnly disabled />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="username">Username *</label>
            <input
              id="username"
              name="username"
              className={styles.input}
              value={formData.username}
              onChange={handleChange}
              required
              autoComplete="username"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="phone">Phone *</label>
            <input
              id="phone"
              name="phone"
              className={styles.input}
              value={formData.phone}
              onChange={handleChange}
              required
              autoComplete="tel"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              className={styles.input}
              value={formData.email}
              onChange={handleChange}
              autoComplete="email"
            />
          </div>

          <ImageUpload
            value={formData.profileImage}
            onChange={(url) => setFormData((prev) => ({ ...prev, profileImage: url }))}
            category="profiles"
            label="Profile image"
          />

          <div className={styles.formGroup}>
            <label htmlFor="address.street">Street</label>
            <input
              id="address.street"
              name="address.street"
              className={styles.input}
              value={formData.address.street}
              onChange={handleChange}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="address.city">City</label>
              <input
                id="address.city"
                name="address.city"
                className={styles.input}
                value={formData.address.city}
                onChange={handleChange}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="address.state">State</label>
              <input
                id="address.state"
                name="address.state"
                className={styles.input}
                value={formData.address.state}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="address.country">Country</label>
            <input
              id="address.country"
              name="address.country"
              className={styles.input}
              value={formData.address.country}
              onChange={handleChange}
            />
          </div>

          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#6b7280' }}>
            To change your password, use{' '}
            <Link href="/change-password" style={{ color: 'var(--admin-primary, #2563eb)' }}>
              Change password
            </Link>
            .
          </p>

          <div className={styles.formActions}>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function ProfilePageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <ProfilePage />
    </ProtectedRoute>
  );
}
