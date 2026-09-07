import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import { billService, vendorService, Bill, Vendor } from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Supplier bills.
 *
 * Overdue is surfaced as a filter and a flag rather than as a separate screen, because "what is
 * due" and "what have we recorded" are the same list read two ways, and splitting them is how
 * one of the two stops being looked at.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const BillsPage: React.FC = () => {
  const router = useRouter();
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [vendorId, setVendorId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBills(
        await billService.list({
          status: status === 'all' ? undefined : status,
          vendorId: vendorId || undefined,
          overdue: overdue || undefined,
          search: search.trim() || undefined,
        }),
      );
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the bills');
    } finally {
      setLoading(false);
    }
  }, [status, vendorId, overdue, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    vendorService
      .list({ status: 'all' })
      .then(setVendors)
      .catch(() => undefined);
  }, []);

  const outstanding = bills
    .filter((b) => b.status === 'posted')
    .reduce((sum, b) => sum + b.totalAmount, 0);
  const overdueCount = bills.filter((b) => b.isOverdue).length;

  const columns = [
    {
      key: 'reference',
      title: 'Ref',
      render: (value: string, row: Bill) => (
        <div>
          <span className={styles.code}>{value}</span>
          {row.supplierBillNo && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              {row.supplierBillNo}
            </div>
          )}
        </div>
      ),
    },
    { key: 'vendorName', title: 'Supplier' },
    {
      key: 'billDate',
      title: 'Dated',
      render: (v: string) => new Date(v).toLocaleDateString('en-PK'),
    },
    {
      key: 'dueDate',
      title: 'Due',
      render: (v: string, row: Bill) => (
        <span className={row.isOverdue ? styles.amountNegative : undefined}>
          {new Date(v).toLocaleDateString('en-PK')}
          {row.isOverdue && <span className={styles.flag}>Overdue</span>}
        </span>
      ),
    },
    {
      key: 'goodsAmount',
      title: 'Goods',
      render: (v: number, row: Bill) => (
        <span className={styles.amount}>
          {v ? money(v) : '—'}
          {row.receiptCount > 0 && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              {row.receiptCount} receipt{row.receiptCount === 1 ? '' : 's'}
            </div>
          )}
        </span>
      ),
    },
    {
      key: 'totalAmount',
      title: 'Total',
      render: (v: number) => <span className={styles.amount}>{money(v)}</span>,
    },
    {
      key: 'status',
      title: 'Status',
      render: (v: Bill['status']) => (
        <span
          className={`${styles.status} ${
            v === 'posted'
              ? styles.status_posted
              : v === 'cancelled'
                ? styles.status_void
                : styles.status_draft
          }`}
        >
          {v === 'posted' ? 'Posted' : v === 'cancelled' ? 'Cancelled' : 'Draft'}
        </span>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Supplier Bills</h1>
          {can(undefined, 'finance-bills:add') && (
            <button
              className={listStyles.addButton}
              onClick={() => router.push('/finance/bills/create')}
            >
              + Record a Bill
            </button>
          )}
        </div>

        <FinanceNav />

        {overdueCount > 0 && (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <span className={styles.bannerTitle}>
              {overdueCount} bill{overdueCount === 1 ? ' is' : 's are'} past their due date
            </span>
            Shown against the terms agreed with each supplier. Payment is recorded separately —
            this says what has fallen due, not what is unpaid.
          </div>
        )}

        <div className={styles.settingsGrid}>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Bills listed</span>
            <span className={styles.settingValue}>{bills.length}</span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Posted, in this list</span>
            <span className={styles.settingValue}>{money(outstanding)}</span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Past due</span>
            <span
              className={styles.settingValue}
              style={overdueCount > 0 ? { color: '#b91c1c' } : undefined}
            >
              {overdueCount}
            </span>
          </div>
        </div>

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <input
                type="text"
                className={listStyles.searchInput}
                placeholder="Search their invoice number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={listStyles.searchSelect}
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                aria-label="Supplier"
              >
                <option value="">Every supplier</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <select
                className={listStyles.searchSelect}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status"
              >
                <option value="all">Every status</option>
                <option value="draft">Drafts only</option>
                <option value="posted">Posted only</option>
                <option value="cancelled">Cancelled only</option>
              </select>
              <label className={styles.settingLabel} style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={overdue}
                  onChange={(e) => setOverdue(e.target.checked)}
                />
                Past due only
              </label>
            </div>

            <Table
              columns={columns}
              data={bills}
              loading={loading}
              onRowClick={(row: Bill) => router.push(`/finance/bills/${row.id}`)}
              exportFileName="supplier-bills"
              exportPdfTitle="Supplier Bills"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function BillsPageWrapper() {
  return (
    <ProtectedRoute permission="finance-bills:view">
      <BillsPage />
    </ProtectedRoute>
  );
}
