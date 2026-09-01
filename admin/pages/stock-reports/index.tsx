import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table, { TableColumnConfig } from '../../components/UI/Table';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { categoryService, Category } from '../../services/categoryService';
import {
  stockReportService,
  CurrentStockRow,
  HoldStockRow,
  DamageStockRow,
  ProfitLossReport,
  LowStockRow,
} from '../../services/stockReportService';
import { toast } from 'react-toastify';

import { canViewReport } from '../../utils/permissions';
import { useAuth } from '../../contexts/AuthContext';
import { printTableAsPdf } from '../../utils/tableExport';
import AnalyticsExportButton from '../../components/UI/AnalyticsExportButton';
import type { AnalyticsExportPayload } from '../../utils/analyticsExport';
import styles from '../../styles/StockReports.module.scss';

type TabId = 'current' | 'hold' | 'damage' | 'pl' | 'lowstock';

/**
 * Each tab is a separately-grantable report and carries its own id. A role ticked for Profit
 * & Loss and nothing else sees exactly one tab here — the page-level gate only decides whether
 * they can open the screen at all.
 */
const TABS: { id: TabId; label: string; reportId: string }[] = [
  { id: 'current', label: 'Current Stock', reportId: 'stock-reports.current' },
  { id: 'hold', label: 'Hold Stock', reportId: 'stock-reports.hold' },
  // Dealer RETURN damage — a different concept from warehouse damage/claim entries, which live on
  // Warehouse → Reports. Renamed so the two are not mistaken for each other.
  { id: 'damage', label: 'Return Damage', reportId: 'stock-reports.damage' },
  { id: 'pl', label: 'Profit & Loss', reportId: 'stock-reports.pl' },
  { id: 'lowstock', label: 'Low Stock Alerts', reportId: 'stock-reports.lowstock' },
];

const TAB_EXPORT_LABEL: Record<TabId, string> = {
  current: 'Current Stock Report',
  hold: 'Hold Stock Report',
  damage: 'Return Damage Report',
  pl: 'Profit & Loss Report',
  lowstock: 'Low Stock Alerts',
};

