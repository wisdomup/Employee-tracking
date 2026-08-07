import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table, { TableColumnConfig } from '../../../components/UI/Table';
import StatusBadge from '../../../components/UI/StatusBadge';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import BucketQtyCell from '../../../components/Warehouse/BucketQtyCell';
import { warehouseService, Warehouse, StockRow } from '../../../services/warehouseService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { can } from '../../../utils/permissions';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/ListPage.module.scss';

/** Warehouse master list. Admin can add one at any time — the spec sets no limit. */
function WarehousesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const canManage = can(user?.role, 'warehouses:manage');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stockRows] = await Promise.all([
        warehouseService.getWarehouses({ search: search || undefined }),
        warehouseService.getStock(),
      ]);
      setWarehouses(list);
      setStock(stockRows);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load warehouses'));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Roll the stock rows up per warehouse so the list can show what each one holds. */
  const totalsByWarehouse = useMemo(() => {
    const map = new Map<string, { sellable: number; damaged: number; inTransit: number }>();
    for (const row of stock) {
      const entry = map.get(row.warehouseId) ?? { sellable: 0, damaged: 0, inTransit: 0 };
      entry.sellable += row.sellable;
      entry.damaged += row.damaged;
      entry.inTransit += row.inTransit;
      map.set(row.warehouseId, entry);
    }
    return map;
  }, [stock]);

  const handleSetMain = async (row: Warehouse) => {
    if (
      !window.confirm(
        `Make "${row.name}" the main warehouse? All future Stock In will land there instead.`,
      )
    ) {
      return;
    }
    try {
      await warehouseService.setMainWarehouse(row._id);
      toast.success(`${row.name} is now the main warehouse`);
      fetchData();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to change the main warehouse'));
    }
  };

  const handleDelete = async (row: Warehouse) => {
    if (!window.confirm(`Move "${row.name}" to trash?`)) return;
    try {
      await warehouseService.deleteWarehouse(row._id);
      toast.success('Warehouse moved to trash');
      fetchData();
    } catch (err) {
      // The API refuses while the warehouse is Main, still holds stock, or has an open transfer —
      // and says which. Surface that verbatim rather than a generic failure.
      toast.error(getApiErrorMessage(err, 'Failed to delete the warehouse'));
    }
  };

  const columns: TableColumnConfig[] = [
    {
      key: 'name',
      title: 'Warehouse',
      render: (value: string, row: Warehouse) => (
        <span>
          {value}
          {row.isMain && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                fontWeight: 700,
                color: '#065f46',
                background: '#d1fae5',
                padding: '2px 6px',
                borderRadius: 4,
              }}
              title="All Stock In lands here"
            >
              MAIN
            </span>
          )}
        </span>
      ),
      exportValue: (row: Warehouse) => (row.isMain ? `${row.name} (Main)` : row.name),
    },
    { key: 'city', title: 'City', render: (v: string) => v || '—' },
    {
      key: 'managerId',
      title: 'Manager',
      render: (value: any) => (value ? employeeDisplayLabel(value) : '—'),
      exportValue: (row: Warehouse) => (row.managerId ? employeeDisplayLabel(row.managerId) : ''),
    },
    {
      key: 'stock',
      title: 'Stock on hand',
      omitFromExport: true,
      render: (_: unknown, row: Warehouse) => {
        const totals = totalsByWarehouse.get(row._id);
        return (
          <BucketQtyCell
            sellable={totals?.sellable ?? 0}
            damaged={totals?.damaged ?? 0}
            inTransit={totals?.inTransit ?? 0}
          />
        );
      },
    },
    {
      key: 'isActive',
      title: 'Status',
      render: (value: boolean) => <StatusBadge status={value ? 'active' : 'inactive'} />,
      exportValue: (row: Warehouse) => (row.isActive ? 'Active' : 'Inactive'),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: Warehouse) => (
        <div className={styles.actions}>
          {canManage && (
            <button
              className={styles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/warehouse/warehouses/${row._id}/edit`);
              }}
            >
              Edit
            </button>
          )}
          {canManage && !row.isMain && row.isActive && (
            <button
              className={styles.approveButton}
              onClick={(e) => {
                e.stopPropagation();
                handleSetMain(row);
              }}
              title="All Stock In lands in the main warehouse"
            >
              Set as Main
            </button>
          )}
          {canManage && !row.isMain && (
            <button
              className={styles.deleteButton}
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
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Warehouses</h1>
          {canManage && (
            <button
              className={styles.addButton}
              onClick={() => router.push('/warehouse/warehouses/create')}
            >
              + Add Warehouse
            </button>
          )}
        </div>

        <WarehouseModuleNav active="warehouses" />

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search by name or city…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <p className={styles.filterSummary}>
              Showing {warehouses.length} warehouse(s). Stock is counted in pieces, split into
              sellable and damaged / claim.
            </p>

            <Table
              columns={columns}
              data={warehouses}
              loading={loading}
              onRowClick={(row) => router.push(`/warehouse/warehouses/${row._id}`)}
              exportFileName="warehouses"
              exportPdfTitle="Warehouses"
              noDataText="No warehouses yet."
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function WarehousesPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <WarehousesPage />
    </ProtectedRoute>
  );
}
