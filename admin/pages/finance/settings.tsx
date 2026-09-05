import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import FinanceNav from '../../components/Finance/FinanceNav';
import { financeService, FinanceSettings } from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * Finance settings: the fiscal year, the currency, and the map from each named engine role to
 * the account it resolves to.
 *
 * Read-only at this step. Nothing posts yet, and offering to re-point an engine role before the
 * posting service exists would let someone break a thing that has not been built.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Plain-language names for the engine roles, grouped the way an accountant would read them. */
const ROLE_SECTIONS: { title: string; roles: [string, string][] }[] = [
  {
    title: 'Money on hand',
    roles: [
      ['officeCash', 'Cash in the office'],
      ['bank', 'Bank account'],
      ['chequesInHand', 'Cheques received, not yet cleared'],
      ['chequesIssued', 'Cheques written, not yet cleared'],
      ['riderCash', 'Cash a rider is carrying'],
      ['onlineInTransit', 'Online payments taken, not yet in the bank'],
    ],
  },
  {
    title: 'Owed to us, owed by us',
    roles: [
      ['arTrade', 'What shops owe'],
      ['apTrade', 'What we owe suppliers'],
      ['grni', 'Stock received before the supplier bill'],
      ['staffAdvances', 'Salary advances to staff'],
      ['badDebt', 'Debt written off'],
    ],
  },
  {
    title: 'Stock',
    roles: [
      ['inventorySellable', 'Stock on hand'],
      ['inventoryInTransit', 'Stock moving between warehouses'],
      ['cogs', 'Cost of goods sold'],
      ['damageWriteOff', 'Damaged stock written off'],
      ['transferShrinkage', 'Stock lost in transfer'],
      ['countAdjustment', 'Stock count corrections'],
    ],
  },
  {
    title: 'Sales',
    roles: [
      ['salesGoods', 'Sales'],
      ['salesReturns', 'Sales returns'],
      ['salesDiscounts', 'Discounts given'],
      ['outputTax', 'Tax charged to customers'],
      ['inputTax', 'Tax paid to suppliers'],
    ],
  },
  {
    title: 'Payroll and equity',
    roles: [
      ['salaryExpense', 'Salaries'],
      ['salaryPayable', 'Salaries owed'],
      ['retainedEarnings', 'Profit kept in the business'],
      ['openingEquity', 'Opening balance holding account'],
    ],
  },
  {
    title: 'Exceptions',
    roles: [
      ['cashDifference', 'Cash short or over'],
      ['suspense', 'Suspense'],
    ],
  },
];

const FinanceSettingsPage: React.FC = () => {
  const router = useRouter();
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; problems: string[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [settingsData, healthData] = await Promise.all([
          financeService.getSettings(),
          financeService.getHealth(),
        ]);
        setSettings(settingsData);
        setHealth(healthData);
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Could not load the finance settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!settings) {
    return (
      <Layout>
        <div className={listStyles.container}>
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <span className={styles.bannerTitle}>Finance settings are missing</span>
            The chart of accounts has not been seeded on this database. Restart the API, or run
            the chart seed.
          </div>
        </div>
      </Layout>
    );
  }

  const fiscalStart = MONTHS[settings.fiscalYearStartMonth - 1] ?? '—';
  const fiscalEnd = MONTHS[(settings.fiscalYearStartMonth + 10) % 12] ?? '—';

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Finance Settings</h1>
          <button
            className={listStyles.addButton}
            style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
            onClick={() => router.push('/finance/chart')}
          >
            ← Chart of Accounts
          </button>
        </div>

        <FinanceNav />

        {health && (
          <div
            className={`${styles.banner} ${health.ok ? styles.bannerOk : styles.bannerBad}`}
          >
            <span className={styles.bannerTitle}>
              {health.ok
                ? 'Every accounting role points at a live account'
                : 'Some accounting roles are not usable'}
            </span>
            {health.ok ? (
              <>
                The posting engine looks accounts up by role rather than by code, so the chart can
                be renamed and reorganised freely as long as this stays green.
              </>
            ) : (
              <>
                Posting will refuse until these are fixed:
                <ul className={styles.problemList}>
                  {health.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className={styles.settingsGrid}>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Financial year</span>
            <span className={styles.settingValue}>
              {fiscalStart} – {fiscalEnd}
            </span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Currency</span>
            <span className={styles.settingValue}>
              {settings.baseCurrency} ({settings.currencySymbol})
            </span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Overdue buckets</span>
            <span className={styles.settingValue}>
              {settings.agingBuckets.join(' / ')}+ days
            </span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Books opened</span>
            <span className={styles.settingValue}>
              {settings.booksOpenedAt
                ? new Date(settings.booksOpenedAt).toLocaleDateString()
                : 'Not yet'}
            </span>
          </div>
        </div>

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>Automatic posting is switched off</span>
          Sales, collections, settlements and stock movements will post to these accounts by
          themselves once that step is built. Each event has its own switch, and they are turned
          on one at a time so the nightly reconciliation can be watched between each.
        </div>

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <h2 className={styles.panelTitle}>Where each kind of entry goes</h2>

            {ROLE_SECTIONS.map((section) => (
              <div key={section.title} style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem' }}>{section.title}</h3>
                <table className={styles.roleTable}>
                  <thead>
                    <tr>
                      <th>Used for</th>
                      <th>Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.roles.map(([key, label]) => {
                      const mapped = settings.roles[key];
                      return (
                        <tr key={key}>
                          <td>{label}</td>
                          <td>
                            {mapped ? (
                              <>
                                <span className={styles.code}>{mapped.code}</span>{' '}
                                {mapped.name}
                              </>
                            ) : (
                              <span style={{ color: '#b42318', fontWeight: 600 }}>
                                Not set
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function FinanceSettingsPageWrapper() {
  return (
    <ProtectedRoute permission="finance-coa:view">
      <FinanceSettingsPage />
    </ProtectedRoute>
  );
}
