import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table, { TableColumnConfig } from '../../../components/UI/Table';
import StatusBadge from '../../../components/UI/StatusBadge';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import {
  stockCountService,
  StockCount,
  STOCK_COUNT_STATUS_LABELS,
} from '../../../services/stockCountService';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { can } from '../../../utils/permissions';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/ListPage.module.scss';

function StockCountListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      setCounts(
        await stockCountService.getCounts({
          status: status || undefined,
          warehouseId: warehouseId || undefined,
        }),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load stock counts'));
    } finally {
      setLoading(false);
    }
  }, [status, warehouseId]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    warehouseService.getWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  const awaitingCount = useMemo(
    () => counts.filter((c) => c.status === 'submitted').length,
    [counts],
  );

  /** Net difference across a sheet — what the count would change if approved. */
  const netDiff = (count: StockCount, bucket: 'sellable' | 'damaged') =>
    count.lines.reduce(
      (sum, line) =>
        sum +
        (bucket === 'sellable'
          ? line.countedSellable - line.systemSellable
          : line.countedDamaged - line.systemDamaged),
      0,
    );

  const columns: TableColumnConfig[] = [
    {
      key: 'documentNo',
      title: 'Count #',
      render: (value: number) => (value ? String(value).padStart(5, '0') : '—'),
    },
    { key: 'periodMonth', title: 'Month' },
    {
      key: 'warehouseId',
      title: 'Warehouse',
      render: (value: any) => value?.name ?? '—',
      exportValue: (row: StockCount) => row.warehouseId?.name ?? '',
    },
    {
      key: 'lines',
      title: 'Products counted',
      render: (_: unknown, row: StockCount) => String(row.lines.length),
      exportValue: (row: StockCount) => String(row.lines.length),
    },
    {
      key: 'diffSellable',
      title: 'Net sellable diff',
      render: (_: unknown, row: StockCount) => {
        const diff = netDiff(row, 'sellable');
        if (diff === 0) return '—';
        return (
          <span style={{ color: diff > 0 ? '#047857' : '#b91c1c', fontWeight: 700 }}>
            {diff > 0 ? `+${diff}` : diff}
          </span>
        );
      },
      exportValue: (row: StockCount) => String(netDiff(row, 'sellable')),
    },
    {
      key: 'diffDamaged',
      title: 'Net damaged diff',
      render: (_: unknown, row: StockCount) => {
        const diff = netDiff(row, 'damaged');
        return diff === 0 ? '—' : diff > 0 ? `+${diff}` : String(diff);
      },
      exportValue: (row: StockCount) => String(netDiff(row, 'damaged')),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => (
        <StatusBadge status={value === 'submitted' ? 'pending' : value} />
      ),
      exportValue: (row: StockCount) => STOCK_COUNT_STATUS_LABELS[row.status] ?? row.status,
    },
    {
      key: 'approvedBy',
      title: 'Approved by',
      render: (value: any) => (value ? employeeDisplayLabel(value) : '—'),
      exportValue: (row: StockCount) => (row.approvedBy ? employeeDisplayLabel(row.approvedBy) : ''),
    },
    {
      key: 'createdAt',
      title: 'Started',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: StockCount) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/warehouse/stock-count/${row._id}`);
            }}
          >
            {row.status === 'draft' ? 'Continue' : 'View'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Stock Count</h1>
          {can(user?.role, 'stock-count:create') && (
            <button
              className={styles.addButton}
              onClick={() => router.push('/warehouse/stock-count/create')}
            >
              + Start a Count
            </button>
          )}
        </div>

        <WarehouseModuleNav active="stock-count" />

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <SearchableSelect
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={styles.searchSelect}
                placeholder="All statuses"
                options={[
                  { value: '', label: 'All statuses' },
                  ...Object.entries(STOCK_COUNT_STATUS_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
              <SearchableSelect
                name="warehouseId"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={styles.searchSelect}
                options={warehouseSelectOptions(warehouses, { includeAll: true })}
              />
            </div>

            <p className={styles.filterSummary}>
              Showing {counts.length} count(s)
              {awaitingCount > 0 && ` — ${awaitingCount} waiting for approval`}. Approving a count
              applies the difference the counter found; movements that happened while it was waiting
              are kept.
            </p>

            <Table
              columns={columns}
              data={counts}
              loading={loading}
              onRowClick={(row) => router.push(`/warehouse/stock-count/${row._id}`)}
              exportFileName="stock-counts"
              exportPdfTitle="Monthly Stock Counts"
              noDataText="No stock counts yet."
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function StockCountListPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <StockCountListPage />
    </ProtectedRoute>
  );
}
