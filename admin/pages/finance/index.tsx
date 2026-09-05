import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Layout from '../../components/Layout/Layout';
import Loader from '../../components/UI/Loader';
import { can, canViewAnyReportOn } from '../../utils/permissions';

/**
 * The module's landing route. The sidebar links here rather than deep into a sub-page so the
 * nav highlighting works on `startsWith('/finance')`, the same arrangement `/warehouse` and
 * `/collection` use.
 *
 * Redirects to whichever surface the person can actually open. The journal is the day-to-day
 * screen, so it goes first; someone granted only the chart still lands somewhere useful rather
 * than on a refusal.
 */
const FinanceIndexPage: React.FC = () => {
  const router = useRouter();

  useEffect(() => {
    if (can(undefined, 'finance-journal:view')) router.replace('/finance/journal');
    else if (canViewAnyReportOn('finance.')) router.replace('/finance/reports');
    else router.replace('/finance/chart');
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
