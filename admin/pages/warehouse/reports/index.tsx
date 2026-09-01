import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table, { TableColumnConfig } from '../../../components/UI/Table';
import StatusBadge from '../../../components/UI/StatusBadge';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import AnalyticsExportButton from '../../../components/UI/AnalyticsExportButton';
import type { AnalyticsExportPayload } from '../../../utils/analyticsExport';
import type { TableExportColumn } from '../../../utils/tableExport';
import {
  warehouseService,
  Warehouse,
  StockRow,
  StockMovementRow,
  warehouseSelectOptions,
  MOVEMENT_TYPE_LABELS,
  BUCKET_LABELS,
} from '../../../services/warehouseService';
import { productService, Product } from '../../../services/productService';
import { categoryService } from '../../../services/categoryService';
import {
  stockTransferService,
  StockTransfer,
  TRANSFER_STATUS_LABELS,
} from '../../../services/stockTransferService';
import {
  damageClaimService,
  DamageClaim,
  DAMAGE_SOURCE_LABELS,
} from '../../../services/damageClaimService';
import {
  stockCountService,
  warehouseReportService,
  CountReportRow,
  ValuationReport,
} from '../../../services/stockCountService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { formatRs, formatRsExact, formatPieces } from '../../../utils/formatCurrency';
import { can, canViewReport } from '../../../utils/permissions';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/StockReports.module.scss';

/**
 * Warehouse reports — ledger-side, as opposed to the sales-side reports on `/stock-reports`.
 *
 * Kept as a separate page rather than extra tabs there because `/stock-reports` is admin-only and
 * exposes company P&L, while warehouse staff and managers legitimately need stock on hand and
 * movement history for their own warehouse.
 */
type TabId = 'stock' | 'movement' | 'transfers' | 'damage' | 'count' | 'valuation';

/** Each tab is a separately-grantable report; the admin ticks them one at a time. */
const TABS: { id: TabId; label: string; reportId: string }[] = [
  { id: 'stock', label: 'Stock on Hand', reportId: 'warehouse-reports.stock' },
  { id: 'movement', label: 'Movement History', reportId: 'warehouse-reports.movement' },
  { id: 'transfers', label: 'Transfers', reportId: 'warehouse-reports.transfers' },
  { id: 'damage', label: 'Damage / Claim', reportId: 'warehouse-reports.damage' },
  { id: 'count', label: 'Monthly Count', reportId: 'warehouse-reports.count' },
  { id: 'valuation', label: 'Sales & Valuation', reportId: 'warehouse-reports.valuation' },
];

const TAB_EXPORT_LABEL: Record<TabId, string> = {
  stock: 'Stock on Hand',
  movement: 'Stock Movement History',
  transfers: 'Transfer History',
  damage: 'Damage / Claim Report',
  count: 'Monthly Stock Count Report',
  valuation: 'Sales and Stock Valuation',
};

interface Filters {
  warehouseId: string;
  productId: string;
  categoryId: string;
  bucket: string;
  movementType: string;
  startDate: string;
  endDate: string;
  search: string;
  lowOnly: boolean;
  /** Transfers and damage entries share a status filter, with different vocabularies per tab. */
  status: string;
  mismatchOnly: boolean;
  damageSource: string;
  /** `YYYY-MM` for the monthly count report. */
  periodMonth: string;
}

/**
 * Transfers and damage entries are flattened to ONE ROW PER LINE for reporting. A per-document row
 * would hide which product came up short, which is the only question a mismatch report answers.
 */
interface TransferReportRow {
  key: string;
  documentNo?: number;
  date: string;
  fromWarehouse: string;
  toWarehouse: string;
  productName: string;
  barcode: string;
  sentQty: number;
  receivedQty: number | null;
  shortfall: number | null;
  status: string;
  approvedByName: string;
  receivedByName: string;
}

interface DamageReportRow {
  key: string;
  documentNo?: number;
  date: string;
  warehouse: string;
  productName: string;
  barcode: string;
  quantity: number;
  source: string;
  clientName: string;
  reason: string;
  status: string;
  raisedByName: string;
  approvedByName: string;
  approvedAt: string | null;
}

