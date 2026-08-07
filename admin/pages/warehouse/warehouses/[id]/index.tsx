import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import Table, { TableColumnConfig } from '../../../../components/UI/Table';
import StatusBadge from '../../../../components/UI/StatusBadge';
import BucketQtyCell from '../../../../components/Warehouse/BucketQtyCell';
import { warehouseService, Warehouse, StockRow } from '../../../../services/warehouseService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { formatRsExact, formatPieces } from '../../../../utils/formatCurrency';
import { can } from '../../../../utils/permissions';
import { useAuth } from '../../../../contexts/AuthContext';
import styles from '../../../../styles/DetailPage.module.scss';

/** One warehouse: its details plus everything it currently holds, product by product. */
function WarehouseDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);

  const showCost = can(user?.role, 'stock:set-low-level'); // admin-only, matches the API's redaction

  const fetchData = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setLoading(true);
    try {
      const [detail, rows] = await Promise.all([
        warehouseService.getWarehouse(id),
        warehouseService.getStock({ warehouseId: id }),
      ]);
      setWarehouse(detail);
      setStock(rows);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load the warehouse'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totals = useMemo(
    () =>
      stock.reduce(
        (acc, row) => ({
          sellable: acc.sellable + row.sellable,
          damaged: acc.damaged + row.damaged,
          inTransit: acc.inTransit + row.inTransit,
          value: acc.value + (row.stockValue ?? 0),
        }),
        { sellable: 0, damaged: 0, inTransit: 0, value: 0 },
      ),
    [stock],
  );

  const columns: TableColumnConfig[] = [
    { key: 'productName', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'categoryName', title: 'Category', render: (v: string) => v || '—' },
    {
      key: 'stock',
      title: 'On hand',
      omitFromExport: true,
      render: (_: unknown, row: StockRow) => (
        <BucketQtyCell
          sellable={row.sellable}
          damaged={row.damaged}
          inTransit={row.inTransit}
          isLow={row.isLow}
        />
      ),
    },
    { key: 'sellable', title: 'Sellable', render: (v: number) => formatPieces(v) },
    { key: 'damaged', title: 'Damaged / Claim', render: (v: number) => formatPieces(v) },
    { key: 'inTransit', title: 'In Transit', render: (v: number) => formatPieces(v) },
    {
      key: 'totalSellableAllWarehouses',
      title: 'All warehouses',
      render: (v: number) => formatPieces(v),
    },
    ...(showCost
      ? [
          {
            key: 'avgCost',
            title: 'Avg cost',
            render: (v: number) => (v ? formatRsExact(v) : '—'),
          },
          {
            key: 'stockValue',
            title: 'Stock value',
            render: (v: number) => (v ? formatRsExact(v) : '—'),
          },
        ]
      : []),
  ];

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!warehouse) {
    return (
      <Layout>
        <div className={styles.container}>
          <p>Warehouse not found.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            {warehouse.name}
            {warehouse.isMain ? ' (Main)' : ''}
          </h1>
          <div className={styles.headerActions}>
            {can(user?.role, 'warehouses:manage') && (
              <button
                className={styles.editButton}
                onClick={() => router.push(`/warehouse/warehouses/${warehouse._id}/edit`)}
              >
                Edit
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/warehouse/warehouses')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Details</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>City</span>
                <span className={styles.value}>{warehouse.city || '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Address</span>
                <span className={styles.value}>{warehouse.address || '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Manager</span>
                <span className={styles.value}>
                  {warehouse.managerId ? employeeDisplayLabel(warehouse.managerId) : '—'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status</span>
                <span className={styles.value}>
                  <StatusBadge status={warehouse.isActive ? 'active' : 'inactive'} />
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Receives Stock In</span>
                <span className={styles.value}>
                  {warehouse.isMain ? 'Yes — this is the main warehouse' : 'No'}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h2>Stock on hand</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Sellable pieces</span>
                <span className={styles.value}>{formatPieces(totals.sellable)}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Damaged / claim pieces</span>
                <span className={styles.value}>{formatPieces(totals.damaged)}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>In transit</span>
                <span className={styles.value}>{formatPieces(totals.inTransit)}</span>
              </div>
              {showCost && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Stock value</span>
                  <span className={styles.value}>{formatRsExact(totals.value)}</span>
                </div>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <h2>Products</h2>
            <Table
              columns={columns}
              data={stock}
              loading={false}
              exportFileName={`stock-${warehouse.name.replace(/\s+/g, '-').toLowerCase()}`}
              exportPdfTitle={`Stock on hand — ${warehouse.name}`}
              noDataText="This warehouse holds no stock yet."
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function WarehouseDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <WarehouseDetailPage />
    </ProtectedRoute>
  );
}
