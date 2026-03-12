import React, { useState } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import { toast } from 'react-toastify';
import styles from '../styles/Login.module.scss';

const ForgotPassword: React.FC = () => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/forgot-password`,
        { email }
      );
      
      setEmailSent(true);
      toast.success('Password reset link has been sent to your email!');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginBox}>
        <h1 className={styles.title}>GPS Task Tracker</h1>
        <h2 className={styles.subtitle}>Forgot Password</h2>

        {!emailSent ? (
          <form onSubmit={handleSubmit} className={styles.form}>
            <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Enter your email address and we'll send you a link to reset your password.
            </p>

            <div className={styles.formGroup}>
              <label htmlFor="email">Email Address</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={styles.input}
                placeholder="Enter your email address"
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className={styles.cancelButton}
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
              <button
                type="submit"
                className={styles.submitButton}
                disabled={loading}
                style={{ flex: 1 }}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.form}>
            <div
              style={{
                padding: '1.5rem',
                backgroundColor: '#d1fae5',
                borderRadius: '0.5rem',
                marginBottom: '1.5rem',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✉️</div>
              <h3 style={{ color: '#065f46', fontWeight: 600, marginBottom: '0.5rem' }}>
                Check Your Email
              </h3>
              <p style={{ color: '#047857', fontSize: '0.875rem', marginBottom: '0' }}>
                We've sent a password reset link to <strong>{email}</strong>
              </p>
            </div>

            <div style={{ padding: '1rem', backgroundColor: '#fff3cd', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
              <p style={{ color: '#856404', fontSize: '0.875rem', margin: 0 }}>
                <strong>⚠️ Note:</strong> The link will expire in 1 hour. If you don't see the email, check your spam folder.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push('/login')}
              className={styles.submitButton}
              style={{ width: '100%' }}
            >
              Back to Login
            </button>

            <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
              Didn't receive the email?{' '}
              <button
                type="button"
                onClick={() => {
                  setEmailSent(false);
                  setEmail('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#3b82f6',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Try again
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
