import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import {
  warehouseService,
  StockMatrix,
  StockMatrixProductRow,
} from '../../../services/warehouseService';
import { categoryService } from '../../../services/categoryService';
import { useAuth } from '../../../contexts/AuthContext';
import { can } from '../../../utils/permissions';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatPieces } from '../../../utils/formatCurrency';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import gridStyles from '../../../styles/OpeningStockGrid.module.scss';
import reportStyles from '../../../styles/Reports.module.scss';

/**
 * Live stock, as a product × warehouse grid.
 *
 * This is the REALTIME view. The opening-stock grid next door looks almost identical but shows
 * only what an operator declared the warehouse started with — it deliberately ignores Stock In,
 * transfers and sales. This one reads the ledger balances, so it is what the warehouse actually
 * holds right now.
 *
 * Hand-rolled `<table>` on purpose: the shared `Table` wraps react-data-table-component, which
 * re-renders cells on its own sort/paginate state, and inputs inside it lose focus and typed
 * values. Same constraint the opening-stock grid documents.
 */

type Bucket = 'sellable' | 'damaged';
const BUCKETS: Bucket[] = ['sellable', 'damaged'];

/** `warehouseId:productId:bucket` — one box, one key. */
const cellKey = (warehouseId: string, productId: string, bucket: Bucket) =>
  `${warehouseId}:${productId}:${bucket}`;

/**
 * Recorded on every ledger row when the operator does not type their own. A reason is mandatory
 * on the API and lands in the audit trail, so this screen never blocks on one — it supplies a
 * truthful default instead.
 */
const DEFAULT_REASON = 'Inline correction from the stock matrix';

const PAGE_SIZE = 100;
const STALE_AFTER_MS = 5 * 60_000;

interface PendingChange {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  bucket: Bucket;
  /** The figure on screen when it was typed — sent as the `expected*` baseline. */
  from: number;
  to: number;
}

const baselineOf = (row: StockMatrixProductRow, warehouseId: string, bucket: Bucket) =>
  row.cells[warehouseId]?.[bucket] ?? 0;

