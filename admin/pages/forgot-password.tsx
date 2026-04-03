import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import axios from 'axios';
import { toast } from 'react-toastify';
import { AuthSplitLayout, APP_NAME, AUTH_MARKETING } from '../components/Auth/AuthSplitLayout';
import styles from '../styles/AuthSplit.module.scss';

const ForgotPassword: React.FC = () => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/auth/forgot-password`, { email });

      setEmailSent(true);
      toast.success('Password reset link has been sent to your email!');
    } catch (error: unknown) {
      const ax = error as { response?: { data?: { message?: string } } };
      toast.error(ax.response?.data?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout
      marketingTitle={AUTH_MARKETING.title}
      marketingSubtitle={AUTH_MARKETING.subtitle}
      formTitle="Reset your password"
      formSubtitle={
        emailSent
          ? 'Check your inbox for the next step.'
          : "We'll email you a secure link to choose a new password."
      }
      topRight={
        <Link href="/login" className={styles.plainLink}>
          Back to sign in
        </Link>
      }
    >
      {!emailSent ? (
        <form onSubmit={handleSubmit} className={styles.form}>
          <p className={styles.hint}>
            Use the email address associated with your {APP_NAME} account.
          </p>

          <div className={styles.formGroup}>
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={styles.input}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          <div className={styles.btnRow}>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className={styles.secondaryBtn}
            >
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={loading}>
              {loading ? 'Sending…' : 'Send link'}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.form}>
          <div className={styles.successCard}>
            <h3 style={{ color: '#065f46', fontWeight: 700, marginBottom: '0.35rem', fontSize: '1rem' }}>
              Check your email
            </h3>
            <p style={{ color: '#047857', fontSize: '0.875rem', margin: 0, lineHeight: 1.5 }}>
              We sent a reset link to <strong>{email}</strong>
            </p>
          </div>

          <p className={styles.hint} style={{ marginBottom: '1rem' }}>
            The link expires in about an hour. If you don&apos;t see the message, check spam or promotions.
          </p>

          <button
            type="button"
            onClick={() => router.push('/login')}
            className={styles.primaryBtn}
          >
            Back to sign in
          </button>

          <p className={styles.centerMuted} style={{ marginTop: '1rem' }}>
            Didn&apos;t receive it?{' '}
            <button
              type="button"
              className={styles.forgotLink}
              onClick={() => {
                setEmailSent(false);
                setEmail('');
              }}
            >
              Try again
            </button>
          </p>
        </div>
      )}
    </AuthSplitLayout>
  );
};

export default ForgotPassword;