function flattenTransfers(transfers: StockTransfer[]): TransferReportRow[] {
  const rows: TransferReportRow[] = [];
  for (const t of transfers) {
    t.products.forEach((line, index) => {
      const received = line.receivedQty;
      rows.push({
        key: `${t._id}:${index}`,
        documentNo: t.documentNo,
        date: t.createdAt,
        fromWarehouse: t.fromWarehouseId?.name ?? '',
        toWarehouse: t.toWarehouseId?.name ?? '',
        productName: line.productId?.name ?? '',
        barcode: line.productId?.barcode ?? '',
        sentQty: line.sentQty,
        receivedQty: received ?? null,
        shortfall: received === undefined ? null : line.sentQty - received,
        status: t.status,
        approvedByName: t.approvedBy ? employeeDisplayLabel(t.approvedBy) : '',
        receivedByName: t.receivedBy ? employeeDisplayLabel(t.receivedBy) : '',
      });
    });
  }
  return rows;
}

function flattenDamageClaims(claims: DamageClaim[]): DamageReportRow[] {
  const rows: DamageReportRow[] = [];
  for (const c of claims) {
    c.products.forEach((line, index) => {
      rows.push({
        key: `${c._id}:${index}`,
        documentNo: c.documentNo,
        date: c.createdAt,
        warehouse: c.warehouseId?.name ?? '',
        productName: line.productId?.name ?? '',
        barcode: line.productId?.barcode ?? '',
        quantity: line.quantity,
        source: c.source,
        clientName: c.clientName || c.dealerId?.shopName || c.dealerId?.name || '',
        reason: c.reason,
        status: c.status,
        raisedByName: c.createdBy ? employeeDisplayLabel(c.createdBy) : '',
        approvedByName: c.approvedBy ? employeeDisplayLabel(c.approvedBy) : '',
        approvedAt: c.approvedAt ?? null,
      });
    });
  }
  return rows;
}

const EMPTY_FILTERS: Filters = {
  warehouseId: '',
  productId: '',
  categoryId: '',
  bucket: '',
  movementType: '',
  startDate: '',
  endDate: '',
  search: '',
  lowOnly: false,
  status: '',
  mismatchOnly: false,
  damageSource: '',
  periodMonth: '',
};

