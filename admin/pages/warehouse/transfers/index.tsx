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
import ReasonModal from '../../../components/Warehouse/ReasonModal';
import {
  stockTransferService,
  StockTransfer,
  TRANSFER_STATUS_LABELS,
} from '../../../services/stockTransferService';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { formatPieces } from '../../../utils/formatCurrency';
import { can } from '../../../utils/permissions';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/ListPage.module.scss';

function TransfersListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);

  const canApprove = can(user?.role, 'transfers:approve');
  const myWarehouseId = user?.role === 'admin' ? null : user?.warehouseId ?? null;

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      setTransfers(
        await stockTransferService.getTransfers({
          status: status || undefined,
          fromWarehouseId: fromWarehouseId || undefined,
          toWarehouseId: toWarehouseId || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load transfers'));
    } finally {
      setLoading(false);
    }
  }, [status, fromWarehouseId, toWarehouseId, startDate, endDate]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  useEffect(() => {
    warehouseService.getWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  const counts = useMemo(
    () => ({
      pending: transfers.filter((t) => t.status === 'pending').length,
      mismatch: transfers.filter((t) => t.status === 'mismatch').length,
    }),
    [transfers],
  );

  const handleApprove = async (row: StockTransfer) => {
    const sent = row.products.reduce((sum, p) => sum + p.sentQty, 0);
    if (
      !window.confirm(
        `Approve transfer #${row.documentNo ?? ''}? ${sent} piece(s) leave ${row.fromWarehouseId?.name ?? 'the source'} immediately and stay in transit until the destination confirms.`,
      )
    ) {
      return;
    }
    setBusyId(row._id);
    try {
      await stockTransferService.approveTransfer(row._id);
      toast.success('Approved — the stock is now in transit');
      fetchTransfers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to approve the transfer'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectId) return;
    setBusyId(rejectId);
    try {
      await stockTransferService.rejectTransfer(rejectId, reason);
      toast.success('Rejected — no stock moved');
      setRejectId(null);
      fetchTransfers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to reject the transfer'));
    } finally {
      setBusyId(null);
    }
  };

  /** Only the destination (or an admin) can confirm receipt. */
  const canReceive = (row: StockTransfer) =>
    can(user?.role, 'transfers:receive') &&
    row.status === 'approved' &&
    (user?.role === 'admin' || String(row.toWarehouseId?._id) === myWarehouseId);

  const columns: TableColumnConfig[] = [
    {
      key: 'documentNo',
      title: 'Transfer #',
      render: (value: number) => (value ? String(value).padStart(5, '0') : '—'),
    },
    {
      key: 'createdAt',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
    },
    {
      key: 'fromWarehouseId',
      title: 'From',
      render: (value: any) => value?.name ?? '—',
      exportValue: (row: StockTransfer) => row.fromWarehouseId?.name ?? '',
    },
    {
      key: 'toWarehouseId',
      title: 'To',
      render: (value: any) => value?.name ?? '—',
      exportValue: (row: StockTransfer) => row.toWarehouseId?.name ?? '',
    },
    {
      key: 'lines',
      title: 'Lines',
      render: (_: unknown, row: StockTransfer) => String(row.products.length),
      exportValue: (row: StockTransfer) => String(row.products.length),
      total: 'sum',
      totalValue: (row: StockTransfer) => row.products.length,
    },
    {
      key: 'sent',
      title: 'Sent',
      render: (_: unknown, row: StockTransfer) =>
        formatPieces(row.products.reduce((sum, p) => sum + p.sentQty, 0)),
      exportValue: (row: StockTransfer) =>
        String(row.products.reduce((sum, p) => sum + p.sentQty, 0)),
      total: 'sum',
      totalValue: (row: StockTransfer) => row.products.reduce((sum, p) => sum + p.sentQty, 0),
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'received',
      title: 'Received',
      render: (_: unknown, row: StockTransfer) => {
        const anyReceived = row.products.some((p) => p.receivedQty !== undefined);
        if (!anyReceived) return '—';
        return formatPieces(row.products.reduce((sum, p) => sum + (p.receivedQty ?? 0), 0));
      },
      exportValue: (row: StockTransfer) =>
        row.products.some((p) => p.receivedQty !== undefined)
          ? String(row.products.reduce((sum, p) => sum + (p.receivedQty ?? 0), 0))
          : '',
      total: 'sum',
      totalValue: (row: StockTransfer) =>
        row.products.reduce((sum, p) => sum + (p.receivedQty ?? 0), 0),
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'mismatch',
      title: 'Shortfall',
      render: (_: unknown, row: StockTransfer) => {
        if (!row.products.some((p) => p.receivedQty !== undefined)) return '—';
        const shortfall = row.products.reduce(
          (sum, p) => sum + (p.sentQty - (p.receivedQty ?? 0)),
          0,
        );
        return shortfall > 0 ? (
          <span style={{ color: '#b91c1c', fontWeight: 700 }}>{formatPieces(shortfall)}</span>
        ) : (
          '0'
        );
      },
      exportValue: (row: StockTransfer) =>
        row.products.some((p) => p.receivedQty !== undefined)
          ? String(row.products.reduce((sum, p) => sum + (p.sentQty - (p.receivedQty ?? 0)), 0))
          : '',
      total: 'sum',
      // Only settled transfers carry a shortfall; in-flight ones would otherwise read as short.
      totalValue: (row: StockTransfer) =>
        row.products.some((p) => p.receivedQty !== undefined)
          ? row.products.reduce((sum, p) => sum + (p.sentQty - (p.receivedQty ?? 0)), 0)
          : 0,
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value === 'approved' ? 'in_transit' : value} />,
      exportValue: (row: StockTransfer) => TRANSFER_STATUS_LABELS[row.status] ?? row.status,
    },
    {
      key: 'createdBy',
      title: 'Raised by',
      render: (value: any) => (value ? employeeDisplayLabel(value) : '—'),
      exportValue: (row: StockTransfer) =>
        row.createdBy ? employeeDisplayLabel(row.createdBy) : '',
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: StockTransfer) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/warehouse/transfers/${row._id}`);
            }}
          >
            View
          </button>
          {canApprove && row.status === 'pending' && (
            <>
              <button
                className={styles.approveButton}
                disabled={busyId === row._id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleApprove(row);
                }}
              >
                Approve
              </button>
              <button
                className={styles.deleteButton}
                disabled={busyId === row._id}
                onClick={(e) => {
                  e.stopPropagation();
                  setRejectId(row._id);
                }}
              >
                Reject
              </button>
            </>
          )}
          {canReceive(row) && (
            <button
              className={styles.approveButton}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/warehouse/transfers/${row._id}/receive`);
              }}
            >
              Receive
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Transfers</h1>
          {can(user?.role, 'transfers:create') && (
            <button
              className={styles.addButton}
              onClick={() => router.push('/warehouse/transfers/create')}
            >
              + New Transfer
            </button>
          )}
        </div>

        <WarehouseModuleNav active="transfers" />

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
                  ...Object.entries(TRANSFER_STATUS_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
              <SearchableSelect
                name="fromWarehouseId"
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className={styles.searchSelect}
                options={warehouseSelectOptions(warehouses, {
                  includeAll: true,
                  allLabel: 'From: any',
                })}
              />
              <SearchableSelect
                name="toWarehouseId"
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className={styles.searchSelect}
                options={warehouseSelectOptions(warehouses, {
                  includeAll: true,
                  allLabel: 'To: any',
                })}
              />
              <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="From date" />
              <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="To date" />
            </div>

            <p className={styles.filterSummary}>
              Showing {transfers.length} transfer(s)
              {counts.pending > 0 && ` — ${counts.pending} waiting for approval`}
              {counts.mismatch > 0 && `, ${counts.mismatch} with a quantity mismatch`}. Stock leaves
              the source when an admin approves, and only what actually arrives is credited.
            </p>

            <Table
              columns={columns}
              data={transfers}
              loading={loading}
              onRowClick={(row) => router.push(`/warehouse/transfers/${row._id}`)}
              exportFileName="stock-transfers"
              exportPdfTitle="Stock Transfers"
              noDataText="No transfers yet."
            />
          </div>
        </div>
      </div>

      <ReasonModal
        open={!!rejectId}
        title="Reject this transfer"
        description="No stock has moved yet, so rejecting simply closes the request with your reason."
        label="Rejection reason"
        confirmLabel="Reject transfer"
        busy={busyId === rejectId}
        onClose={() => {
          if (!busyId) setRejectId(null);
        }}
        onConfirm={handleReject}
      />
    </Layout>
  );
}

export default function TransfersListPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <TransfersListPage />
    </ProtectedRoute>
  );
}
