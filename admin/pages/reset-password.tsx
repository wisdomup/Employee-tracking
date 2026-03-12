import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import { toast } from 'react-toastify';
import { PasswordInput } from '../components/UI/PasswordInput';
import styles from '../styles/Login.module.scss';

const ResetPassword: React.FC = () => {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [validatingToken, setValidatingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);

  useEffect(() => {
    const validateToken = async () => {
      const tokenFromUrl = router.query.token as string;
      
      if (!tokenFromUrl) {
        setValidatingToken(false);
        return;
      }

      setToken(tokenFromUrl);
      
      // Validate token by checking if it's valid format (64 hex characters)
      const isValidFormat = /^[a-f0-9]{64}$/i.test(tokenFromUrl);
      
      if (isValidFormat) {
        setTokenValid(true);
      } else {
        toast.error('Invalid reset link');
        setTokenValid(false);
      }
      
      setValidatingToken(false);
    };

    if (router.isReady) {
      validateToken();
    }
  }, [router.isReady, router.query.token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (!token) {
      toast.error('Reset token is missing');
      return;
    }

    setLoading(true);

    try {
      await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/reset-password`,
        { token, newPassword: password }
      );
      
      toast.success('Password reset successfully! Please login with your new password.');
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (error: any) {
      if (error.response?.status === 400) {
        toast.error('This reset link has expired or is invalid. Please request a new one.');
      } else {
        toast.error(error.response?.data?.message || 'Failed to reset password');
      }
    } finally {
      setLoading(false);
    }
  };

  if (validatingToken) {
    return (
      <div className={styles.container}>
        <div className={styles.loginBox}>
          <h1 className={styles.title}>GPS Task Tracker</h1>
          <h2 className={styles.subtitle}>Validating Reset Link...</h2>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⏳</div>
            <p style={{ color: '#6b7280' }}>Please wait while we validate your reset link...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!token || !tokenValid) {
    return (
      <div className={styles.container}>
        <div className={styles.loginBox}>
          <h1 className={styles.title}>GPS Task Tracker</h1>
          <h2 className={styles.subtitle}>Invalid Reset Link</h2>
          
          <div style={{ padding: '1.5rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem', marginBottom: '1.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h3 style={{ color: '#991b1b', fontWeight: 600, marginBottom: '0.5rem' }}>
              Link Expired or Invalid
            </h3>
            <p style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '0' }}>
              This password reset link is invalid or has expired. Reset links are only valid for 1 hour.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              onClick={() => router.push('/forgot-password')}
              className={styles.submitButton}
              style={{ flex: 1 }}
            >
              Request New Link
            </button>
            <button
              type="button"
              onClick={() => router.push('/login')}
              style={{
                flex: 1,
                padding: '0.875rem',
                backgroundColor: '#e5e7eb',
                color: '#374151',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.loginBox}>
        <h1 className={styles.title}>GPS Task Tracker</h1>
        <h2 className={styles.subtitle}>Reset Password</h2>

        <form onSubmit={handleSubmit} className={styles.form}>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Enter your new password below. Make sure it's at least 6 characters long.
          </p>

          <div className={styles.formGroup}>
            <label htmlFor="password">New Password *</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className={styles.input}
              placeholder="Enter new password (min 6 characters)"
              autoComplete="new-password"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="confirmPassword">Confirm Password *</label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className={styles.input}
              placeholder="Confirm your new password"
              autoComplete="new-password"
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              onClick={() => router.push('/login')}
              style={{
                flex: 1,
                padding: '0.875rem',
                backgroundColor: '#e5e7eb',
                color: '#374151',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
              style={{ flex: 1 }}
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
