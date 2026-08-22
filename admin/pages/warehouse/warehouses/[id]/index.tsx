import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import Table, { TableColumnConfig } from '../../../../components/UI/Table';
import StatusBadge from '../../../../components/UI/StatusBadge';
import BucketQtyCell from '../../../../components/Warehouse/BucketQtyCell';
import ReasonModal from '../../../../components/Warehouse/ReasonModal';
import {
  warehouseService,
  Warehouse,
  StockRow,
  StockAdjustmentLine,
} from '../../../../services/warehouseService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { formatRsExact, formatPieces } from '../../../../utils/formatCurrency';
import { can } from '../../../../utils/permissions';
import { useAuth } from '../../../../contexts/AuthContext';
import styles from '../../../../styles/DetailPage.module.scss';
import formStyles from '../../../../styles/FormPage.module.scss';

/** What the user has typed for one product while the stock table is in edit mode. */
interface StockDraft {
  sellable: string;
  damaged: string;
}

/** One warehouse: its details plus everything it currently holds, product by product. */
function WarehouseDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, StockDraft>>({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  const showCost = can(user?.role, 'stock:set-low-level'); // admin-only, matches the API's redaction
  // In no permission Set, so `can()` is an exact admin test — the same gate the API route applies.
  const canAdjust = can(user?.role, 'stock:adjust');

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

  const startEditing = () => {
    setDrafts(
      Object.fromEntries(
        stock.map((row) => [row.productId, { sellable: String(row.sellable), damaged: String(row.damaged) }]),
      ),
    );
    setSearch('');
    setEditing(true);
  };

  const stopEditing = () => {
    setEditing(false);
    setDrafts({});
    setSearch('');
  };

  const updateDraft = (productId: string, patch: Partial<StockDraft>) => {
    setDrafts((prev) => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));
  };

  /** Rows whose typed figures differ from what the warehouse currently holds. */
  const pendingLines: StockAdjustmentLine[] = useMemo(() => {
    if (!editing) return [];
    const lines: StockAdjustmentLine[] = [];
    for (const row of stock) {
      const draft = drafts[row.productId];
      if (!draft) continue;
      const line: StockAdjustmentLine = { productId: row.productId };
      if (draft.sellable !== '' && Number(draft.sellable) !== row.sellable) {
        line.sellable = Number(draft.sellable);
      }
      if (draft.damaged !== '' && Number(draft.damaged) !== row.damaged) {
        line.damaged = Number(draft.damaged);
      }
      if (line.sellable !== undefined || line.damaged !== undefined) lines.push(line);
    }
    return lines;
  }, [editing, stock, drafts]);

  /**
   * Products with a figure that is blank or not a whole non-negative piece count. Tracked
   * separately from `pendingLines` — a cleared box is not a change, but it must still block the
   * save and say so, rather than leaving the button greyed out with no explanation.
   */
  const invalidProductIds = useMemo(() => {
    if (!editing) return new Set<string>();
    const bad = new Set<string>();
    for (const row of stock) {
      const draft = drafts[row.productId];
      if (!draft) continue;
      const broken = [draft.sellable, draft.damaged].some(
        (v) => v.trim() === '' || !Number.isInteger(Number(v)) || Number(v) < 0,
      );
      if (broken) bad.add(row.productId);
    }
    return bad;
  }, [editing, stock, drafts]);

  const visibleStock = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return stock;
    return stock.filter((row) => `${row.productName} ${row.barcode}`.toLowerCase().includes(needle));
  }, [stock, search]);

  const handleSaveClick = () => {
    if (invalidProductIds.size > 0) {
      toast.error(
        `Every figure must be a whole number of pieces, zero or more — ${invalidProductIds.size} row(s) need fixing`,
      );
      return;
    }
    if (pendingLines.length === 0) {
      toast.info('Nothing has changed yet');
      return;
    }
    setReasonOpen(true);
  };

  const handleConfirmSave = async (reason: string) => {
    if (!warehouse) return;
    setSaving(true);
    try {
      const result = await warehouseService.adjustStock({
        warehouseId: warehouse._id,
        reason,
        lines: pendingLines,
      });
      toast.success(
        `Stock corrected for ${result.adjustedProducts} product${result.adjustedProducts === 1 ? '' : 's'}`,
      );
      setReasonOpen(false);
      stopEditing();
      await fetchData();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to correct the stock'));
    } finally {
      setSaving(false);
    }
  };

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
    {
      key: 'sellable',
      title: 'Sellable',
      render: (v: number) => formatPieces(v),
      total: 'sum',
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'damaged',
      title: 'Damaged / Claim',
      render: (v: number) => formatPieces(v),
      total: 'sum',
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'inTransit',
      title: 'In Transit',
      render: (v: number) => formatPieces(v),
      total: 'sum',
      totalRender: (value: number) => formatPieces(value),
    },
    {
      key: 'totalSellableAllWarehouses',
      title: 'All warehouses',
      render: (v: number) => formatPieces(v),
      total: 'sum',
      totalRender: (value: number) => formatPieces(value),
    },
    ...(showCost
      ? [
          {
            // A sum of per-piece costs would be nonsense; the weighted average is the real figure.
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
            <div style={productsHeader}>
              <h2 style={{ marginBottom: 0, border: 'none', paddingBottom: 0 }}>Products</h2>
              {canAdjust && stock.length > 0 && !editing && (
                <button type="button" className={styles.editButton} onClick={startEditing}>
                  Edit quantities
                </button>
              )}
            </div>

            {editing ? (
              <StockEditor
                rows={visibleStock}
                drafts={drafts}
                search={search}
                searchable={stock.length > 12}
                pendingCount={pendingLines.length}
                invalidProductIds={invalidProductIds}
                saving={saving}
                onSearch={setSearch}
                onChange={updateDraft}
                onSave={handleSaveClick}
                onCancel={stopEditing}
              />
            ) : (
              <Table
                columns={columns}
                data={stock}
                loading={false}
                exportFileName={`stock-${warehouse.name.replace(/\s+/g, '-').toLowerCase()}`}
                exportPdfTitle={`Stock on hand — ${warehouse.name}`}
                noDataText="This warehouse holds no stock yet."
              />
            )}
          </div>
        </div>
      </div>

      <ReasonModal
        open={reasonOpen}
        title="Correct the stock figures"
        description={
          `${pendingLines.length} product(s) will be corrected at ${warehouse.name}. The difference is ` +
          'posted to the stock ledger as a manual adjustment, with your reason recorded against every ' +
          'line — nothing is overwritten silently.'
        }
        label="Reason for the correction"
        placeholder="e.g. Recount after the shelf was restacked"
        confirmLabel="Correct stock"
        busy={saving}
        onClose={() => {
          if (!saving) setReasonOpen(false);
        }}
        onConfirm={handleConfirmSave}
      />
    </Layout>
  );
}

/**
 * The editable Products grid.
 *
 * Hand-rolled rather than the shared `Table`, for the same reason as the stock-count sheet:
 * `GlobalDataTable` is read-only and re-renders cells on its own sort/paginate state, which makes
 * inputs inside it lose focus and typed values.
 */
interface StockEditorProps {
  rows: StockRow[];
  drafts: Record<string, StockDraft>;
  search: string;
  searchable: boolean;
  pendingCount: number;
  invalidProductIds: Set<string>;
  saving: boolean;
  onSearch: (value: string) => void;
  onChange: (productId: string, patch: Partial<StockDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

const StockEditor: React.FC<StockEditorProps> = ({
  rows,
  drafts,
  search,
  searchable,
  pendingCount,
  invalidProductIds,
  saving,
  onSearch,
  onChange,
  onSave,
  onCancel,
}) => (
  <>
    <p className={formStyles.hint} style={{ marginTop: 0 }}>
      Type what the figure <strong>should be</strong> — the difference is applied to the stock ledger
      as an audited manual adjustment. In transit is set by transfers and cannot be edited here.
    </p>

    {searchable && (
      <div className={formStyles.formGroup}>
        <label htmlFor="stock-editor-search">Find a product</label>
        <input
          id="stock-editor-search"
          className={formStyles.input}
          placeholder="Name or barcode…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <span className={formStyles.hint}>
          Filtering only changes what is shown — anything you have already typed is kept.
        </span>
      </div>
    )}

    <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
      <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={th}>Product</th>
            <th style={{ ...th, width: 120 }}>Barcode</th>
            <th style={{ ...th, width: 90, textAlign: 'right' }}>Now sellable</th>
            <th style={{ ...th, width: 120 }}>New sellable</th>
            <th style={{ ...th, width: 80, textAlign: 'right' }}>Diff</th>
            <th style={{ ...th, width: 90, textAlign: 'right' }}>Now damaged</th>
            <th style={{ ...th, width: 120 }}>New damaged</th>
            <th style={{ ...th, width: 80, textAlign: 'right' }}>Diff</th>
            <th style={{ ...th, width: 90, textAlign: 'right' }}>In transit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts[row.productId] ?? {
              sellable: String(row.sellable),
              damaged: String(row.damaged),
            };
            const ds = draft.sellable === '' ? 0 : Number(draft.sellable) - row.sellable;
            const dd = draft.damaged === '' ? 0 : Number(draft.damaged) - row.damaged;
            const invalid = invalidProductIds.has(row.productId);
            return (
              <tr key={row.productId}>
                <td style={td}>{row.productName}</td>
                <td style={td}>{row.barcode}</td>
                <td style={{ ...td, textAlign: 'right' }}>{formatPieces(row.sellable)}</td>
                <td style={td}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={formStyles.input}
                    style={invalid ? { margin: 0, borderColor: '#b91c1c' } : { margin: 0 }}
                    aria-label={`Sellable pieces for ${row.productName}`}
                    value={draft.sellable}
                    disabled={saving}
                    onChange={(e) => onChange(row.productId, { sellable: e.target.value })}
                  />
                </td>
                <td style={{ ...td, textAlign: 'right', ...diffStyle(ds) }}>
                  {ds === 0 ? '—' : ds > 0 ? `+${ds}` : String(ds)}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{formatPieces(row.damaged)}</td>
                <td style={td}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={formStyles.input}
                    style={invalid ? { margin: 0, borderColor: '#b91c1c' } : { margin: 0 }}
                    aria-label={`Damaged pieces for ${row.productName}`}
                    value={draft.damaged}
                    disabled={saving}
                    onChange={(e) => onChange(row.productId, { damaged: e.target.value })}
                  />
                </td>
                <td style={{ ...td, textAlign: 'right', ...diffStyle(dd) }}>
                  {dd === 0 ? '—' : dd > 0 ? `+${dd}` : String(dd)}
                </td>
                <td style={{ ...td, textAlign: 'right', color: '#6b7280' }}>
                  {formatPieces(row.inTransit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {rows.length === 0 && search && (
      <p className={formStyles.hint}>No product matches “{search}”.</p>
    )}

    <div className={formStyles.formActions}>
      <button type="button" className={formStyles.cancelButton} onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button
        type="button"
        className={formStyles.submitButton}
        onClick={onSave}
        // Stays clickable while a figure is invalid, so the click can explain what is wrong
        // instead of the button sitting greyed out for no visible reason.
        disabled={saving || (pendingCount === 0 && invalidProductIds.size === 0)}
      >
        {invalidProductIds.size > 0
          ? `Fix ${invalidProductIds.size} row${invalidProductIds.size === 1 ? '' : 's'}`
          : pendingCount === 0
            ? 'No changes'
            : `Save ${pendingCount} change${pendingCount === 1 ? '' : 's'}`}
      </button>
    </div>
  </>
);

function diffStyle(diff: number): React.CSSProperties {
  if (diff === 0) return { color: '#6b7280' };
  return { color: diff > 0 ? '#047857' : '#b91c1c', fontWeight: 700 };
}

const productsHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '1rem',
  flexWrap: 'wrap',
  marginBottom: '1rem',
  paddingBottom: '0.75rem',
  borderBottom: '1px solid #e5e7eb',
};

const th: React.CSSProperties = {
  padding: '0.5rem',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '1px solid #e5e7eb',
};

const td: React.CSSProperties = { padding: '0.5rem', borderBottom: '1px solid #f3f4f6' };

export default function WarehouseDetailPageWrapper() {
  return (
    <ProtectedRoute permission="warehouse:view">
      <WarehouseDetailPage />
    </ProtectedRoute>
  );
}
