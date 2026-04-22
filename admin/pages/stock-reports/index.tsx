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
import { printTableAsPdf } from '../../utils/tableExport';
import styles from '../../styles/StockReports.module.scss';

type TabId = 'current' | 'hold' | 'damage' | 'pl' | 'lowstock';

const TABS: { id: TabId; label: string }[] = [
  { id: 'current', label: 'Current Stock' },
  { id: 'hold', label: 'Hold Stock' },
  { id: 'damage', label: 'Damage Stock' },
  { id: 'pl', label: 'Profit & Loss' },
  { id: 'lowstock', label: 'Low Stock Alerts' },
];

const TAB_EXPORT_LABEL: Record<TabId, string> = {
  current: 'Current Stock Report',
  hold: 'Hold Stock Report',
  damage: 'Damage Stock Report',
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
  const [activeTab, setActiveTab] = useState<TabId>('current');
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

  const handlePrint = async () => {
    try {
      if (activeTab === 'pl') {
        if (!plCards.length) {
          toast.error('No Profit & Loss data available to print');
          return;
        }
        await printTableAsPdf({
          title: exportPdfTitle,
          columns: [
            { key: 'label', title: 'Metric' },
            { key: 'value', title: 'Value' },
          ],
          data: plCards.map((c) => ({ label: c.label, value: c.value })),
        });
        return;
      }

      const tabConfig: Record<Exclude<TabId, 'pl'>, { columns: TableColumnConfig[]; data: unknown[] }> = {
        current: { columns: currentStockColumns, data: currentStock },
        hold: { columns: holdStockColumns, data: holdStock },
        damage: { columns: damageStockColumns, data: damageStock },
        lowstock: { columns: lowStockColumns, data: lowStock },
      };

      const config = tabConfig[activeTab as Exclude<TabId, 'pl'>];
      if (!config?.data.length) {
        toast.error('No rows available to print');
        return;
      }

      await printTableAsPdf({
        title: exportPdfTitle,
        columns: config.columns,
        data: config.data,
      });
    } catch {
      toast.error('Failed to generate printable PDF');
    }
  };

  // ─── Column definitions ────────────────────────────────────────────────────

  const currentStockColumns: TableColumnConfig[] = [
    { key: 'name', title: 'Product' },
    { key: 'barcode', title: 'Barcode' },
    { key: 'categoryName', title: 'Category' },
    {
      key: 'availableQty',
      title: 'Available Qty',
      render: (v) => <strong>{v}</strong>,
    },
    { key: 'onHoldQty', title: 'On Hold Qty' },
    { key: 'soldQtyInPeriod', title: 'Sold in Period' },
    {
      key: 'salePrice',
      title: 'Sale Price',
      render: (v) => formatCurrency(v),
    },
    {
      key: 'purchasePrice',
      title: 'Purchase Price',
      render: (v) => formatCurrency(v),
    },
    {
      key: 'survivalQuantity',
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
    },
    {
      key: 'unitPrice',
      title: 'Unit Price',
      render: (v) => formatCurrency(v),
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
    },
    {
      key: 'unitPrice',
      title: 'Unit Price',
      render: (v) => formatCurrency(v),
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
    },
    { key: 'survivalQuantity', title: 'Survival Qty' },
    {
      key: 'deficit',
      title: 'Deficit',
      render: (v) => (
        <span className={styles.criticalBadge}>-{v}</span>
      ),
    },
  ];

  // ─── P&L KPI card helper ──────────────────────────────────────────────────
  const pl = profitLoss?.summary;

  const plCards = pl
    ? [
        { label: 'Revenue', value: formatCurrency(pl.revenue) },
        { label: 'Cost of Goods (COGS)', value: formatCurrency(pl.cogs) },
        { label: 'Gross Profit', value: formatCurrency(pl.grossProfit), highlight: pl.grossProfit >= 0 ? 'profit' : 'loss' },
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
    : [];

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

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Stock Reports</h1>
          <div className={styles.headerActions}>
            <button className={styles.printButton} onClick={handlePrint}>
              Print / Save PDF
            </button>
          </div>
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
          {TABS.map((tab) => (
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
                <strong>No low stock alerts.</strong>
                Either all products are above their survival quantity, or survival quantities have not been
                set. Go to{' '}
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
    <ProtectedRoute allowedRoles={['admin']}>
      <StockReportsPage />
    </ProtectedRoute>
  );
}
