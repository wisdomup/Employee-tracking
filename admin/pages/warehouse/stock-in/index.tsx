import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table, { TableColumnConfig } from '../../../components/UI/Table';
import StatusBadge from '../../../components/UI/StatusBadge';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import { stockInService, StockReceipt } from '../../../services/stockInService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { formatRsExact, formatPieces } from '../../../utils/formatCurrency';
import { can } from '../../../utils/permissions';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/ListPage.module.scss';

/** Stock In receipts — goods received into the main warehouse. */
function StockInListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [receipts, setReceipts] = useState<StockReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplier, setSupplier] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const showMoney = can(user?.role, 'stock:set-low-level'); // admin-only, same gate as cost data

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await stockInService.getReceipts({
        supplierName: supplier || undefined,
        status: status || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setReceipts(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load Stock In receipts'));
    } finally {
      setLoading(false);
    }
  }, [supplier, status, startDate, endDate]);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (supplier) labels.push(`supplier "${supplier}"`);
    if (status) labels.push(`status ${status}`);
    if (startDate) labels.push(`from ${startDate}`);
    if (endDate) labels.push(`to ${endDate}`);
    return labels;
  }, [supplier, status, startDate, endDate]);

  const columns: TableColumnConfig[] = [
    {
      key: 'documentNo',
      title: 'Receipt #',
      render: (value: number) => (value ? String(value).padStart(5, '0') : '—'),
    },
    {
      key: 'receiptDate',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
    },
    { key: 'supplierName', title: 'Supplier', render: (v: string) => v || '—' },
    {
      key: 'warehouseId',
      title: 'Received into',
      render: (value: any) => value?.name ?? '—',
      exportValue: (row: StockReceipt) => row.warehouseId?.name ?? '',
    },
    {
      key: 'products',
      title: 'Lines',
      render: (value: unknown[]) => String(value?.length ?? 0),
      exportValue: (row: StockReceipt) => String(row.products?.length ?? 0),
    },
    { key: 'totalPieces', title: 'Pieces', render: (v: number) => formatPieces(v ?? 0) },
    ...(showMoney
      ? [
          {
            key: 'totalAmount',
            title: 'Value',
            render: (v: number) => formatRsExact(v ?? 0),
          },
        ]
      : []),
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'createdBy',
      title: 'Entered by',
      render: (value: any) => (value ? employeeDisplayLabel(value) : '—'),
      exportValue: (row: StockReceipt) => (row.createdBy ? employeeDisplayLabel(row.createdBy) : ''),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: StockReceipt) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/warehouse/stock-in/${row._id}`);
            }}
          >
            View
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Stock In</h1>
          {can(user?.role, 'stock-in:create') && (
            <button
              className={styles.addButton}
              onClick={() => router.push('/warehouse/stock-in/create')}
            >
              + Record Stock In
            </button>
          )}
        </div>

        <WarehouseModuleNav active="stock-in" />

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search by supplier…"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
              <SearchableSelect
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={styles.searchSelect}
                placeholder="All statuses"
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'posted', label: 'Posted' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
              <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="From date" />
              <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="To date" />
            </div>

            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {receipts.length} receipt(s) — filtered by: {activeFilterLabels.join(', ')}
              </p>
            )}

            <Table
              columns={columns}
              data={receipts}
              loading={loading}
              onRowClick={(row) => router.push(`/warehouse/stock-in/${row._id}`)}
              exportFileName="stock-in-receipts"
              exportPdfTitle={
                activeFilterLabels.length > 0
                  ? `Stock In Receipts (${activeFilterLabels.join(', ')})`
                  : 'Stock In Receipts'
              }
              noDataText="No Stock In receipts yet."
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function StockInListPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <StockInListPage />
    </ProtectedRoute>
  );
}
