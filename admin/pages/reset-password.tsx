import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import axios from 'axios';
import { toast } from 'react-toastify';
import { PasswordInput } from '../components/UI/PasswordInput';
import { AuthSplitLayout, AUTH_MARKETING } from '../components/Auth/AuthSplitLayout';
import styles from '../styles/AuthSplit.module.scss';

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
      await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/auth/reset-password`, {
        token,
        newPassword: password,
      });

      toast.success('Password reset successfully! Please sign in with your new password.');
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (error: unknown) {
      const ax = error as { response?: { status?: number; data?: { message?: string } } };
      if (ax.response?.status === 400) {
        toast.error('This reset link has expired or is invalid. Please request a new one.');
      } else {
        toast.error(ax.response?.data?.message || 'Failed to reset password');
      }
    } finally {
      setLoading(false);
    }
  };

  const topLink = (
    <Link href="/login" className={styles.plainLink}>
      Back to sign in
    </Link>
  );

  if (validatingToken) {
    return (
      <AuthSplitLayout
        marketingTitle={AUTH_MARKETING.title}
        marketingSubtitle={AUTH_MARKETING.subtitle}
        formTitle="Checking your link"
        formSubtitle="Please wait a moment."
        topRight={topLink}
      >
        <div className={styles.centerMuted} style={{ padding: '2rem 0' }}>
          <p style={{ marginBottom: '0.5rem', fontSize: '2rem' }} aria-hidden>
            ⏳
          </p>
          <p>Validating your reset link…</p>
        </div>
      </AuthSplitLayout>
    );
  }

  if (!token || !tokenValid) {
    return (
      <AuthSplitLayout
        marketingTitle={AUTH_MARKETING.title}
        marketingSubtitle={AUTH_MARKETING.subtitle}
        formTitle="Link expired or invalid"
        formSubtitle="Reset links only work for a short time for your security."
        topRight={topLink}
      >
        <div className={styles.warnCard}>
          <h3 style={{ color: '#991b1b', fontWeight: 700, marginBottom: '0.35rem', fontSize: '1rem' }}>
            We couldn&apos;t use this link
          </h3>
          <p style={{ color: '#b91c1c', fontSize: '0.875rem', margin: 0, lineHeight: 1.5 }}>
            Request a new password reset email and open the latest link we send you.
          </p>
        </div>

        <div className={styles.btnRow}>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className={styles.secondaryBtn}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => router.push('/forgot-password')}
            className={styles.primaryBtn}
          >
            New reset link
          </button>
        </div>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout
      marketingTitle={AUTH_MARKETING.title}
      marketingSubtitle={AUTH_MARKETING.subtitle}
      formTitle="Choose a new password"
      formSubtitle="Use at least 6 characters. Longer passphrases are safer."
      topRight={topLink}
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formGroup}>
          <label htmlFor="password">New password</label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className={styles.input}
            placeholder="Enter a new password"
            autoComplete="new-password"
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="confirmPassword">Confirm password</label>
          <PasswordInput
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            className={styles.input}
            placeholder="Re-enter your new password"
            autoComplete="new-password"
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
            {loading ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </form>
    </AuthSplitLayout>
  );
};

export default ResetPassword;
