import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../components/Layout/Layout';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
import api from '../services/api';
import { PasswordInput } from '../components/UI/PasswordInput';
import styles from '../styles/ChangePassword.module.scss';

const ChangePassword: React.FC = () => {
  const router = useRouter();
  const [formData, setFormData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formData.oldPassword || !formData.newPassword || !formData.confirmPassword) {
      toast.error('All fields are required');
      return;
    }

    if (formData.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters long');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('New password and confirm password do not match');
      return;
    }

    if (formData.oldPassword === formData.newPassword) {
      toast.error('New password must be different from the current password');
      return;
    }

    setLoading(true);

    try {
      const response = await api.post('/auth/change-password', {
        oldPassword: formData.oldPassword,
        newPassword: formData.newPassword,
      });

      toast.success(response.data.message || 'Password changed successfully!');
      setFormData({
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      
      // Redirect to dashboard after a delay
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (error: any) {
      console.error('Error changing password:', error);
      const errorMessage = error.response?.data?.message || 'An error occurred while changing password';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard');
  };

  return (
    <ProtectedRoute>
      <Layout>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1 className={styles.title}>Change Password</h1>
            <p className={styles.subtitle}>Update your account password</p>
          </div>

          <div className={styles.card}>
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.formGroup}>
                <label htmlFor="oldPassword" className={styles.label}>
                  Current Password
                </label>
                <PasswordInput
                  id="oldPassword"
                  name="oldPassword"
                  value={formData.oldPassword}
                  onChange={handleChange}
                  placeholder="Enter current password"
                  required
                  autoComplete="current-password"
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="newPassword" className={styles.label}>
                  New Password
                </label>
                <PasswordInput
                  id="newPassword"
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleChange}
                  placeholder="Enter new password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <small className={styles.hint}>Must be at least 6 characters</small>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="confirmPassword" className={styles.label}>
                  Confirm New Password
                </label>
                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Re-enter new password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={handleCancel}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={loading}
                >
                  {loading ? 'Changing Password...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Layout>
    </ProtectedRoute>
  );
};

export default ChangePassword;
