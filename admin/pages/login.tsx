import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowRight } from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { PasswordInput } from '../components/UI/PasswordInput';
import { AuthSplitLayout, AUTH_MARKETING } from '../components/Auth/AuthSplitLayout';
import styles from '../styles/AuthSplit.module.scss';

const CONTACT_ADMIN_WHATSAPP_URL = 'https://wa.me/923279800153';

const Login: React.FC = () => {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login({ username, password });
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } };
      const errorMessage =
        ax.response?.data?.message || 'Invalid credentials. Please check your username and password.';
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout
      marketingTitle={AUTH_MARKETING.title}
      marketingSubtitle={AUTH_MARKETING.subtitle}
      formTitle="Welcome back!"
      formSubtitle="Enter your company credentials to open your dashboard."
      topRight={
        <span>
          Need an account?{' '}
          <a
            href={CONTACT_ADMIN_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.linkBold}
          >
            Contact admin
          </a>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formGroup}>
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className={styles.input}
            placeholder="your.username"
            autoComplete="username"
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={styles.input}
            placeholder="Minimum 8 characters recommended"
            autoComplete="current-password"
          />
        </div>

        <div className={styles.forgotRow}>
          <button
            type="button"
            onClick={() => router.push('/forgot-password')}
            className={styles.forgotLink}
          >
            Forgot password?
          </button>
        </div>

        <button type="submit" className={styles.primaryBtn} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
          {!loading ? <ArrowRight size={20} weight="bold" aria-hidden /> : null}
        </button>
      </form>
    </AuthSplitLayout>
  );
};

export default Login;