function WarehouseReportsPage() {
  const { user, access } = useAuth();
  // Only the tabs this user has been granted. A tab that answers 403 is worse than no tab:
  // the person can see the report exists but cannot tell forbidden from broken.
  // Depends on `access`, NOT on []. Permissions arrive from /permissions/me after mount, so a
  // memo with empty deps runs once against an empty grant set and every tab disappears
  // permanently — the page renders as if the user had no reports at all.
  const visibleTabs = useMemo(() => TABS.filter((t) => canViewReport(t.reportId)), [access]);
  const [activeTab, setActiveTab] = useState<TabId>(() => visibleTabs[0]?.id ?? 'stock');

  // The initialiser above runs on mount, before /permissions/me has answered, so it can leave
  // `activeTab` pointing at a tab the user turns out not to have. Correct it once the grants
  // land — otherwise they see a selected tab that is not in the tab strip, and an empty table.
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [visibleTabs, activeTab]);
  // Explicit Apply/Reset rather than live refetch — the movement report can be large, and this is
  // the pattern the existing stock-reports page already uses.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);

  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [movementRows, setMovementRows] = useState<StockMovementRow[]>([]);
  const [transferRows, setTransferRows] = useState<TransferReportRow[]>([]);
  const [damageRows, setDamageRows] = useState<DamageReportRow[]>([]);
  const [countRows, setCountRows] = useState<CountReportRow[]>([]);
  const [valuation, setValuation] = useState<ValuationReport | null>(null);
  const [loading, setLoading] = useState(true);

  const showCost = can(user?.role, 'stock:set-low-level'); // admin-only, matches the API's redaction

  useEffect(() => {
    Promise.all([
      warehouseService.getWarehouses(),
      productService.getProducts(),
      categoryService.getCategories().catch(() => []),
    ])
      .then(([w, p, c]) => {
        setWarehouses(w);
        setProducts(p);
        setCategories(Array.isArray(c) ? c : []);
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(
    async (tab: TabId, f: Filters) => {
      setLoading(true);
      try {
        if (tab === 'stock') {
          setStockRows(
            await warehouseService.getStock({
              warehouseId: f.warehouseId || undefined,
              productId: f.productId || undefined,
              categoryId: f.categoryId || undefined,
              search: f.search || undefined,
              lowOnly: f.lowOnly || undefined,
            }),
          );
        } else if (tab === 'valuation') {
          // Computed server-side over the whole date range, so it is not limited by whatever the
          // stock table happens to be showing.
          setValuation(
            await warehouseReportService.getValuation({
              startDate: f.startDate || undefined,
              endDate: f.endDate || undefined,
              warehouseId: f.warehouseId || undefined,
              categoryId: f.categoryId || undefined,
            }),
          );
        } else if (tab === 'count') {
          setCountRows(
            await stockCountService.getReport({
              warehouseId: f.warehouseId || undefined,
              status: f.status || undefined,
              periodMonth: f.periodMonth || undefined,
            }),
          );
        } else if (tab === 'movement') {
          setMovementRows(
            await warehouseService.getMovements({
              warehouseId: f.warehouseId || undefined,
              productId: f.productId || undefined,
              bucket: f.bucket || undefined,
              type: f.movementType || undefined,
              startDate: f.startDate || undefined,
              endDate: f.endDate || undefined,
              limit: 2000,
            }),
          );
        } else if (tab === 'transfers') {
          setTransferRows(
            flattenTransfers(
              await stockTransferService.getTransfers({
                status: f.status || undefined,
                startDate: f.startDate || undefined,
                endDate: f.endDate || undefined,
                hasMismatch: f.mismatchOnly || undefined,
              }),
            ),
          );
        } else if (tab === 'damage') {
          setDamageRows(
            flattenDamageClaims(
              await damageClaimService.getRecords({
                status: f.status || undefined,
                source: f.damageSource || undefined,
                warehouseId: f.warehouseId || undefined,
                productId: f.productId || undefined,
                startDate: f.startDate || undefined,
                endDate: f.endDate || undefined,
                search: f.search || undefined,
              }),
            ),
          );
        }
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Failed to load the report'));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchData(activeTab, appliedFilters);
  }, [activeTab, appliedFilters, fetchData]);

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    const f = appliedFilters;
    if (f.warehouseId) {
      labels.push(warehouses.find((w) => w._id === f.warehouseId)?.name ?? 'a warehouse');
    }
    if (f.productId) {
      labels.push(products.find((p) => p._id === f.productId)?.name ?? 'a product');
    }
    if (f.categoryId) labels.push('a category');
    if (f.bucket) labels.push(BUCKET_LABELS[f.bucket] ?? f.bucket);
    if (f.movementType) labels.push(MOVEMENT_TYPE_LABELS[f.movementType] ?? f.movementType);
    if (f.startDate) labels.push(`from ${f.startDate}`);
    if (f.endDate) labels.push(`to ${f.endDate}`);
    if (f.lowOnly) labels.push('low stock only');
    if (f.status) labels.push(`status ${f.status}`);
    if (f.mismatchOnly) labels.push('mismatches only');
    if (f.damageSource) labels.push(DAMAGE_SOURCE_LABELS[f.damageSource as never] ?? f.damageSource);
    if (f.periodMonth) labels.push(f.periodMonth);
    if (f.search) labels.push(`"${f.search}"`);
    return labels;
  }, [appliedFilters, warehouses, products]);

  const exportPdfTitle = useMemo(
    () =>
      activeFilterLabels.length > 0
        ? `${TAB_EXPORT_LABEL[activeTab]} (${activeFilterLabels.join(', ')})`
        : TAB_EXPORT_LABEL[activeTab],
    [activeTab, activeFilterLabels],
  );

  const lowCount = useMemo(
    () => new Set(stockRows.filter((r) => r.isLow).map((r) => r.productId)).size,
    [stockRows],
  );

  const stockColumns: TableColumnConfig[] = [
    { key: 'warehouseName', title: 'Warehouse' },
    { key: 'productName', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'categoryName', title: 'Category', render: (v: string) => v || '—' },
    {
      key: 'sellable',
      title: 'Sellable',
      render: (value: number, row: StockRow) => {
        if (value === 0) return <span className={styles.criticalBadge}>0</span>;
        if (row.isLow) return <span className={styles.warningBadge}>{formatPieces(value)}</span>;
        return formatPieces(value);
      },
      exportValue: (row: StockRow) => String(row.sellable),
      total: 'sum',
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'damaged',
      title: 'Damaged / Claim',
      render: (value: number) =>
        value > 0 ? (
          <span style={{ color: '#b91c1c', fontWeight: 600 }}>{formatPieces(value)}</span>
        ) : (
          '0'
        ),
      exportValue: (row: StockRow) => String(row.damaged),
      total: 'sum',
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'inTransit',
      title: 'In Transit',
      render: (value: number) => (value > 0 ? formatPieces(value) : '0'),
      total: 'sum',
      totalRender: (value: number) => formatPieces(value),
    },
    {
      // Deliberately NOT totalled: the same all-warehouse figure repeats on every warehouse row,
      // so a sum would multiply the real stock by the number of warehouses holding that product.
      key: 'totalSellableAllWarehouses',
      title: 'Total (all warehouses)',
      render: (v: number) => formatPieces(v),
    },
    {
      key: 'survivalQuantity', total: 'none' as const,
      title: 'Low-stock level',
      render: (value: number | null) =>
        value === null ? <span style={{ color: '#9ca3af' }}>Not set</span> : formatPieces(value),
      exportValue: (row: StockRow) =>
        row.survivalQuantity === null ? 'Not set' : String(row.survivalQuantity),
    },
    ...(showCost
      ? [
          {
            key: 'avgCost',
            title: 'Avg cost',
            render: (v: number) => (v ? formatRsExact(v) : '—'),
            total: 'avg' as const,
            totalRender: (value: number) => formatRsExact(value),
          },
          {
            key: 'stockValue',
            title: 'Stock value',
            render: (v: number) => (v ? formatRsExact(v) : '—'),
            total: 'sum' as const,
            totalRender: (value: number) => formatRsExact(value),
          },
        ]
      : []),
    {
      key: 'potentialSaleValue',
      title: 'Could sell for',
      render: (v: number) => (v ? formatRsExact(v) : '—'),
      total: 'sum',
      totalRender: (value: number) => formatRsExact(value),
    },
  ];

  const movementColumns: TableColumnConfig[] = [
    {
      key: 'occurredAt',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
    },
    {
      key: 'warehouseId',
      title: 'Warehouse',
      render: (value: any) => value?.name ?? '—',
      exportValue: (row: StockMovementRow) => row.warehouseId?.name ?? '',
    },
    {
      key: 'productId',
      title: 'Product',
      render: (value: any) => value?.name ?? '—',
      exportValue: (row: StockMovementRow) => row.productId?.name ?? '',
    },
    {
      key: 'barcode',
      title: 'Barcode',
      render: (_: unknown, row: StockMovementRow) => row.productId?.barcode ?? '—',
      exportValue: (row: StockMovementRow) => row.productId?.barcode ?? '',
    },
    {
      key: 'bucket',
      title: 'Bucket',
      render: (value: string) => <StatusBadge status={value} />,
      exportValue: (row: StockMovementRow) => BUCKET_LABELS[row.bucket] ?? row.bucket,
    },
    {
      key: 'type',
      title: 'Movement',
      render: (value: string) => MOVEMENT_TYPE_LABELS[value] ?? value,
      exportValue: (row: StockMovementRow) => MOVEMENT_TYPE_LABELS[row.type] ?? row.type,
    },
    {
      key: 'in',
      title: 'In',
      render: (_: unknown, row: StockMovementRow) =>
        row.delta > 0 ? <span style={{ color: '#047857' }}>+{formatPieces(row.delta)}</span> : '',
      exportValue: (row: StockMovementRow) => (row.delta > 0 ? String(row.delta) : ''),
      total: 'sum',
      totalValue: (row: StockMovementRow) => (row.delta > 0 ? row.delta : 0),
      totalRender: (value: number) => `+${formatPieces(value)}`,
    },
    {
      key: 'out',
      title: 'Out',
      render: (_: unknown, row: StockMovementRow) =>
        row.delta < 0 ? (
          <span style={{ color: '#b91c1c' }}>-{formatPieces(Math.abs(row.delta))}</span>
        ) : (
          ''
        ),
      exportValue: (row: StockMovementRow) => (row.delta < 0 ? String(Math.abs(row.delta)) : ''),
      total: 'sum',
      totalValue: (row: StockMovementRow) => (row.delta < 0 ? Math.abs(row.delta) : 0),
      totalRender: (value: number) => `-${formatPieces(value)}`,
    },
    // `balanceAfter` is a running balance — the last row already IS the total, so no footer sum.
    { key: 'balanceAfter', title: 'Balance after', render: (v: number) => formatPieces(v ?? 0) },
    ...(showCost
      ? [
          {
            key: 'unitCost',
            title: 'Rate',
            render: (v: number) => (v ? formatRsExact(v) : '—'),
            total: 'avg' as const,
            totalRender: (value: number) => formatRsExact(value),
          },
        ]
      : []),
    {
      key: 'actorId',
      title: 'By',
      render: (value: any) => (value ? employeeDisplayLabel(value) : 'System'),
      exportValue: (row: StockMovementRow) =>
        row.actorId ? employeeDisplayLabel(row.actorId) : 'System',
    },
    { key: 'reason', title: 'Reason', render: (v: string) => v || '—' },
  ];

  const transferColumns: TableColumnConfig[] = [
    {
      key: 'documentNo', total: 'none' as const,
      title: 'Transfer #',
      render: (value: number) => (value ? String(value).padStart(5, '0') : '—'),
    },
    {
      key: 'date',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
    },
    { key: 'fromWarehouse', title: 'From' },
    { key: 'toWarehouse', title: 'To' },
    { key: 'productName', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'sentQty', title: 'Sent', render: (v: number) => formatPieces(v) },
    {
      key: 'receivedQty',
      title: 'Received',
      render: (value: number | null) => (value === null ? '—' : formatPieces(value)),
      exportValue: (row: TransferReportRow) =>
        row.receivedQty === null ? '' : String(row.receivedQty),
    },
    {
      key: 'shortfall',
      title: 'Shortfall',
      render: (value: number | null) => {
        if (value === null) return '—';
        if (value === 0) return '0';
        return <span className={styles.criticalBadge}>{formatPieces(value)}</span>;
      },
      exportValue: (row: TransferReportRow) => (row.shortfall === null ? '' : String(row.shortfall)),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value === 'approved' ? 'in_transit' : value} />,
      exportValue: (row: TransferReportRow) =>
        TRANSFER_STATUS_LABELS[row.status as never] ?? row.status,
    },
    { key: 'approvedByName', title: 'Approved by', render: (v: string) => v || '—' },
    { key: 'receivedByName', title: 'Received by', render: (v: string) => v || '—' },
  ];

  const damageColumns: TableColumnConfig[] = [
    {
      key: 'documentNo', total: 'none' as const,
      title: 'Entry #',
      render: (value: number) => (value ? String(value).padStart(5, '0') : '—'),
    },
    {
      key: 'date',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
    },
    { key: 'warehouse', title: 'Warehouse' },
    { key: 'productName', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'quantity', title: 'Pieces', render: (v: number) => formatPieces(v) },
    {
      key: 'source',
      title: 'Type',
      render: (value: string) => <StatusBadge status={value} />,
      exportValue: (row: DamageReportRow) =>
        DAMAGE_SOURCE_LABELS[row.source as never] ?? row.source,
    },
    { key: 'clientName', title: 'Client', render: (v: string) => v || '—' },
    { key: 'reason', title: 'Reason', render: (v: string) => v || '—' },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    { key: 'raisedByName', title: 'Raised by', render: (v: string) => v || '—' },
    { key: 'approvedByName', title: 'Approved by', render: (v: string) => v || '—' },
    {
      key: 'approvedAt',
      title: 'Approved at',
      render: (value: string | null) => (value ? format(new Date(value), 'MMM dd, yyyy') : '—'),
      exportValue: (row: DamageReportRow) =>
        row.approvedAt ? format(new Date(row.approvedAt), 'yyyy-MM-dd') : '',
    },
  ];

  const countColumns: TableColumnConfig[] = [
    {
      key: 'documentNo', total: 'none' as const,
      title: 'Count #',
      render: (value: number | null) => (value ? String(value).padStart(5, '0') : '—'),
    },
    { key: 'periodMonth', title: 'Month' },
    { key: 'warehouseName', title: 'Warehouse' },
    { key: 'productName', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'systemSellable', title: 'System sellable', render: (v: number) => formatPieces(v) },
    { key: 'countedSellable', title: 'Counted sellable', render: (v: number) => formatPieces(v) },
    {
      key: 'diffSellable',
      title: 'Diff sellable',
      render: (value: number) =>
        value === 0 ? (
          '—'
        ) : (
          <span style={{ color: value > 0 ? '#047857' : '#b91c1c', fontWeight: 700 }}>
            {value > 0 ? `+${value}` : value}
          </span>
        ),
      exportValue: (row: CountReportRow) => String(row.diffSellable),
    },
    { key: 'systemDamaged', title: 'System damaged', render: (v: number) => formatPieces(v) },
    { key: 'countedDamaged', title: 'Counted damaged', render: (v: number) => formatPieces(v) },
    {
      key: 'diffDamaged',
      title: 'Diff damaged',
      render: (value: number) =>
        value === 0 ? (
          '—'
        ) : (
          <span style={{ color: value > 0 ? '#047857' : '#b91c1c', fontWeight: 700 }}>
            {value > 0 ? `+${value}` : value}
          </span>
        ),
      exportValue: (row: CountReportRow) => String(row.diffDamaged),
    },
    { key: 'note', title: 'Note', render: (v: string) => v || '—' },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value === 'submitted' ? 'pending' : value} />,
    },
    { key: 'approvedByName', title: 'Approved by', render: (v: string) => v || '—' },
  ];

  // Memoized because the valuation export builder depends on it.
  const bestSellerColumns = useMemo<TableColumnConfig[]>(
    () => [
      { key: 'productName', title: 'Product' },
      { key: 'barcode', title: 'Barcode' },
      { key: 'qtySold', title: 'Pieces sold', render: (v: number) => formatPieces(v) },
      { key: 'revenue', totalFormat: formatRsExact, title: 'Revenue', render: (v: number) => formatRsExact(v) },
      {
        key: 'currentSellableQty',
        title: 'Sellable now',
        render: (v: number) => formatPieces(v),
      },
    ],
    [],
  );

  const handleApply = () => setAppliedFilters(filters);
  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };

  /*
   * `handlePrint` removed. Reports are view-only for every role, Admin included.
   *
   * Warehouse SLIPS keep their print path and are untouched — a stock-in, transfer or
   * damage slip is an operational document that staff hand over with the goods. This screen
   * is a report, which is a different thing.
   */

  const valuationCards = useCallback(() => {
    const s = valuation?.summary;
    if (!s) return [];
    const cards = [
      { label: 'Sellable pieces', value: formatPieces(s.totalSellablePieces) },
      { label: 'Damaged / claim pieces', value: formatPieces(s.totalDamagedPieces) },
      { label: 'In transit', value: formatPieces(s.totalInTransitPieces) },
      { label: 'Products below their level', value: String(s.lowStockProductCount) },
      { label: 'Could sell for', value: formatRs(s.potentialSaleValue) },
      { label: 'Pieces sold in period', value: formatPieces(s.unitsSoldInPeriod) },
      { label: 'Sales revenue in period', value: formatRs(s.salesRevenueInPeriod) },
    ];
    if (showCost && s.currentStockValue !== undefined) {
      cards.splice(4, 0, { label: 'Stock value (at cost)', value: formatRs(s.currentStockValue) });
      cards.push({
        label: 'Damaged stock value',
        value: formatRs(s.damagedStockValue ?? 0),
      });
      cards.push({
        label: 'Gross profit in period',
        value: formatRs(s.grossProfitInPeriod ?? 0),
      });
    }
    return cards;
  }, [showCost, valuation]);

  const showDateFilters =
    activeTab === 'movement' ||
    activeTab === 'transfers' ||
    activeTab === 'damage' ||
    activeTab === 'valuation';
  const mismatchCount = useMemo(
    () => new Set(transferRows.filter((r) => r.status === 'mismatch').map((r) => r.documentNo)).size,
    [transferRows],
  );

  /** Valuation is a card summary plus the best-seller table; the export carries both. */
  const buildValuationExport = useCallback(
    (): AnalyticsExportPayload => ({
      filename: 'warehouse-valuation',
      title: 'Warehouse Valuation',
      subtitle: exportPdfTitle,
      kpis: valuationCards().map((card) => ({ label: card.label, value: card.value })),
      tables: [
        {
          title: 'Best sellers',
          columns: bestSellerColumns as TableExportColumn[],
          rows: valuation?.bestSellers ?? [],
        },
      ],
    }),
    [bestSellerColumns, exportPdfTitle, valuation, valuationCards],
  );

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Warehouse Reports</h1>
        </div>

        <WarehouseModuleNav active="reports" />

        <div className={styles.tabs}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'stock' && lowCount > 0 && (
                <span className={styles.alertBadge}>{lowCount}</span>
              )}
              {tab.id === 'transfers' && mismatchCount > 0 && (
                <span className={styles.alertBadge}>{mismatchCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <label htmlFor="warehouseId">Warehouse</label>
            <SearchableSelect
              id="warehouseId"
              name="warehouseId"
              value={filters.warehouseId}
              onChange={(e) => setFilters((p) => ({ ...p, warehouseId: e.target.value }))}
              options={warehouseSelectOptions(warehouses, { includeAll: true })}
            />
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor="productId">Product</label>
            <SearchableSelect
              id="productId"
              name="productId"
              value={filters.productId}
              onChange={(e) => setFilters((p) => ({ ...p, productId: e.target.value }))}
              options={[
                { value: '', label: 'All products' },
                ...products.map((p) => ({ value: p._id, label: `${p.name} (${p.barcode})` })),
              ]}
            />
          </div>

          {activeTab !== 'movement' && (
            <div className={styles.filterGroup}>
              <label htmlFor="categoryId">Category</label>
              <SearchableSelect
                id="categoryId"
                name="categoryId"
                value={filters.categoryId}
                onChange={(e) => setFilters((p) => ({ ...p, categoryId: e.target.value }))}
                options={[
                  { value: '', label: 'All categories' },
                  ...categories.map((c: any) => ({ value: c._id, label: c.name })),
                ]}
              />
            </div>
          )}

          {activeTab === 'movement' && (
            <>
              <div className={styles.filterGroup}>
                <label htmlFor="bucket">Bucket</label>
                <SearchableSelect
                  id="bucket"
                  name="bucket"
                  value={filters.bucket}
                  onChange={(e) => setFilters((p) => ({ ...p, bucket: e.target.value }))}
                  options={[
                    { value: '', label: 'All buckets' },
                    ...Object.entries(BUCKET_LABELS).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </div>
              <div className={styles.filterGroup}>
                <label htmlFor="movementType">Movement type</label>
                <SearchableSelect
                  id="movementType"
                  name="movementType"
                  value={filters.movementType}
                  onChange={(e) => setFilters((p) => ({ ...p, movementType: e.target.value }))}
                  options={[
                    { value: '', label: 'All movements' },
                    ...Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                />
              </div>
            </>
          )}

          {showDateFilters && (
            <>
              <div className={styles.filterGroup}>
                <label>From</label>
                <DatePickerFilter
                  value={filters.startDate}
                  onChange={(v) => setFilters((p) => ({ ...p, startDate: v }))}
                  placeholder="From date"
                />
              </div>
              <div className={styles.filterGroup}>
                <label>To</label>
                <DatePickerFilter
                  value={filters.endDate}
                  onChange={(v) => setFilters((p) => ({ ...p, endDate: v }))}
                  placeholder="To date"
                />
              </div>
            </>
          )}

          {activeTab === 'count' && (
            <div className={styles.filterGroup}>
              <label htmlFor="periodMonth">Month</label>
              <input
                id="periodMonth"
                type="month"
                className={styles.filterInput}
                value={filters.periodMonth}
                onChange={(e) => setFilters((p) => ({ ...p, periodMonth: e.target.value }))}
              />
            </div>
          )}

          {(activeTab === 'transfers' || activeTab === 'damage' || activeTab === 'count') && (
            <div className={styles.filterGroup}>
              <label htmlFor="status">Status</label>
              <SearchableSelect
                id="status"
                name="status"
                value={filters.status}
                onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
                options={
                  activeTab === 'transfers'
                    ? [
                        { value: '', label: 'All statuses' },
                        ...Object.entries(TRANSFER_STATUS_LABELS).map(([value, label]) => ({
                          value,
                          label,
                        })),
                      ]
                    : [
                        { value: '', label: 'All statuses' },
                        { value: 'pending', label: 'Pending' },
                        { value: 'approved', label: 'Approved' },
                        { value: 'rejected', label: 'Rejected' },
                        { value: 'cancelled', label: 'Cancelled' },
                      ]
                }
              />
            </div>
          )}

          {activeTab === 'transfers' && (
            <div className={styles.filterGroup}>
              <label htmlFor="mismatchOnly">Mismatches</label>
              <SearchableSelect
                id="mismatchOnly"
                name="mismatchOnly"
                value={filters.mismatchOnly ? 'true' : ''}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, mismatchOnly: e.target.value === 'true' }))
                }
                options={[
                  { value: '', label: 'All transfers' },
                  { value: 'true', label: 'Mismatches only' },
                ]}
              />
            </div>
          )}

          {activeTab === 'damage' && (
            <div className={styles.filterGroup}>
              <label htmlFor="damageSource">Type</label>
              <SearchableSelect
                id="damageSource"
                name="damageSource"
                value={filters.damageSource}
                onChange={(e) => setFilters((p) => ({ ...p, damageSource: e.target.value }))}
                options={[
                  { value: '', label: 'All types' },
                  ...Object.entries(DAMAGE_SOURCE_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </div>
          )}

          {activeTab === 'damage' && (
            <div className={styles.filterGroup}>
              <label htmlFor="damageSearch">Client</label>
              <input
                id="damageSearch"
                className={styles.filterInput}
                placeholder="Client name…"
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApply();
                }}
              />
            </div>
          )}

          {activeTab === 'stock' && (
            <>
              <div className={styles.filterGroup}>
                <label htmlFor="search">Search</label>
                <input
                  id="search"
                  className={styles.filterInput}
                  placeholder="Product or barcode…"
                  value={filters.search}
                  onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApply();
                  }}
                />
              </div>
              <div className={styles.filterGroup}>
                <label htmlFor="lowOnly">Low stock</label>
                <SearchableSelect
                  id="lowOnly"
                  name="lowOnly"
                  value={filters.lowOnly ? 'true' : ''}
                  onChange={(e) => setFilters((p) => ({ ...p, lowOnly: e.target.value === 'true' }))}
                  options={[
                    { value: '', label: 'All products' },
                    { value: 'true', label: 'Low stock only' },
                  ]}
                />
              </div>
            </>
          )}

          <div className={styles.filterActions}>
            <button className={styles.applyButton} onClick={handleApply} disabled={loading}>
              Apply
            </button>
            <button className={styles.resetButton} onClick={handleReset} disabled={loading}>
              Reset
            </button>
          </div>
        </div>

        {activeFilterLabels.length > 0 && (
          <p className={styles.periodLabel}>Filtered by: {activeFilterLabels.join(', ')}</p>
        )}

        {activeTab === 'stock' && (
          <>
            {lowCount > 0 && (
              <div className={styles.lowStockCallout}>
                {lowCount} product(s) are at or below their low-stock level. The level is a total
                across every warehouse, so a product can be low overall while one warehouse still
                has plenty.
              </div>
            )}
            <Table
              columns={stockColumns}
              data={stockRows}
              loading={loading}
              paginate
              pageSize={25}
              exportFileName="warehouse-stock-on-hand"
              exportPdfTitle={exportPdfTitle}
              showGrandTotal
              noDataText="No stock matches these filters."
            />
          </>
        )}

        {activeTab === 'movement' && (
          <>
            {!appliedFilters.productId && movementRows.length >= 2000 && (
              <div className={styles.lowStockCallout}>
                Showing the most recent 2,000 movements. Pick a product or a date range to narrow it
                down.
              </div>
            )}
            <Table
              columns={movementColumns}
              data={movementRows}
              loading={loading}
              paginate
              pageSize={25}
              exportFileName="warehouse-stock-movements"
              exportPdfTitle={exportPdfTitle}
              showGrandTotal
              noDataText="No stock movements match these filters."
            />
          </>
        )}

        {activeTab === 'transfers' && (
          <>
            {mismatchCount > 0 && (
              <div className={styles.lowStockCallout}>
                {mismatchCount} transfer(s) arrived short and are still waiting for an admin to write
                the shortfall off or return it to the source. Until then those pieces sit in the
                sending warehouse&apos;s in-transit bucket.
              </div>
            )}
            <Table
              columns={transferColumns}
              data={transferRows}
              loading={loading}
              paginate
              pageSize={25}
              exportFileName="warehouse-transfer-history"
              exportPdfTitle={exportPdfTitle}
              showGrandTotal
              noDataText="No transfers match these filters."
            />
          </>
        )}

        {activeTab === 'damage' && (
          <Table
            columns={damageColumns}
            data={damageRows}
            loading={loading}
            paginate
            pageSize={25}
            exportFileName="warehouse-damage-claims"
            exportPdfTitle={exportPdfTitle}
            showGrandTotal
            noDataText="No damage or claim entries match these filters."
          />
        )}

        {activeTab === 'count' && (
          <Table
            columns={countColumns}
            data={countRows}
            loading={loading}
            paginate
            pageSize={25}
            exportFileName="monthly-stock-count-report"
            exportPdfTitle={exportPdfTitle}
            showGrandTotal
            noDataText="No stock counts match these filters."
          />
        )}

        {activeTab === 'valuation' && (
          <>
            <div
              style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}
            >
              <AnalyticsExportButton
                buildPayload={buildValuationExport}
                disabled={loading}
                ariaLabel="Export warehouse valuation"
              />
            </div>
            <div className={styles.plGrid}>
              {valuationCards().map((card) => (
                <div key={card.label} className={styles.plCard}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>

            <div className={styles.lowStockCallout}>
              Stock figures are as of now; sales figures cover the selected date range and count
              delivered orders only.
            </div>

            <h2 style={{ marginTop: 24, marginBottom: 12, fontSize: '1.0625rem' }}>Best sellers</h2>
            <Table
              columns={bestSellerColumns}
              data={valuation?.bestSellers ?? []}
              loading={loading}
              paginate
              pageSize={25}
              exportFileName="warehouse-best-sellers"
              exportPdfTitle={`Best Sellers — ${exportPdfTitle}`}
              showGrandTotal
              noDataText="No delivered sales in this period."
            />
          </>
        )}
      </div>
    </Layout>
  );
}

export default function WarehouseReportsPageWrapper() {
  return (
    <ProtectedRoute reportPrefix="warehouse-reports.">
      <WarehouseReportsPage />
    </ProtectedRoute>
  );
}
