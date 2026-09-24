import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Layout from '../../components/Layout/Layout';
import Loader from '../../components/UI/Loader';
import { canOpenFinance, visibleFinanceTabs } from '../../utils/financeAccess';

/**
 * The module's landing route. The sidebar links here rather than deep into a sub-page so the
 * nav highlighting works on `startsWith('/finance')`, the same arrangement `/warehouse` and
 * `/collection` use.
 *
 * Sends each person to the first screen they can actually open, in the order the tab bar shows
 * them — the journal first, as the day-to-day screen. Opens for anyone with any finance screen at
 * all: it used to require the Chart of Accounts, which stopped the very people this redirect was
 * written for from ever reaching it.
 */
const FinanceIndexPage: React.FC = () => {
  const router = useRouter();

  useEffect(() => {
    const first = visibleFinanceTabs()[0];
    if (first) router.replace(first.href);
  }, [router]);

  return (
    <Layout>
      <Loader />
    </Layout>
  );
};

export default function FinanceIndexPageWrapper() {
  return (
    <ProtectedRoute allowIf={canOpenFinance}>
      <FinanceIndexPage />
    </ProtectedRoute>
  );
}
