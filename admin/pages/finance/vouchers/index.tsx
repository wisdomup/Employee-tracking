import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  voucherService,
  Voucher,
  VoucherCategory,
  VoucherStatus,
  VOUCHER_CATEGORIES,
  VOUCHER_CATEGORY_LABELS,
  VOUCHER_STATUS_LABELS,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Vouchers.
 *
 * The approval queue sits at the top for the same reason it does on expenses: a voucher waiting is
 * money that has already moved in the real world and has not yet reached the books.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const STATUS_CLASS: Record<VoucherStatus, string> = {
  draft: 'status_draft',
  submitted: 'status_draft',
  approved: 'status_draft',
  rejected: 'status_void',
  posted: 'status_posted',
  cancelled: 'status_void',
};

const VouchersPage: React.FC = () => {
  const router = useRouter();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [waiting, setWaiting] = useState<Voucher[]>([]);
  const [approved, setApproved] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, queue, ready] = await Promise.all([
        voucherService.list({
          category: (category || undefined) as VoucherCategory | undefined,
          status: status === 'all' ? 'all' : (status as VoucherStatus),
          search: search.trim() || undefined,
          from,
          to,
        }),
        voucherService.list({ status: 'submitted' }),
        voucherService.list({ status: 'approved' }),
      ]);
      setVouchers(list);
      setWaiting(queue);
      setApproved(ready);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the vouchers');
    } finally {
      setLoading(false);
    }
  }, [category, status, search, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const waitingValue = waiting.reduce((sum, v) => sum + v.amount, 0);

  const columns = [
    {
      key: 'reference',
      title: 'Ref',
      render: (value: string, row: Voucher) => (
        <div>
          <span className={styles.code}>{value}</span>
          <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
            {row.category}
          </div>
        </div>
      ),
    },
    {
      key: 'voucherDate',
      title: 'Date',
      render: (v: string) => new Date(v).toLocaleDateString('en-PK'),
    },
    {
      key: 'categoryLabel',
      title: 'Kind',
      render: (v: string, row: Voucher) => (
        <div>
          {v}
          {row.partyName && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              {row.partyName}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'narration',
      title: 'What for',
      render: (v: string, row: Voucher) => (
        <div>
          {v}
          {row.paymentReference && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              {row.paymentReference}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      title: 'Amount',
      render: (v: number) => <span className={styles.amount}>{money(v)}</span>,
    },
    {
      key: 'status',
      title: 'Status',
      render: (v: VoucherStatus) => (
        <span className={`${styles.status} ${styles[STATUS_CLASS[v]]}`}>
          {VOUCHER_STATUS_LABELS[v]}
        </span>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Vouchers</h1>
          {can(undefined, 'finance-vouchers:add') && (
            <button
              className={listStyles.addButton}
              onClick={() => router.push('/finance/vouchers/create')}
            >
              + Raise a Voucher
            </button>
          )}
        </div>

        <FinanceNav />

        {waiting.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>
              {waiting.length} voucher{waiting.length === 1 ? ' is' : 's are'} waiting for
              approval · {money(waitingValue)}
            </span>
            {can(undefined, 'finance-vouchers:change')
              ? 'Open each one to approve it or send it back.'
              : 'Somebody allowed to approve vouchers needs to look at these.'}{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setStatus('submitted');
              }}
            >
              Show only these
            </a>
          </div>
        )}

        {approved.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>
              {approved.length} approved, not yet posted
            </span>
            Approving is not posting. Until these are posted they have not reached the accounts.{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setStatus('approved');
              }}
            >
              Show only these
            </a>
          </div>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <input
                type="text"
                className={listStyles.searchInput}
                placeholder="Search what for, cheque or slip number, or shop…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={listStyles.searchSelect}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Kind"
              >
                <option value="">Every kind</option>
                {VOUCHER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c} — {VOUCHER_CATEGORY_LABELS[c]}
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
                {(Object.keys(VOUCHER_STATUS_LABELS) as VoucherStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {VOUCHER_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className={listStyles.searchInput}
                style={{ maxWidth: '11rem' }}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From"
              />
              <input
                type="date"
                className={listStyles.searchInput}
                style={{ maxWidth: '11rem' }}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To"
              />
            </div>

            <Table
              columns={columns}
              data={vouchers}
              loading={loading}
              onRowClick={(row: Voucher) => router.push(`/finance/vouchers/${row.id}`)}
              exportFileName="vouchers"
              exportPdfTitle="Vouchers"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function VouchersPageWrapper() {
  return (
    <ProtectedRoute permission="finance-vouchers:view">
      <VouchersPage />
    </ProtectedRoute>
  );
}
