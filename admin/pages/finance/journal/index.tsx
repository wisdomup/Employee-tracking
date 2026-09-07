import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  journalService,
  sourceTypeLabel,
  SOURCE_TYPE_LABELS,
  JournalEntry,
  EntryStatus,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Every journal entry, newest first.
 *
 * Drafts and posted entries share one list on purpose. An accountant's real question is "what
 * is outstanding", and splitting the two into separate screens is how a draft gets forgotten
 * for a month and then blocks the close.
 */

const STATUS_LABEL: Record<EntryStatus, string> = {
  draft: 'Draft',
  posted: 'Posted',
  reversed: 'Reversed',
  void: 'Void',
};

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const JournalPage: React.FC = () => {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await journalService.list({
        status: status || undefined,
        sourceType: sourceType || undefined,
        search: search.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 200,
      });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the journal');
    } finally {
      setLoading(false);
    }
  }, [status, sourceType, search, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      key: 'entryNo',
      title: '#',
      render: (value: number | undefined) => (
        <span className={styles.code}>{value ?? '—'}</span>
      ),
    },
    {
      key: 'date',
      title: 'Date',
      render: (value: string) => new Date(value).toLocaleDateString(),
    },
    {
      key: 'narration',
      title: 'Description',
      render: (value: string, row: JournalEntry) => (
        <div>
          <div style={{ fontWeight: 500 }}>{value || '—'}</div>
          <div className={styles.muted} style={{ fontSize: '0.78rem', marginTop: '0.15rem' }}>
            {sourceTypeLabel(row.sourceType)}
            {row.referenceNo ? ` · ${row.referenceNo}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'postingPeriod',
      title: 'Month',
      render: (value: string) => <span className={styles.muted}>{value}</span>,
    },
    {
      key: 'totalDebit',
      title: 'Amount',
      render: (value: number) => <span className={styles.amount}>{money(value)}</span>,
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: EntryStatus) => (
        <span className={`${styles.status} ${styles[`status_${value}`]}`}>
          {STATUS_LABEL[value]}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '',
      render: (_: unknown, row: JournalEntry) => (
        <div className={listStyles.actions}>
          <button
            className={listStyles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/finance/journal/${row._id}`);
            }}
          >
            {row.status === 'draft' ? 'Open' : 'View'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Journal</h1>
          {can(undefined, 'finance-journal:add') && (
            <button
              className={listStyles.addButton}
              onClick={() => router.push('/finance/journal/create')}
            >
              + New Entry
            </button>
          )}
        </div>

        <FinanceNav />

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <input
                type="text"
                className={listStyles.searchInput}
                placeholder="Search description, reference or entry number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={listStyles.searchSelect}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="draft">Drafts only</option>
                <option value="posted">Posted</option>
                <option value="reversed">Reversed</option>
              </select>
              {/*
                Filtering by where an entry came from is the question people actually arrive
                with — "show me everything the deliveries did" — and it is the only way to find
                system entries, which carry no reference number to search on.
              */}
              <select
                className={listStyles.searchSelect}
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                aria-label="Where the entry came from"
              >
                <option value="">Everything</option>
                {Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className={listStyles.searchSelect}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From date"
              />
              <input
                type="date"
                className={listStyles.searchSelect}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To date"
              />
            </div>

            {total > entries.length && (
              <p className={styles.readonlyNote}>
                Showing the {entries.length} most recent of {total}. Narrow the dates to see older
                entries.
              </p>
            )}

            <Table
              columns={columns}
              data={entries}
              loading={loading}
              exportFileName="journal"
              exportPdfTitle="Journal Entries"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function JournalPageWrapper() {
  return (
    <ProtectedRoute permission="finance-journal:view">
      <JournalPage />
    </ProtectedRoute>
  );
}
