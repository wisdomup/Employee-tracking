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
  damageClaimService,
  DamageClaim,
  DAMAGE_SOURCE_LABELS,
} from '../../../services/damageClaimService';
import { warehouseService, Warehouse, warehouseSelectOptions } from '../../../services/warehouseService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { formatPieces } from '../../../utils/formatCurrency';
import { can } from '../../../utils/permissions';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/ListPage.module.scss';

/**
 * Damage / claim queue. Approve and reject sit inline in the actions column, the same shape as
 * `/approvals`, because the decision needs no extra context beyond the row.
 */
function DamageListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [records, setRecords] = useState<DamageClaim[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);

  const canApprove = can(user?.role, 'damage:approve');

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(
        await damageClaimService.getRecords({
          status: status || undefined,
          source: source || undefined,
          warehouseId: warehouseId || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load damage / claim entries'));
    } finally {
      setLoading(false);
    }
  }, [status, source, warehouseId, startDate, endDate]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    warehouseService.getWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  const pendingCount = useMemo(() => records.filter((r) => r.status === 'pending').length, [records]);

  const handleApprove = async (row: DamageClaim) => {
    const pieces = row.products.reduce((sum, p) => sum + p.quantity, 0);
    if (
      !window.confirm(
        `Approve this entry? ${pieces} piece(s) will move from sellable stock into the damaged / claim bucket. This cannot be undone except by cancelling the entry.`,
      )
    ) {
      return;
    }
    setBusyId(row._id);
    try {
      await damageClaimService.approveRecord(row._id);
      toast.success('Approved — stock moved to the damaged / claim bucket');
      fetchRecords();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to approve the entry'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectId) return;
    setBusyId(rejectId);
    try {
      await damageClaimService.rejectRecord(rejectId, reason);
      toast.success('Rejected — nothing changed');
      setRejectId(null);
      fetchRecords();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to reject the entry'));
    } finally {
      setBusyId(null);
    }
  };

  const columns: TableColumnConfig[] = [
    {
      key: 'documentNo',
      title: 'Entry #',
      render: (value: number) => (value ? String(value).padStart(5, '0') : '—'),
    },
    {
      key: 'createdAt',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
    },
    {
      key: 'warehouseId',
      title: 'Warehouse',
      render: (value: any) => value?.name ?? '—',
      exportValue: (row: DamageClaim) => row.warehouseId?.name ?? '',
    },
    {
      key: 'products',
      title: 'Products',
      render: (value: DamageClaimLineLike[]) =>
        value?.map((p) => p.productId?.name ?? '—').join(', ') || '—',
      exportValue: (row: DamageClaim) =>
        row.products.map((p) => `${p.productId?.name ?? ''} x${p.quantity}`).join('; '),
    },
    {
      key: 'pieces',
      title: 'Pieces',
      render: (_: unknown, row: DamageClaim) =>
        formatPieces(row.products.reduce((sum, p) => sum + p.quantity, 0)),
      exportValue: (row: DamageClaim) =>
        String(row.products.reduce((sum, p) => sum + p.quantity, 0)),
      total: 'sum',
      totalValue: (row: DamageClaim) => row.products.reduce((sum, p) => sum + p.quantity, 0),
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'source',
      title: 'Type',
      render: (value: string) => <StatusBadge status={value} />,
      exportValue: (row: DamageClaim) => DAMAGE_SOURCE_LABELS[row.source] ?? row.source,
    },
    { key: 'clientName', title: 'Client', render: (v: string) => v || '—' },
    { key: 'reason', title: 'Reason', render: (v: string) => v || '—' },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'createdBy',
      title: 'Raised by',
      render: (value: any) => (value ? employeeDisplayLabel(value) : '—'),
      exportValue: (row: DamageClaim) => (row.createdBy ? employeeDisplayLabel(row.createdBy) : ''),
    },
    {
      key: 'approvedBy',
      title: 'Approved by',
      render: (value: any) => (value ? employeeDisplayLabel(value) : '—'),
      exportValue: (row: DamageClaim) =>
        row.approvedBy ? employeeDisplayLabel(row.approvedBy) : '',
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: DamageClaim) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/warehouse/damage/${row._id}`);
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
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Damage / Claim</h1>
          {can(user?.role, 'damage:create') && (
            <button
              className={styles.addButton}
              onClick={() => router.push('/warehouse/damage/create')}
            >
              + Record Damage / Claim
            </button>
          )}
        </div>

        <WarehouseModuleNav active="damage" />

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
                  { value: 'pending', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'rejected', label: 'Rejected' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
              <SearchableSelect
                name="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={styles.searchSelect}
                placeholder="All types"
                options={[
                  { value: '', label: 'All types' },
                  ...Object.entries(DAMAGE_SOURCE_LABELS).map(([value, label]) => ({
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
              <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="From date" />
              <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="To date" />
            </div>

            <p className={styles.filterSummary}>
              Showing {records.length} entry/entries
              {pendingCount > 0 && ` — ${pendingCount} waiting for approval`}. Stock only moves once
              an admin approves; a rejection changes nothing.
            </p>

            <Table
              columns={columns}
              data={records}
              loading={loading}
              onRowClick={(row) => router.push(`/warehouse/damage/${row._id}`)}
              exportFileName="damage-claim-entries"
              exportPdfTitle="Damage / Claim Entries"
              noDataText="No damage or claim entries yet."
            />
          </div>
        </div>
      </div>

      <ReasonModal
        open={!!rejectId}
        title="Reject this entry"
        description="Rejecting changes no stock at all. The entry is kept with your reason so the person who raised it can see why."
        label="Rejection reason"
        confirmLabel="Reject entry"
        busy={busyId === rejectId}
        onClose={() => {
          if (!busyId) setRejectId(null);
        }}
        onConfirm={handleReject}
      />
    </Layout>
  );
}

/** Populated product shape inside a line, for the column renderer. */
interface DamageClaimLineLike {
  productId?: { name?: string };
  quantity: number;
}

export default function DamageListPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <DamageListPage />
    </ProtectedRoute>
  );
}
