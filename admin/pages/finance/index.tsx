import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Layout from '../../components/Layout/Layout';
import Loader from '../../components/UI/Loader';

/**
 * The module's landing route. The sidebar links here rather than deep into a sub-page so the
 * nav highlighting works on `startsWith('/finance')`, the same arrangement `/warehouse` and
 * `/collection` use.
 *
 * Redirects to the chart of accounts, which is the only surface this step ships. When journal
 * entries arrive this becomes a real overview instead.
 */
const FinanceIndexPage: React.FC = () => {
  const router = useRouter();

  useEffect(() => {
    router.replace('/finance/chart');
  }, [router]);

  return (
    <Layout>
      <Loader />
    </Layout>
  );
};

export default function FinanceIndexPageWrapper() {
  return (
    <ProtectedRoute permission="finance-coa:view">
      <FinanceIndexPage />
    </ProtectedRoute>
  );
}
