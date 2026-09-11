import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  expenseCategoryService,
  expenseService,
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  ExpenseSummary,
  EXPENSE_STATUS_LABELS,
  PaymentMethod,
  PAYMENT_METHOD_LABELS,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Expenses.
 *
 * The approval queue is the first thing on the screen, because a waiting expense is money
 * somebody has already spent out of their own float and is waiting to be made good on.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const STATUS_CLASS: Record<ExpenseStatus, string> = {
  draft: 'status_draft',
  pending_approval: 'status_draft',
  rejected: 'status_void',
  posted: 'status_posted',
  cancelled: 'status_void',
};

const ExpensesPage: React.FC = () => {
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [waiting, setWaiting] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [unclearedOnly, setUnclearedOnly] = useState(false);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum, queue] = await Promise.all([
        expenseService.list({
          status: status === 'all' ? undefined : status,
          categoryId: categoryId || undefined,
          method: method || undefined,
          search: search.trim() || undefined,
          unclearedCheques: unclearedOnly || undefined,
          from,
          to,
        }),
        expenseService.summary({ from, to }),
        expenseService.list({ status: 'pending_approval' }),
      ]);
      setExpenses(list);
      setSummary(sum);
      setWaiting(queue);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the expenses');
    } finally {
      setLoading(false);
    }
  }, [status, categoryId, method, search, unclearedOnly, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    expenseCategoryService
      .list('all')
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const waitingValue = waiting.reduce((sum, e) => sum + e.totalAmount, 0);

  const columns = [
    {
      key: 'reference',
      title: 'Ref',
      render: (value: string, row: Expense) => (
        <div>
          <span className={styles.code}>{value}</span>
          {row.isChequeUncleared && <span className={styles.flag}>Not cleared</span>}
        </div>
      ),
    },
    {
      key: 'expenseDate',
      title: 'Date',
      render: (v: string) => new Date(v).toLocaleDateString('en-PK'),
    },
    {
      key: 'categoryName',
      title: 'Category',
      render: (v: string, row: Expense) => (
        <div>
          {v}
          <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
            {row.ledgerCode} · {row.ledgerName}
          </div>
        </div>
      ),
    },
    {
      key: 'description',
      title: 'What for',
      render: (v: string, row: Expense) => (
        <div>
          {v}
          {(row.vendorName || row.payeeName) && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              {row.vendorName || row.payeeName}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'totalAmount',
      title: 'Paid out',
      render: (v: number, row: Expense) => (
        <span className={styles.amount}>
          {money(v)}
          {row.taxAmount > 0 && (
            <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
              incl. {money(row.taxAmount)} tax
            </div>
          )}
        </span>
      ),
    },
    {
      key: 'method',
      title: 'How',
      render: (v: PaymentMethod, row: Expense) => (
        <div>
          {PAYMENT_METHOD_LABELS[v]}
          <div className={styles.muted} style={{ fontSize: '0.76rem' }}>
            {row.paidFromName}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (v: ExpenseStatus) => (
        <span className={`${styles.status} ${styles[STATUS_CLASS[v]]}`}>
          {EXPENSE_STATUS_LABELS[v]}
        </span>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Expenses</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {can(undefined, 'finance-expense-categories:view') && (
              <button
                className={listStyles.addButton}
                style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
                onClick={() => router.push('/finance/expenses/categories')}
              >
                Categories &amp; Limits
              </button>
            )}
            {can(undefined, 'finance-expenses:add') && (
              <button
                className={listStyles.addButton}
                onClick={() => router.push('/finance/expenses/create')}
              >
                + Record an Expense
              </button>
            )}
          </div>
        </div>

        <FinanceNav />

        {waiting.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className={styles.bannerTitle}>
              {waiting.length} expense{waiting.length === 1 ? ' is' : 's are'} waiting for
              approval · {money(waitingValue)}
            </span>
            {can(undefined, 'finance-expenses:change')
              ? 'Open each one to approve it or send it back. You cannot approve one you submitted yourself.'
              : 'Somebody allowed to approve expenses needs to look at these.'}{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setUnclearedOnly(false);
                setStatus('pending_approval');
              }}
            >
              Show only these
            </a>
          </div>
        )}

        <div className={styles.panel}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginBottom: '0.75rem',
            }}
          >
            <h2 className={styles.panelTitle} style={{ margin: 0 }}>
              Spent, by category
            </h2>
            <input
              type="date"
              className={listStyles.searchInput}
              style={{ maxWidth: '11rem' }}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From"
            />
            <span className={styles.muted}>to</span>
            <input
              type="date"
              className={listStyles.searchInput}
              style={{ maxWidth: '11rem' }}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To"
            />
          </div>

          {summary && summary.rows.length === 0 ? (
            <p className={styles.readonlyNote} style={{ margin: 0 }}>
              Nothing posted in these dates. Expenses waiting for approval are not counted until
              they post.
            </p>
          ) : (
            summary && (
              <table className={styles.roleTable}>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Expenses</th>
                    <th style={{ textAlign: 'right' }}>Spent</th>
                    <th style={{ textAlign: 'right' }}>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.categoryId}>
                      <td>{r.categoryName}</td>
                      <td className={styles.amount}>{r.count}</td>
                      <td className={styles.amount}>{money(r.amount)}</td>
                      <td className={styles.amount}>{r.taxAmount ? money(r.taxAmount) : '—'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    <td className={styles.amount} style={{ fontWeight: 600 }}>{summary.count}</td>
                    <td className={styles.amount} style={{ fontWeight: 600 }}>
                      {money(summary.amount)}
                    </td>
                    <td className={styles.amount} style={{ fontWeight: 600 }}>
                      {summary.taxAmount ? money(summary.taxAmount) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            )
          )}
        </div>

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <input
                type="text"
                className={listStyles.searchInput}
                placeholder="Search what for, who was paid, cheque or reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={listStyles.searchSelect}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label="Category"
              >
                <option value="">Every category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? '' : ' (retired)'}
                  </option>
                ))}
              </select>
              <select
                className={listStyles.searchSelect}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status"
                disabled={unclearedOnly}
              >
                <option value="all">Every status</option>
                {(Object.keys(EXPENSE_STATUS_LABELS) as ExpenseStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {EXPENSE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                className={listStyles.searchSelect}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                aria-label="Paid by"
                disabled={unclearedOnly}
              >
                <option value="">Any method</option>
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
              <label className={styles.settingLabel} style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={unclearedOnly}
                  onChange={(e) => setUnclearedOnly(e.target.checked)}
                />
                Uncleared cheques only
              </label>
            </div>

            <Table
              columns={columns}
              data={expenses}
              loading={loading}
              onRowClick={(row: Expense) => router.push(`/finance/expenses/${row.id}`)}
              exportFileName="expenses"
              exportPdfTitle="Expenses"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ExpensesPageWrapper() {
  return (
    <ProtectedRoute permission="finance-expenses:view">
      <ExpensesPage />
    </ProtectedRoute>
  );
}
