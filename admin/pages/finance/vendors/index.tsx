import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import { vendorService, Vendor, MigrationProgress } from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * The supplier list.
 *
 * Carries the clean-up banner as well, because "some goods receipts are not attached to a
 * supplier" is a fact about this list rather than a separate concern, and hiding it on another
 * screen is how it stays unfinished.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const VendorsPage: React.FC = () => {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, prog] = await Promise.all([
        vendorService.list({ search: search.trim() || undefined, status }),
        vendorService.progress().catch(() => null),
      ]);
      setVendors(list);
      setProgress(prog);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the suppliers');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (vendor: Vendor) => {
    try {
      await vendorService.setStatus(vendor.id, !vendor.isActive);
      toast.success(vendor.isActive ? `${vendor.name} retired` : `${vendor.name} reactivated`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not change the status');
    }
  };

  const remove = async (vendor: Vendor) => {
    if (
      !window.confirm(
        `Delete "${vendor.name}"? This is only possible because nothing has been received from `
          + 'them. If that changes, retire them instead.',
      )
    ) {
      return;
    }
    try {
      await vendorService.remove(vendor.id);
      toast.success(`${vendor.name} deleted`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this supplier');
    }
  };

  const columns = [
    {
      key: 'reference',
      title: 'Ref',
      render: (value: string) => <span className={styles.code}>{value}</span>,
    },
    {
      key: 'name',
      title: 'Supplier',
      render: (value: string, row: Vendor) => (
        <div>
          <div style={{ fontWeight: 500 }}>{value}</div>
          <div style={{ marginTop: '0.2rem' }}>
            {row.isPlaceholder && (
              <span
                className={`${styles.flag}`}
                title="Holding record for receipts whose supplier could not be identified."
              >
                Holding record
              </span>
            )}
            {!row.isActive && <span className={styles.flag}>Retired</span>}
            {row.mergedFromNames.length > 0 && (
              <span
                className={styles.muted}
                style={{ fontSize: '0.76rem' }}
                title={row.mergedFromNames.join('\n')}
              >
                also written as {row.mergedFromNames.length} other name
                {row.mergedFromNames.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      ),
    },
    { key: 'phone', title: 'Phone', render: (v: string) => v || '—' },
    {
      key: 'paymentTermsDays',
      title: 'Terms',
      render: (v: number) => (v > 0 ? `${v} days` : 'On receipt'),
    },
    {
      key: 'receiptCount',
      title: 'Receipts',
      render: (v: number) => <span className={styles.amount}>{v || '—'}</span>,
    },
    {
      key: 'receiptValue',
      title: 'Received',
      render: (v: number) => <span className={styles.amount}>{v ? money(v) : '—'}</span>,
    },
    {
      key: 'actions',
      title: '',
      render: (_: unknown, row: Vendor) => (
        <div className={listStyles.actions}>
          {can(undefined, 'finance-vendors:edit') && !row.isPlaceholder && (
            <button
              className={listStyles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/finance/vendors/${row.id}`);
              }}
            >
              Edit
            </button>
          )}
          {can(undefined, 'finance-vendors:change') && !row.isPlaceholder && (
            <button
              className={listStyles.approveButton}
              onClick={(e) => {
                e.stopPropagation();
                toggle(row);
              }}
            >
              {row.isActive ? 'Retire' : 'Reactivate'}
            </button>
          )}
          {can(undefined, 'finance-vendors:delete')
            && !row.isPlaceholder
            && row.receiptCount === 0 && (
              <button
                className={listStyles.deleteButton}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(row);
                }}
              >
                Delete
              </button>
            )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Suppliers</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {can(undefined, 'finance-vendors:change') && (
              <button
                className={listStyles.addButton}
                style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
                onClick={() => router.push('/finance/vendors/cleanup')}
              >
                Match Typed Names
              </button>
            )}
            {can(undefined, 'finance-vendors:add') && (
              <button
                className={listStyles.addButton}
                onClick={() => router.push('/finance/vendors/create')}
              >
                + Add Supplier
              </button>
            )}
          </div>
        </div>

        <FinanceNav />

        {/* The clean-up is a fact about this list, not a separate concern. Hiding it on another
            screen is how it stays half-finished for a year. */}
        {progress && !progress.complete && (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <span className={styles.bannerTitle}>
              {progress.unlinkedReceipts} goods receipt
              {progress.unlinkedReceipts === 1 ? ' is' : 's are'} not attached to a supplier
            </span>
            Until they are, what you have received cannot be totalled by supplier, and purchase
            bills will have nothing to match against.{' '}
            {can(undefined, 'finance-vendors:change') && (
              <a href="/finance/vendors/cleanup">Match the typed names</a>
            )}
          </div>
        )}

        {progress?.complete && progress.onPlaceholder > 0 && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>
              {progress.onPlaceholder} receipt{progress.onPlaceholder === 1 ? '' : 's'} on the
              holding record
            </span>
            Every receipt is attached to something, so the totals add up — but these are filed
            under "supplier not identified". Move them across as they are recognised.
          </div>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <input
                type="text"
                className={listStyles.searchInput}
                placeholder="Search name, phone, or a name it was written as…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={listStyles.searchSelect}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">Active only</option>
                <option value="inactive">Retired only</option>
                <option value="all">Active and retired</option>
              </select>
            </div>

            <Table
              columns={columns}
              data={vendors}
              loading={loading}
              exportFileName="suppliers"
              exportPdfTitle="Suppliers"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function VendorsPageWrapper() {
  return (
    <ProtectedRoute permission="finance-vendors:view">
      <VendorsPage />
    </ProtectedRoute>
  );
}