const StockMatrixPage: React.FC = () => {
  const { user } = useAuth();
  // `stock:adjust` is in no permission Set, so this is an exact admin test.
  const canAdjust = can(user?.role, 'stock:adjust');

  const [matrix, setMatrix] = useState<StockMatrix | null>(null);
  const [categories, setCategories] = useState<{ _id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /** ONLY the boxes that have been typed in. Everything else reads its baseline from `matrix`. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Cells whose stored figure moved while they were being edited — shown red, not amber. */
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [nonZeroOnly, setNonZeroOnly] = useState(false);
  const [page, setPage] = useState(0);

  const debouncedSearch = useDebouncedValue(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await warehouseService.getStockMatrix({
        search: debouncedSearch || undefined,
        categoryId: categoryId || undefined,
        lowOnly: lowOnly || undefined,
        nonZeroOnly: nonZeroOnly || undefined,
      });
      setMatrix(data);

      // Reconcile drafts against what actually came back. Without this, a draft for a product or
      // warehouse that has since disappeared counts as pending forever and Save never clears.
      setDrafts((prev) => {
        const productIds = new Set(data.products.map((p) => p.productId));
        const warehouseIds = new Set(data.warehouses.map((w) => w._id));
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(prev)) {
          const [warehouseId, productId] = key.split(':');
          if (productIds.has(productId) && warehouseIds.has(warehouseId)) next[key] = value;
        }
        return next;
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load the stock matrix'));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, categoryId, lowOnly, nonZeroOnly]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    categoryService.getCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, categoryId, lowOnly, nonZeroOnly]);

  /**
   * Every box whose typed figure differs from the stored one.
   *
   * Walks the FULL product list, not the paginated view, so turning a page never silently drops
   * something already typed. A bucket that was never touched produces nothing at all — which is
   * what keeps an absolute correction from overwriting a movement the operator never saw.
   */
  const pending = useMemo<PendingChange[]>(() => {
    if (!matrix) return [];
    const out: PendingChange[] = [];

    for (const row of matrix.products) {
      for (const warehouse of matrix.warehouses) {
        // The ledger refuses to move stock at an inactive warehouse, so a draft there could only
        // produce an error the operator cannot act on.
        if (!warehouse.isActive) continue;

        for (const bucket of BUCKETS) {
          const typed = drafts[cellKey(warehouse._id, row.productId, bucket)];
          if (typed === undefined) continue;
          if (typed.trim() === '') continue;
          const to = Number(typed);
          if (!Number.isInteger(to) || to < 0) continue;
          const from = baselineOf(row, warehouse._id, bucket);
          if (to === from) continue;
          out.push({
            warehouseId: warehouse._id,
            warehouseName: warehouse.name,
            productId: row.productId,
            productName: row.name,
            bucket,
            from,
            to,
          });
        }
      }
    }
    return out;
  }, [matrix, drafts]);

  /** Boxes that have been typed into but hold something that is not a whole, non-negative number. */
  const invalidKeys = useMemo(() => {
    const bad = new Set<string>();
    for (const [key, value] of Object.entries(drafts)) {
      if (value.trim() === '') {
        bad.add(key);
        continue;
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) bad.add(key);
    }
    return bad;
  }, [drafts]);

  const isStale =
    matrix != null &&
    pending.length > 0 &&
    Date.now() - new Date(matrix.generatedAt).getTime() > STALE_AFTER_MS;

  const setCell = (warehouseId: string, productId: string, bucket: Bucket, value: string) => {
    const key = cellKey(warehouseId, productId, bucket);
    setDrafts((prev) => ({ ...prev, [key]: value }));
    // A cell being re-typed is no longer in conflict; let it turn amber again.
    setConflicts((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!matrix || pending.length === 0) return;
    if (invalidKeys.size > 0) {
      toast.error('Some boxes hold something other than a whole number. Fix those first.');
      return;
    }

    setSaving(true);
    const effectiveReason = reason.trim() || DEFAULT_REASON;

    // One call per warehouse: `adjustStock` is all-or-nothing per warehouse, so one column can
    // conflict while the others land.
    const byWarehouse = new Map<string, PendingChange[]>();
    for (const change of pending) {
      const list = byWarehouse.get(change.warehouseId) ?? [];
      list.push(change);
      byWarehouse.set(change.warehouseId, list);
    }

    const failures: { warehouseName: string; message: string }[] = [];
    let savedWarehouses = 0;
    let savedCells = 0;

    for (const [warehouseId, changes] of byWarehouse) {
      // Merge the two buckets of one product into a single line, carrying the baseline for each.
      const byProduct = new Map<string, Record<string, number>>();
      for (const change of changes) {
        const line = byProduct.get(change.productId) ?? { productId: change.productId as never };
        line[change.bucket] = change.to;
        line[change.bucket === 'sellable' ? 'expectedSellable' : 'expectedDamaged'] = change.from;
        byProduct.set(change.productId, line);
      }

      try {
        await warehouseService.adjustStock({
          warehouseId,
          reason: effectiveReason,
          lines: [...byProduct.entries()].map(([productId, line]) => ({
            ...(line as object),
            productId,
          })) as never,
        });
        savedWarehouses += 1;
        savedCells += changes.length;
      } catch (error) {
        failures.push({
          warehouseName: changes[0]?.warehouseName ?? warehouseId,
          message: getApiErrorMessage(error, 'Failed'),
        });
      }
    }

    const fresh = await warehouseService
      .getStockMatrix({
        search: debouncedSearch || undefined,
        categoryId: categoryId || undefined,
        lowOnly: lowOnly || undefined,
        nonZeroOnly: nonZeroOnly || undefined,
      })
      .catch(() => null);

    if (fresh) {
      setMatrix(fresh);

      // Keep only the drafts that did not land, and mark the ones the server refused because the
      // figure moved underneath them — the operator gets their typing back, in red.
      const stillPending: Record<string, string> = {};
      const nowConflicting = new Set<string>();
      const freshById = new Map(fresh.products.map((p) => [p.productId, p]));

      for (const change of pending) {
        const key = cellKey(change.warehouseId, change.productId, change.bucket);
        const row = freshById.get(change.productId);
        if (!row) continue;
        const current = baselineOf(row, change.warehouseId, change.bucket);
        if (current === change.to) continue; // it landed
        stillPending[key] = String(change.to);
        if (current !== change.from) nowConflicting.add(key);
      }

      setDrafts(stillPending);
      setConflicts(nowConflicting);
    }

    setSaving(false);

    if (failures.length === 0) {
      toast.success(`Saved ${savedCells} change${savedCells === 1 ? '' : 's'}.`);
      setReason('');
    } else {
      const savedNote = savedWarehouses > 0 ? `${savedWarehouses} warehouse(s) saved. ` : '';
      toast.warn(
        `${savedNote}${failures.length} could not be saved — ` +
          failures.map((f) => `${f.warehouseName}: ${f.message}`).join(' | '),
        { autoClose: false },
      );
    }
  };

  const products = matrix?.products ?? [];
  const pageCount = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const visible = products.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  /** Row totals recomputed from drafts, so the effect of a change is visible before saving. */
  const liveTotals = (row: StockMatrixProductRow) => {
    if (!matrix) return { sellable: 0, damaged: 0, onHand: 0 };
    let sellable = 0;
    let damaged = 0;
    for (const warehouse of matrix.warehouses) {
      for (const bucket of BUCKETS) {
        const typed = drafts[cellKey(warehouse._id, row.productId, bucket)];
        const base = baselineOf(row, warehouse._id, bucket);
        const n = typed !== undefined && typed.trim() !== '' ? Number(typed) : base;
        const value = Number.isInteger(n) && n >= 0 ? n : base;
        if (bucket === 'sellable') sellable += value;
        else damaged += value;
      }
    }
    return { sellable, damaged, onHand: sellable + damaged };
  };

  return (
    <Layout>
      <div className={reportStyles.page}>
        <div className={reportStyles.header}>
          <h1>Stock Matrix</h1>
        </div>

        <WarehouseModuleNav active="stock-matrix" />

        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.75rem 0 0' }}>
          Live stock across every warehouse.{' '}
          {canAdjust
            ? 'Type over a figure to correct it — the difference is posted to the ledger and audited.'
            : 'Read-only for your role.'}
        </p>

        <div className={gridStyles.toolbar}>
          <div className={gridStyles.searchBox}>
            <MagnifyingGlass size={16} weight="bold" />
            <input
              aria-label="Search by name or SKU"
              placeholder="Search by name or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SearchableSelect
            name="categoryFilter"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            style={{ maxWidth: 200 }}
            placeholder="All Categories"
            options={[
              { value: '', label: 'All Categories' },
              ...categories.map((c) => ({ value: c._id, label: c.name })),
            ]}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8125rem' }}>
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8125rem' }}>
            <input
              type="checkbox"
              checked={nonZeroOnly}
              onChange={(e) => setNonZeroOnly(e.target.checked)}
            />
            Hide empty products
          </label>
          <span className={gridStyles.entryCount}>
            {matrix && (
              <>
                as of{' '}
                <strong>{new Date(matrix.generatedAt).toLocaleTimeString()}</strong>
                {pending.length > 0 && (
                  <>
                    {' · '}
                    <strong>{pending.length}</strong> unsaved
                  </>
                )}
              </>
            )}
          </span>
          <button
            type="button"
            className={gridStyles.modeButton}
            onClick={load}
            disabled={loading || saving}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {isStale && (
          <p className={gridStyles.stalenessNote}>
            These figures were read more than five minutes ago and you have unsaved changes. Stock
            may have moved since. Refreshing will discard what you typed — saving will refuse any
            figure that has changed underneath you.
          </p>
        )}

        {matrix?.truncated && (
          <p className={gridStyles.stalenessNote}>
            Only the first {products.length} products are shown. Narrow the search or pick a
            category to see the rest.
          </p>
        )}

        {loading && !matrix && <p>Loading the grid…</p>}

        {!loading && matrix && matrix.warehouses.length === 0 && (
          <div className={reportStyles.emptyState}>
            No warehouse yet. Create one first — stock is held per warehouse.
          </div>
        )}

        {matrix && matrix.warehouses.length > 0 && (
          <>
            <div className={gridStyles.tableScroll}>
              <table className={gridStyles.grid}>
                <thead>
                  <tr>
                    <th rowSpan={2} className={gridStyles.productHead}>
                      Product
                    </th>
                    <th
                      colSpan={3}
                      className={`${gridStyles.warehouseHead} ${gridStyles.totalsHead} ${gridStyles.groupEdge}`}
                      title="Across every warehouse. On hand is Sellable + Damaged; in-transit pieces are at no warehouse and are excluded."
                    >
                      All warehouses
                    </th>
                    {matrix.warehouses.map((warehouse) => (
                      <th
                        key={warehouse._id}
                        colSpan={2}
                        className={`${gridStyles.warehouseHead} ${gridStyles.groupEdge} ${
                          warehouse.isMain ? gridStyles.mainHead : ''
                        } ${warehouse.isActive ? '' : gridStyles.inactiveHead}`}
                      >
                        {warehouse.isMain ? 'Main' : warehouse.name}
                        {warehouse.isMain && warehouse.name.trim().toLowerCase() !== 'main' && (
                          <span className={gridStyles.warehouseSub}>{warehouse.name}</span>
                        )}
                        {!warehouse.isActive && (
                          <span className={gridStyles.warehouseSub}>Inactive — read only</span>
                        )}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className={`${gridStyles.bucketHead} ${gridStyles.groupEdge}`}>Sellable</th>
                    <th className={gridStyles.bucketHead}>Damaged</th>
                    <th className={gridStyles.bucketHead}>On hand</th>
                    {matrix.warehouses.map((warehouse) => (
                      <React.Fragment key={warehouse._id}>
                        <th className={`${gridStyles.bucketHead} ${gridStyles.groupEdge}`}>
                          Sellable
                        </th>
                        <th className={gridStyles.bucketHead}>Damaged</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const totals = liveTotals(row);
                    return (
                      <tr key={row.productId}>
                        <td className={gridStyles.productCell}>
                          <div className={gridStyles.productName}>
                            {row.name}
                            {row.isLow && <span className={gridStyles.lowBadge}>Low</span>}
                          </div>
                          <div className={gridStyles.productSku}>{row.barcode}</div>
                        </td>

                        <td className={`${gridStyles.totalsCell} ${gridStyles.groupEdge}`}>
                          {formatPieces(totals.sellable)}
                        </td>
                        <td className={gridStyles.totalsCell}>{formatPieces(totals.damaged)}</td>
                        <td className={`${gridStyles.totalsCell} ${gridStyles.onHandCell}`}>
                          {formatPieces(totals.onHand)}
                          {row.totalInTransit > 0 && (
                            <span className={gridStyles.transitChip}>
                              +{formatPieces(row.totalInTransit)} in transit
                            </span>
                          )}
                        </td>

                        {matrix.warehouses.map((warehouse) => {
                          const editable = canAdjust && warehouse.isActive;
                          return (
                            <React.Fragment key={warehouse._id}>
                              {BUCKETS.map((bucket) => {
                                const key = cellKey(warehouse._id, row.productId, bucket);
                                const baseline = baselineOf(row, warehouse._id, bucket);
                                const typed = drafts[key];
                                const value = typed ?? String(baseline);
                                const isDirty = typed !== undefined && Number(typed) !== baseline;
                                const isConflict = conflicts.has(key);
                                const isInvalid = invalidKeys.has(key);
                                const cellClass = `${gridStyles.qtyInput} ${
                                  isConflict || isInvalid
                                    ? gridStyles.conflict
                                    : isDirty
                                      ? gridStyles.dirty
                                      : ''
                                }`;

                                return (
                                  <td
                                    key={bucket}
                                    className={`${gridStyles.cell} ${
                                      bucket === 'sellable' ? gridStyles.groupEdge : ''
                                    }`}
                                  >
                                    {editable ? (
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        className={cellClass}
                                        aria-label={`${bucket} pieces of ${row.name} at ${warehouse.name}`}
                                        title={
                                          isConflict
                                            ? `This moved to ${baseline} while you were editing`
                                            : undefined
                                        }
                                        value={value}
                                        disabled={saving}
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) =>
                                          setCell(warehouse._id, row.productId, bucket, e.target.value)
                                        }
                                      />
                                    ) : (
                                      <span className={gridStyles.readonlyCell}>
                                        {formatPieces(baseline)}
                                      </span>
                                    )}
                                    {bucket === 'sellable' &&
                                      (row.cells[warehouse._id]?.inTransit ?? 0) > 0 && (
                                        <span className={gridStyles.transitChip}>
                                          {formatPieces(row.cells[warehouse._id]!.inTransit!)} in
                                          transit
                                        </span>
                                      )}
                                  </td>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {visible.length === 0 && (
                    <tr className={gridStyles.emptyRow}>
                      <td colSpan={4 + matrix.warehouses.length * 2}>
                        No product matches the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pageCount > 1 && (
              <div className={gridStyles.pager}>
                <button
                  type="button"
                  className={gridStyles.modeButton}
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  ← Previous
                </button>
                <span>
                  Page {page + 1} of {pageCount} · {products.length} products
                </span>
                <button
                  type="button"
                  className={gridStyles.modeButton}
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next →
                </button>
              </div>
            )}

            <p className={gridStyles.legend}>
              <span className={gridStyles.legendItem}>
                <span className={`${gridStyles.legendSwatch} ${gridStyles.dirty}`} aria-hidden="true" />
                Changed, not yet saved
              </span>
              <span className={gridStyles.legendItem}>
                <span className={`${gridStyles.legendSwatch} ${gridStyles.conflict}`} aria-hidden="true" />
                Moved while you were editing, or not a whole number
              </span>
              <span className={gridStyles.legendItem}>
                In-transit pieces are shown but cannot be edited — they belong to a transfer.
              </span>
            </p>

            {canAdjust && (
              <div className={gridStyles.saveBar}>
                <input
                  className={gridStyles.reasonInput}
                  placeholder={`Reason (optional) — defaults to: ${DEFAULT_REASON}`}
                  value={reason}
                  disabled={saving}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  type="button"
                  className={gridStyles.modeButtonActive}
                  disabled={pending.length === 0 || saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : `Save ${pending.length} change${pending.length === 1 ? '' : 's'}`}
                </button>
                <button
                  type="button"
                  className={gridStyles.modeButton}
                  disabled={pending.length === 0 || saving}
                  onClick={() => {
                    setDrafts({});
                    setConflicts(new Set());
                  }}
                >
                  Discard changes
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
};

export default function StockMatrixPageWrapper() {
  return (
    <ProtectedRoute
      allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff', 'sales_manager']}
    >
      <StockMatrixPage />
    </ProtectedRoute>
  );
}
