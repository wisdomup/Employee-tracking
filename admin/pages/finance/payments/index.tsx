import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  paymentService,
  vendorService,
  Payment,
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
  Vendor,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Payments made to suppliers.
 *
 * Drafts waiting to be released are called out at the top, because a payment is usually prepared
 * by one person and released by another — and a draft the second person never sees is a supplier
 * who never gets paid.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PaymentsPage: React.FC = () => {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayments(
        await paymentService.list({
          status: status === 'all' ? undefined : status,
          method: method || undefined,
          vendorId: vendorId || undefined,
          search: search.trim() || undefined,
        }),
      );
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the payments');
    } finally {
      setLoading(false);
    }
  }, [status, method, vendorId, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    vendorService
      .list({ status: 'all' })
      .then((all) => setVendors(all.filter((v) => !v.isPlaceholder)))
      .catch(() => undefined);
  }, []);

  const posted = payments.filter((p) => p.status === 'posted');
  const paidOut = posted.reduce((sum, p) => sum + p.amount, 0);
  const onAccount = posted.reduce((sum, p) => sum + p.unallocatedAmount, 0);
  const waiting = payments.filter((p) => p.status === 'draft');

  const columns = [
    {
      key: 'reference',
      title: 'Ref',
      render: (value: string, row: Payment) => (
        <div>
          <span className={styles.code}>{value}</span>
          {(row.chequeNo || row.transferReference) && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              {row.chequeNo ? `Cheque ${row.chequeNo}` : row.transferReference}
            </div>
          )}
        </div>
      ),
    },
    { key: 'vendorName', title: 'Supplier' },
    {
      key: 'paymentDate',
      title: 'Paid on',
      render: (v: string) => new Date(v).toLocaleDateString('en-PK'),
    },
    {
      key: 'method',
      title: 'How',
      render: (v: PaymentMethod, row: Payment) => (
        <div>
          {PAYMENT_METHOD_LABELS[v]}
          <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
            {row.paidFromName}
          </div>
        </div>
      ),
    },
    {
      key: 'amount',
      title: 'Amount',
      render: (v: number, row: Payment) => (
        <span className={styles.amount}>
          {money(v)}
          {row.billCount > 0 && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              {row.billCount} bill{row.billCount === 1 ? '' : 's'}
            </div>
          )}
        </span>
      ),
    },
    {
      key: 'unallocatedAmount',
      title: 'On account',
      render: (v: number) => <span className={styles.amount}>{v > 0.005 ? money(v) : '—'}</span>,
    },
    {
      key: 'status',
      title: 'Status',
      render: (v: Payment['status']) => (
        <span
          className={`${styles.status} ${
            v === 'posted'
              ? styles.status_posted
              : v === 'cancelled'
                ? styles.status_void
                : styles.status_draft
          }`}
        >
          {v === 'posted' ? 'Paid' : v === 'cancelled' ? 'Cancelled' : 'Awaiting release'}
        </span>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Supplier Payments</h1>
          {can(undefined, 'finance-payments:add') && (
            <button
              className={listStyles.addButton}
              onClick={() => router.push('/finance/payments/create')}
            >
              + Prepare a Payment
            </button>
          )}
        </div>

        <FinanceNav />

        {waiting.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>
              {waiting.length} payment{waiting.length === 1 ? ' is' : 's are'} prepared and
              waiting to be released
            </span>
            {can(undefined, 'finance-payments:change')
              ? 'Open each one, check it against the bills, and release it.'
              : 'Somebody allowed to release payments needs to check and post them.'}
          </div>
        )}

        <div className={styles.settingsGrid}>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Payments listed</span>
            <span className={styles.settingValue}>{payments.length}</span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Paid out, in this list</span>
            <span className={styles.settingValue}>{money(paidOut)}</span>
          </div>
          <div className={styles.settingCard}>
            <span className={styles.settingLabel}>Of which on account</span>
            <span className={styles.settingValue}>{money(onAccount)}</span>
          </div>
        </div>

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <input
                type="text"
                className={listStyles.searchInput}
                placeholder="Search cheque number or transfer reference…"
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
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                aria-label="Paid by"
              >
                <option value="">Any method</option>
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
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
                <option value="draft">Awaiting release</option>
                <option value="posted">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <Table
              columns={columns}
              data={payments}
              loading={loading}
              onRowClick={(row: Payment) => router.push(`/finance/payments/${row.id}`)}
              exportFileName="supplier-payments"
              exportPdfTitle="Supplier Payments"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function PaymentsPageWrapper() {
  return (
    <ProtectedRoute permission="finance-payments:view">
      <PaymentsPage />
    </ProtectedRoute>
  );
}
