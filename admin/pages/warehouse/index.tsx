import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import WarehouseModuleNav from '../../components/Warehouse/WarehouseModuleNav';
import { warehouseService, StockRow, Warehouse } from '../../services/warehouseService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs, formatPieces } from '../../utils/formatCurrency';
import { can } from '../../utils/permissions';
import { useAuth } from '../../contexts/AuthContext';
import styles from '../../styles/Reports.module.scss';

/** Warehouse module overview: where the stock is, and what needs attention. */
const WAREHOUSE_ROLES_ALLOWED = ['admin', 'warehouse_manager', 'warehouse_staff'];

interface ActionCard {
  href: string;
  title: string;
  body: string;
  permission: string;
}

const ACTION_CARDS: ActionCard[] = [
  {
    href: '/warehouse/stock-in',
    title: 'Stock In',
    body: 'Record goods received into the main warehouse, with the purchase rate per piece.',
    permission: 'stock-in:create',
  },
  {
    href: '/warehouse/transfers',
    title: 'Transfers',
    body: 'Move stock between warehouses. Admin approves, the destination confirms what arrived.',
    permission: 'transfers:view',
  },
  {
    href: '/warehouse/damage',
    title: 'Damage / Claim',
    body: 'Set aside damaged or claimed pieces. Stock only moves once an admin approves.',
    permission: 'damage:view',
  },
  {
    href: '/warehouse/stock-count',
    title: 'Monthly Stock Count',
    body: 'Count one warehouse physically and reconcile it against the system figure.',
    permission: 'stock-count:view',
  },
  {
    href: '/warehouse/reports',
    title: 'Reports',
    body: 'Stock on hand, movement history, transfers, damage and valuation.',
    permission: 'warehouse-reports:view',
  },
  {
    href: '/warehouse/warehouses',
    title: 'Warehouses',
    body: 'Add a warehouse, set its manager, and choose which one receives all Stock In.',
    permission: 'warehouses:view',
  },
];

function WarehouseHubPage() {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [warehouseList, stockRows] = await Promise.all([
        warehouseService.getWarehouses(),
        warehouseService.getStock(),
      ]);
      setWarehouses(warehouseList);
      setStock(stockRows);
    } catch (err) {
      setFailed(true);
      toast.error(getApiErrorMessage(err, 'Failed to load warehouse data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totals = useMemo(() => {
    let sellable = 0;
    let damaged = 0;
    let inTransit = 0;
    let stockValue = 0;
    let potentialValue = 0;
    const lowProducts = new Set<string>();

    for (const row of stock) {
      sellable += row.sellable;
      damaged += row.damaged;
      inTransit += row.inTransit;
      stockValue += row.stockValue ?? 0;
      potentialValue += row.potentialSaleValue;
      if (row.isLow) lowProducts.add(row.productId);
    }

    return { sellable, damaged, inTransit, stockValue, potentialValue, lowCount: lowProducts.size };
  }, [stock]);

  const perWarehouse = useMemo(() => {
    const map = new Map<string, { name: string; isMain: boolean; sellable: number; damaged: number }>();
    for (const row of stock) {
      const entry = map.get(row.warehouseId) ?? {
        name: row.warehouseName,
        isMain: row.isMainWarehouse,
        sellable: 0,
        damaged: 0,
      };
      entry.sellable += row.sellable;
      entry.damaged += row.damaged;
      map.set(row.warehouseId, entry);
    }
    // Warehouses with no stock rows still deserve a tile, otherwise a new warehouse looks missing.
    for (const w of warehouses) {
      if (!map.has(w._id)) {
        map.set(w._id, { name: w.name, isMain: w.isMain, sellable: 0, damaged: 0 });
      }
    }
    return [...map.entries()].sort(
      (a, b) => Number(b[1].isMain) - Number(a[1].isMain) || a[1].name.localeCompare(b[1].name),
    );
  }, [stock, warehouses]);

  const mainWarehouse = warehouses.find((w) => w.isMain);
  const cards = ACTION_CARDS.filter((c) => can(user?.role, c.permission));
  const showValue = can(user?.role, 'stock:set-low-level'); // admin-only, same gate as cost data

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Warehouse</h1>
        </div>

        <WarehouseModuleNav active="home" />

        {failed && (
          <div className={styles.emptyState}>
            Could not load warehouse data. Check that the backend is running, then reload.
          </div>
        )}

        {!failed && !mainWarehouse && (
          <div className={styles.emptyState}>
            <strong>No main warehouse yet.</strong> All Stock In lands in the main warehouse, so
            nothing can be received until one exists.{' '}
            {can(user?.role, 'warehouses:manage') ? (
              <Link href="/warehouse/warehouses/create">Create a warehouse</Link>
            ) : (
              'Ask an admin to create one.'
            )}
          </div>
        )}

        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <span>Sellable pieces</span>
            <strong>{formatPieces(totals.sellable)}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Damaged / claim pieces</span>
            <strong>{formatPieces(totals.damaged)}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>In transit</span>
            <strong>{formatPieces(totals.inTransit)}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>Products below their level</span>
            <strong>{totals.lowCount}</strong>
          </div>
          {showValue && (
            <>
              <div className={styles.kpiCard}>
                <span>Stock value (at cost)</span>
                <strong>{formatRs(totals.stockValue)}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span>Could sell for</span>
                <strong>{formatRs(totals.potentialValue)}</strong>
              </div>
            </>
          )}
        </div>

        <div className={styles.section}>
          <h2>Stock by warehouse</h2>
          {perWarehouse.length === 0 ? (
            <div className={styles.emptyState}>No warehouses yet.</div>
          ) : (
            <div className={styles.kpiGrid}>
              {perWarehouse.map(([id, w]) => (
                <Link key={id} href={`/warehouse/warehouses/${id}`} className={styles.kpiCard}>
                  <span>
                    {w.name}
                    {w.isMain ? ' (Main)' : ''}
                  </span>
                  <strong>{formatPieces(w.sellable)}</strong>
                  {w.damaged > 0 && (
                    <span style={{ color: '#b91c1c' }}>{formatPieces(w.damaged)} damaged</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={styles.section}>
          <h2>What would you like to do?</h2>
          <div className={styles.kpiGrid}>
            {cards.map((card) => (
              <Link key={card.href} href={card.href} className={styles.kpiCard}>
                <strong style={{ fontSize: '1rem' }}>{card.title}</strong>
                <span style={{ lineHeight: 1.5 }}>{card.body}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export default function WarehouseHubPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={WAREHOUSE_ROLES_ALLOWED}>
      <WarehouseHubPage />
    </ProtectedRoute>
  );
}
