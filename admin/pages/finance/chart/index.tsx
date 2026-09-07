import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  financeService,
  AccountGroup,
  AccountType,
  Ledger,
  ACCOUNT_TYPES,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * The chart of accounts: the group tree on the left, the accounts in the selected group on the
 * right.
 *
 * The one thing this screen must communicate that a plain list cannot: which accounts the
 * posting engine depends on. An accountant tidying the chart needs to know before they click,
 * not after a refusal.
 */

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

/** Descendants of a group, so selecting "Assets" shows everything beneath it. */
function collectSubtreeIds(groups: AccountGroup[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const g of groups) {
    const parent = g.parentGroupId ? String(g.parentGroupId) : '';
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(g._id);
  }

  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return out;
}

const ChartOfAccountsPage: React.FC = () => {
  const router = useRouter();

  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [accountType, setAccountType] = useState<AccountType | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Always fetch the full ledger list and filter the tree client-side. The chart is a few
      // hundred rows at most, and re-fetching on every group click would make the tree feel
      // slower than it is.
      const [groupData, ledgerData] = await Promise.all([
        financeService.getGroups(),
        financeService.getLedgers({
          status,
          accountType: accountType || undefined,
          search: search.trim() || undefined,
        }),
      ]);
      setGroups(groupData);
      setLedgers(ledgerData);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the chart of accounts');
    } finally {
      setLoading(false);
    }
  }, [status, accountType, search]);

  useEffect(() => {
    load();
  }, [load]);

  const ledgerCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of ledgers) {
      counts.set(l.groupId, (counts.get(l.groupId) ?? 0) + 1);
    }
    return counts;
  }, [ledgers]);

  /** A group's own accounts plus everything in the groups beneath it. */
  const rollupCount = useCallback(
    (groupId: string) => {
      const ids = collectSubtreeIds(groups, groupId);
      let total = 0;
      for (const id of ids) total += ledgerCountByGroup.get(id) ?? 0;
      return total;
    },
    [groups, ledgerCountByGroup],
  );

  const visibleLedgers = useMemo(() => {
    if (!selectedGroupId) return ledgers;
    const ids = collectSubtreeIds(groups, selectedGroupId);
    return ledgers.filter((l) => ids.has(l.groupId));
  }, [ledgers, groups, selectedGroupId]);

  const handleDelete = async (ledger: Ledger) => {
    const ok = window.confirm(
      `Delete "${ledger.name}"? This cannot be undone. If it has ever been posted to, `
        + 'deactivate it instead so its history stays readable.',
    );
    if (!ok) return;
    try {
      await financeService.deleteLedger(ledger.id);
      toast.success(`Deleted ${ledger.name}`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this account');
    }
  };

  const handleToggleStatus = async (ledger: Ledger) => {
    try {
      await financeService.setLedgerStatus(ledger.id, !ledger.isActive);
      toast.success(ledger.isActive ? `${ledger.name} deactivated` : `${ledger.name} reactivated`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not change the status');
    }
  };

  const columns = [
    {
      key: 'code',
      title: 'Code',
      render: (value: string) => <span className={styles.code}>{value}</span>,
    },
    {
      key: 'name',
      title: 'Account',
      render: (value: string, row: Ledger) => (
        <div>
          <div style={{ fontWeight: 500 }}>{value}</div>
          <div style={{ marginTop: '0.25rem' }}>
            {row.isSystem && (
              <span
                className={`${styles.flag} ${styles.flagSystem}`}
                title="Used by the posting engine. Can be renamed and re-coded, but not deleted or retyped."
              >
                Engine
              </span>
            )}
            {row.isControl && (
              <span
                className={`${styles.flag} ${styles.flagControl}`}
                title="Holds the total of a subledger. Manual journal entries cannot post to it."
              >
                Control · {row.subledgerType}
              </span>
            )}
            {row.isCashEquivalent && <span className={styles.flag}>Cash</span>}
            {!row.isActive && <span className={styles.flag}>Inactive</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'groupName',
      title: 'Group',
      render: (value: string, row: Ledger) => (
        <span className={styles.muted}>
          {row.groupCode} · {value}
        </span>
      ),
    },
    {
      key: 'accountType',
      title: 'Type',
      render: (value: AccountType) => (
        <span className={`${styles.typeChip} ${styles[`type_${value}`]}`}>
          {TYPE_LABEL[value]}
        </span>
      ),
    },
    {
      key: 'normalBalance',
      title: 'Normal',
      // Derived from the type on the server and never editable. Shown because an accountant
      // reads a chart by checking exactly this.
      render: (value: string) => <span className={styles.muted}>{value === 'debit' ? 'Dr' : 'Cr'}</span>,
    },
    {
      key: 'naturalBalance',
      title: 'Balance',
      render: (value: number) => (
        <span className={`${styles.amount} ${value < 0 ? styles.amountNegative : ''}`}>
          {value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: Ledger) => (
        <div className={listStyles.actions}>
          {can(undefined, 'finance-coa:edit') && (
            <button
              className={listStyles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/finance/chart/${row.id}/edit`);
              }}
            >
              Edit
            </button>
          )}
          {can(undefined, 'finance-coa:change') && (
            <button
              className={listStyles.approveButton}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleStatus(row);
              }}
            >
              {row.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
          {can(undefined, 'finance-coa:delete') && !row.isSystem && (
            <button
              className={listStyles.deleteButton}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(row);
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
          <h1>Chart of Accounts</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className={listStyles.addButton}
              style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
              onClick={() => router.push('/finance/chart/groups')}
            >
              Manage Groups
            </button>
            {can(undefined, 'finance-coa:add') && (
              <button
                className={listStyles.addButton}
                onClick={() => router.push('/finance/chart/create')}
              >
                + Add Account
              </button>
            )}
          </div>
        </div>

        <FinanceNav />

        <div className={styles.split}>
          <aside className={styles.panel}>
            <h2 className={styles.panelTitle}>Groups</h2>
            <div className={styles.tree}>
              <button
                type="button"
                className={`${styles.treeRow} ${selectedGroupId === null ? styles.treeRowActive : ''}`}
                onClick={() => setSelectedGroupId(null)}
              >
                <span className={styles.treeName}>All accounts</span>
                <span className={styles.treeCount}>{ledgers.length}</span>
              </button>

              {groups.map((group) => (
                <button
                  key={group._id}
                  type="button"
                  className={[
                    styles.treeRow,
                    selectedGroupId === group._id ? styles.treeRowActive : '',
                    group.isActive ? '' : styles.treeInactive,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ paddingLeft: `${0.625 + (group.depth - 1) * 0.875}rem` }}
                  onClick={() => setSelectedGroupId(group._id)}
                >
                  <span className={styles.code}>{group.code}</span>
                  <span className={styles.treeName}>{group.name}</span>
                  <span className={styles.treeCount}>{rollupCount(group._id)}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className={listStyles.listCard}>
            <div className={listStyles.listCardBody}>
              <div className={styles.filterRow}>
                <input
                  type="text"
                  className={listStyles.searchInput}
                  placeholder="Search by name, or start of code…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  className={listStyles.searchSelect}
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType | '')}
                >
                  <option value="">All types</option>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <select
                  className={listStyles.searchSelect}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'all')}
                >
                  <option value="active">Active only</option>
                  <option value="inactive">Inactive only</option>
                  <option value="all">Active and inactive</option>
                </select>
              </div>

              <Table
                columns={columns}
                data={visibleLedgers}
                loading={loading}
                exportFileName="chart-of-accounts"
                exportPdfTitle="Chart of Accounts"
              />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ChartOfAccountsPageWrapper() {
  return (
    <ProtectedRoute permission="finance-coa:view">
      <ChartOfAccountsPage />
    </ProtectedRoute>
  );
}