function formatCurrency(val: number) {
  return `Rs. ${val.toFixed(2)}`;
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const StockReportsPage: React.FC = () => {
  const { access } = useAuth();
  // Only the tabs this user has been granted. Rendering a tab that answers 403 is worse than
  // omitting it — the person sees the report exists and cannot tell forbidden from broken.
  // Depends on `access`, NOT on []. Permissions arrive from /permissions/me after mount, so a
  // memo with empty deps runs once against an empty grant set and every tab disappears
  // permanently — the page renders as if the user had no reports at all.
  const visibleTabs = useMemo(() => TABS.filter((t) => canViewReport(t.reportId)), [access]);
  const [activeTab, setActiveTab] = useState<TabId>(() => visibleTabs[0]?.id ?? 'current');

  // The initialiser above runs on mount, before /permissions/me has answered, so it can leave
  // `activeTab` pointing at a tab the user turns out not to have. Correct it once the grants
  // land — otherwise they see a selected tab that is not in the tab strip, and an empty table.
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [visibleTabs, activeTab]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    categoryId: '',
    search: '',
  });
  const [appliedFilters, setAppliedFilters] = useState({ ...filters });

  // Report data
  const [currentStock, setCurrentStock] = useState<CurrentStockRow[]>([]);
  const [holdStock, setHoldStock] = useState<HoldStockRow[]>([]);
  const [damageStock, setDamageStock] = useState<DamageStockRow[]>([]);
  const [profitLoss, setProfitLoss] = useState<ProfitLossReport | null>(null);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);

  useEffect(() => {
    categoryService.getCategories().then(setCategories).catch(() => {});
  }, []);

  const fetchData = useCallback(
    async (tab: TabId, f: typeof appliedFilters) => {
      setLoading(true);
      try {
        const fObj = {
          startDate: f.startDate || undefined,
          endDate: f.endDate || undefined,
          categoryId: f.categoryId || undefined,
          search: f.search || undefined,
        };
        if (tab === 'current') setCurrentStock(await stockReportService.getCurrentStock(fObj));
        if (tab === 'hold') setHoldStock(await stockReportService.getHoldStock(fObj));
        if (tab === 'damage') setDamageStock(await stockReportService.getDamageStock(fObj));
        if (tab === 'pl') setProfitLoss(await stockReportService.getProfitLoss(fObj));
        if (tab === 'lowstock') setLowStock(await stockReportService.getLowStock(fObj));
      } catch {
        toast.error('Failed to load report data');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchData(activeTab, appliedFilters);
  }, [activeTab, appliedFilters, fetchData]);

  const handleApply = () => {
    setAppliedFilters({ ...filters });
  };

  const handleReset = () => {
    const empty = { startDate: '', endDate: '', categoryId: '', search: '' };
    setFilters(empty);
    setAppliedFilters(empty);
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
  };

  /*
   * `handlePrint` removed. Reports are view-only for every role, Admin included — no export,
   * print or download anywhere in the reporting screens.
   *
   * Operational documents keep their print path and are deliberately untouched: order
   * invoices, warehouse stock-in / transfer / damage slips, and the catalog download. Riders
   * and warehouse staff hand those to customers on paper.
   */

  // ─── Column definitions ────────────────────────────────────────────────────

  const currentStockColumns: TableColumnConfig[] = [
    { key: 'name', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'categoryName', title: 'Category' },
    {
      key: 'availableQty',
      // Now the sum of sellable stock across every warehouse. The per-warehouse split lives on
      // Warehouse → Reports → Stock on Hand.
      title: 'Total Sellable (all warehouses)',
      render: (v) => <strong>{v}</strong>,
      total: 'sum',
    },
    { key: 'onHoldQty', title: 'On Hold Qty', total: 'sum' },
    { key: 'soldQtyInPeriod', title: 'Sold in Period', total: 'sum' },
    {
      key: 'salePrice', total: 'none' as const,
      title: 'Sale Price',
      render: (v) => formatCurrency(v),
    },
    {
      key: 'purchasePrice', total: 'none' as const,
      title: 'Purchase Price',
      render: (v) => formatCurrency(v),
    },
    {
      key: 'survivalQuantity', total: 'none' as const,
      title: 'Survival Qty',
      render: (v) => (v != null ? v : <span style={{ color: '#9ca3af' }}>Not set</span>),
    },
  ];

  const holdStockColumns: TableColumnConfig[] = [
    { key: 'productName', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'categoryName', title: 'Category' },
    { key: 'dealerName', title: 'Dealer' },
    {
      key: 'qtyOnHold',
      title: 'Qty on Hold',
      render: (v) => <strong>{v}</strong>,
      total: 'sum',
    },
    {
      key: 'unitPrice',
      title: 'Unit Price',
      render: (v) => formatCurrency(v),
      // A sum of unit prices is meaningless; the held value is what an admin actually wants.
      total: 'sum',
      totalValue: (row) => (row.qtyOnHold ?? 0) * (row.unitPrice ?? 0),
      totalRender: (value) => `Value ${formatCurrency(value)}`,
    },
    { key: 'orderStatus', title: 'Order Status' },
    {
      key: 'orderDate',
      title: 'Order Date',
      render: (v) => formatDate(v),
      exportValue: (row) => formatDate(row.orderDate),
    },
  ];

  const damageStockColumns: TableColumnConfig[] = [
    { key: 'productName', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'categoryName', title: 'Category' },
    { key: 'dealerName', title: 'Dealer' },
    {
      key: 'damagedQty',
      title: 'Damaged Qty',
      render: (v) => <strong style={{ color: '#b91c1c' }}>{v}</strong>,
      total: 'sum',
    },
    {
      key: 'unitPrice',
      title: 'Unit Price',
      render: (v) => formatCurrency(v),
      total: 'sum',
      totalValue: (row) => (row.damagedQty ?? 0) * (row.unitPrice ?? 0),
      totalRender: (value) => `Value ${formatCurrency(value)}`,
    },
    { key: 'returnReason', title: 'Reason', render: (v) => v || '—' },
    { key: 'returnStatus', title: 'Status' },
    {
      key: 'returnDate',
      title: 'Return Date',
      render: (v) => formatDate(v),
      exportValue: (row) => formatDate(row.returnDate),
    },
  ];

  const lowStockColumns: TableColumnConfig[] = [
    { key: 'name', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'categoryName', title: 'Category' },
    {
      key: 'currentStock',
      title: 'Current Stock',
      render: (v, row: LowStockRow) => (
        <span className={v === 0 ? styles.criticalBadge : styles.warningBadge}>{v}</span>
      ),
      total: 'sum',
    },
    { key: 'survivalQuantity', total: 'none' as const, title: 'Survival Qty' },
    {
      key: 'deficit',
      title: 'Deficit',
      render: (v) => (
        <span className={styles.criticalBadge}>-{v}</span>
      ),
      total: 'sum',
      totalRender: (value) => `-${value.toLocaleString()}`,
    },
  ];

  // ─── P&L KPI card helper ──────────────────────────────────────────────────
  const pl = profitLoss?.summary;

  // Memoized because the Profit & Loss export builder depends on it.
  const plCards = useMemo(
    () =>
      pl
        ? [
            { label: 'Revenue', value: formatCurrency(pl.revenue) },
            { label: 'Cost of Goods (COGS)', value: formatCurrency(pl.cogs) },
            {
              label: 'Gross Profit',
              value: formatCurrency(pl.grossProfit),
              highlight: pl.grossProfit >= 0 ? 'profit' : 'loss',
            },
            { label: 'Return Payouts', value: formatCurrency(pl.totalReturnPayout) },
            { label: 'Damage Value', value: formatCurrency(pl.damageValue) },
            {
              label: 'Net P&L',
              value: formatCurrency(pl.netProfitLoss),
              highlight: pl.netProfitLoss >= 0 ? 'profit' : 'loss',
            },
            { label: 'Orders Delivered', value: String(pl.orderCount) },
            { label: 'Units Sold', value: String(pl.soldQty) },
            { label: 'Return Records', value: String(pl.returnCount) },
            { label: 'Units Damaged', value: String(pl.damagedQty) },
          ]
        : [],
    [pl],
  );

  const tabPeriodLabel = (f: typeof appliedFilters) => {
    if (!f.startDate && !f.endDate) return 'Period: Last 30 days (default)';
    if (f.startDate && f.endDate)
      return `Period: ${formatDate(f.startDate)} – ${formatDate(f.endDate)}`;
    if (f.startDate) return `From: ${formatDate(f.startDate)}`;
    return `Until: ${formatDate(f.endDate)}`;
  };

  const lowStockCount = lowStock.length;

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (appliedFilters.startDate || appliedFilters.endDate) {
      if (appliedFilters.startDate && appliedFilters.endDate) {
        parts.push(`Period: ${formatDate(appliedFilters.startDate)} – ${formatDate(appliedFilters.endDate)}`);
      } else if (appliedFilters.startDate) {
        parts.push(`From: ${formatDate(appliedFilters.startDate)}`);
      } else if (appliedFilters.endDate) {
        parts.push(`Until: ${formatDate(appliedFilters.endDate)}`);
      }
    } else {
      parts.push('Period: Last 30 days');
    }
    if (activeTab !== 'pl') {
      if (appliedFilters.categoryId) {
        const cat = categories.find((c) => c._id === appliedFilters.categoryId);
        parts.push(`Category: ${cat ? cat.name : appliedFilters.categoryId}`);
      }
      if (appliedFilters.search) {
        parts.push(`Search: "${appliedFilters.search}"`);
      }
    }
    return parts;
  }, [appliedFilters, categories, activeTab]);

  const exportPdfTitle = useMemo(() => {
    const base = TAB_EXPORT_LABEL[activeTab];
    return activeFilterLabels.length ? `${base} — Filtered by: ${activeFilterLabels.join(' · ')}` : base;
  }, [activeTab, activeFilterLabels]);

  const exportFileName = useMemo(() => {
    const base = TAB_EXPORT_LABEL[activeTab].toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-');
    if (!activeFilterLabels.length) return base;
    const filterSuffix = activeFilterLabels
      .map((label) => label.replace(/[^a-z0-9]+/gi, '-').toLowerCase())
      .join('_');
    return `${base}-${filterSuffix}`;
  }, [activeTab, activeFilterLabels]);

  /** The P&L tab is KPI cards only, so its export is the card list rather than a table. */
  const buildProfitLossExport = useCallback(
    (): AnalyticsExportPayload => ({
      filename: exportFileName,
      title: 'Profit & Loss',
      subtitle: exportPdfTitle,
      kpis: plCards.map((card) => ({ label: card.label, value: card.value })),
    }),
    [exportFileName, exportPdfTitle, plCards],
  );

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Stock Reports</h1>
        </div>

        {/* ─── Filters ────────────────────────────────────────────── */}
        <div className={styles.filterBar}>
          <div className={styles.filterGroup}>
            <label>From Date</label>
            <DatePickerFilter
              value={filters.startDate}
              onChange={(v) => setFilters((p) => ({ ...p, startDate: v }))}
              placeholder="Start date"
              title="From Date"
            />
          </div>
          <div className={styles.filterGroup}>
            <label>To Date</label>
            <DatePickerFilter
              value={filters.endDate}
              onChange={(v) => setFilters((p) => ({ ...p, endDate: v }))}
              placeholder="End date"
              title="To Date"
            />
          </div>
          {activeTab !== 'pl' && (
            <>
              <div className={styles.filterGroup}>
                <label>Category</label>
                <SearchableSelect
                  name="categoryId"
                  value={filters.categoryId}
                  onChange={(e) => setFilters((p) => ({ ...p, categoryId: e.target.value }))}
                  placeholder="All categories"
                  options={[
                    { value: '', label: 'All categories' },
                    ...categories.map((c) => ({ value: c._id, label: c.name })),
                  ]}
                />
              </div>
              <div className={styles.filterGroup}>
                <label>Search</label>
                <input
                  type="text"
                  className={styles.filterInput}
                  value={filters.search}
                  onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                  placeholder="Product name or barcode"
                  onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                />
              </div>
            </>
          )}
          <div className={styles.filterActions}>
            <button className={styles.applyButton} onClick={handleApply}>
              Apply
            </button>
            <button className={styles.resetButton} onClick={handleReset}>
              Reset
            </button>
          </div>
        </div>

        {/* ─── Tabs ────────────────────────────────────────────────── */}
        <div className={styles.tabs}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
              {tab.id === 'lowstock' && lowStockCount > 0 && (
                <span className={styles.alertBadge}>
                  {lowStockCount > 99 ? '99+' : lowStockCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <p className={styles.periodLabel}>{tabPeriodLabel(appliedFilters)}</p>

        {/* ─── Tab: Current Stock ───────────────────────────────────── */}
        {activeTab === 'current' && (
          <Table
            columns={currentStockColumns}
            data={currentStock}
            loading={loading}
            exportable
            exportFileName={exportFileName}
            exportPdfTitle={exportPdfTitle}
            exportFormats={['csv', 'pdf']}
            showGrandTotal
            noDataText="No products found."
          />
        )}

        {/* ─── Tab: Hold Stock ─────────────────────────────────────── */}
        {activeTab === 'hold' && (
          <Table
            columns={holdStockColumns}
            data={holdStock}
            loading={loading}
            exportable
            exportFileName={exportFileName}
            exportPdfTitle={exportPdfTitle}
            exportFormats={['csv', 'pdf']}
            showGrandTotal
            noDataText="No hold stock found for this period."
          />
        )}

        {/* ─── Tab: Damage Stock ───────────────────────────────────── */}
        {activeTab === 'damage' && (
          <Table
            columns={damageStockColumns}
            data={damageStock}
            loading={loading}
            exportable
            exportFileName={exportFileName}
            exportPdfTitle={exportPdfTitle}
            exportFormats={['csv', 'pdf']}
            showGrandTotal
            noDataText="No damage records found for this period."
          />
        )}

        {/* ─── Tab: Profit & Loss ──────────────────────────────────── */}
        {activeTab === 'pl' && (
          <>
            {loading ? (
              <p className={styles.periodLabel}>Loading…</p>
            ) : pl ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginBottom: '0.75rem',
                  }}
                >
                  <AnalyticsExportButton
                    buildPayload={buildProfitLossExport}
                    ariaLabel="Export profit and loss summary"
                  />
                </div>
                <div className={styles.plGrid}>
                  {plCards.map((card) => (
                    <div
                      key={card.label}
                      className={`${styles.plCard} ${
                        card.highlight === 'profit'
                          ? styles.plCardProfit
                          : card.highlight === 'loss'
                          ? styles.plCardLoss
                          : ''
                      }`}
                    >
                      <span>{card.label}</span>
                      <strong>{card.value}</strong>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                  * COGS is calculated using the purchase price recorded on each product at the time of report
                  generation. Products without a purchase price set contribute Rs. 0.00 to COGS.
                </p>
              </>
            ) : (
              <p className={styles.periodLabel}>No data available for this period.</p>
            )}
          </>
        )}

        {/* ─── Tab: Low Stock Alerts ───────────────────────────────── */}
        {activeTab === 'lowstock' && (
          <>
            {!loading && lowStock.length === 0 ? (
              <div className={styles.lowStockCallout}>
                <strong>No company-wide low stock alerts.</strong>
                The level is compared against total sellable stock across every warehouse, so a
                product can be fine overall while one warehouse is empty — check Warehouse →
                Reports → Stock on Hand for the per-warehouse picture. Either all products are above
                their survival quantity, or survival quantities have not been set. Go to{' '}
                <a href="/products" style={{ color: '#b45309', fontWeight: 600 }}>
                  Products
                </a>{' '}
                → Edit a product → set the{' '}
                <em>Survival Qty</em> field to enable low stock alerts.
              </div>
            ) : (
              <Table
                columns={lowStockColumns}
                data={lowStock}
                loading={loading}
                exportable
                exportFileName={exportFileName}
                exportPdfTitle={exportPdfTitle}
                exportFormats={['csv', 'pdf']}
                showGrandTotal
                noDataText="No low stock alerts."
              />
            )}
          </>
        )}
      </div>
    </Layout>
  );
};

export default function StockReportsPageWrapper() {
  return (
    <ProtectedRoute reportPrefix="stock-reports.">
      <StockReportsPage />
    </ProtectedRoute>
  );
}
