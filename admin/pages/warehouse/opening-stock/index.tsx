import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import { MagnifyingGlass } from '@phosphor-icons/react';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import {
  stockInService,
  OpeningStockStatus,
  OpeningStockCell,
} from '../../../services/stockInService';
import { productService, Product } from '../../../services/productService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { formatRsExact } from '../../../utils/formatCurrency';
import formStyles from '../../../styles/FormPage.module.scss';
import listStyles from '../../../styles/ListPage.module.scss';
import reportStyles from '../../../styles/StockReports.module.scss';
import gridStyles from '../../../styles/OpeningStockGrid.module.scss';

/**
 * One-time starting stock (spec §11): per warehouse, per product, split sellable / damaged, with a
 * quantity and a rate.
 *
 * Two ways in, because the two jobs are different shapes:
 *   • ALL WAREHOUSES — a product × warehouse grid. One pass over the catalogue covers every
 *     warehouse at once, and cells that already hold a figure are editable in place.
 *   • ONE WAREHOUSE — the original per-warehouse form, kept intact for setting up a single site.
 *
 * Both grids are hand-rolled rather than using the shared `Table`: that wraps
 * react-data-table-component, which is read-only and re-renders cells on its own sort and paginate
 * state — inputs inside it lose focus and typed values. Entries are held in a keyed record so the
 * search box filters what is DISPLAYED without discarding anything already typed.
 */
interface DraftLine {
  sellableQty: string;
  damagedQty: string;
  rate: string;
}

const emptyDraft = (): DraftLine => ({ sellableQty: '', damagedQty: '', rate: '' });

/** One (warehouse, product) box pair in the all-warehouse grid. */
interface GridCell {
  sellable: string;
  damaged: string;
}

const emptyCell = (): GridCell => ({ sellable: '', damaged: '' });

const cellKey = (warehouseId: string, productId: string) => `${warehouseId}:${productId}`;

type Mode = 'grid' | 'warehouse';

function OpeningStockPage() {
  const [mode, setMode] = useState<Mode>('grid');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // ─── One-warehouse mode ──────────────────────────────────────────────────────
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<OpeningStockStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLine>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ─── All-warehouse grid ──────────────────────────────────────────────────────
  /** What the server currently holds. The save sends only the cells that differ from it. */
  const [posted, setPosted] = useState<OpeningStockCell[]>([]);
  const [cells, setCells] = useState<Record<string, GridCell>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  /**
   * Products whose rate box has actually been typed in.
   *
   * The grid shows ONE rate per product while the database keeps one per warehouse, so a product
   * entered at two warehouses at different rates displays only one of them. Without this set, the
   * one that is not displayed would read as "changed" the moment the grid loaded and get quietly
   * rewritten on save. An untouched rate is therefore never sent, and the stored one stands.
   */
  const [ratesTouched, setRatesTouched] = useState<Set<string>>(new Set());
  const [gridSearch, setGridSearch] = useState('');
  const [gridLoading, setGridLoading] = useState(true);
  const [gridSaving, setGridSaving] = useState(false);

  /** Fill the grid from what is posted, and seed a rate for everything else from the product. */
  const seedGrid = useCallback(
    (rows: OpeningStockCell[], productList: Product[], warehouseList: Warehouse[]) => {
      const mainId = warehouseList.find((w) => w.isMain)?._id;
      const nextCells: Record<string, GridCell> = {};
      const nextRates: Record<string, string> = {};

      for (const row of rows) {
        nextCells[cellKey(row.warehouseId, row.productId)] = {
          sellable: String(row.sellableQty),
          damaged: String(row.damagedQty),
        };
        // The grid carries ONE rate per product, but the database stores it per warehouse. When
        // they disagree, Main's rate is the one shown — it is where the stock actually arrives.
        if (nextRates[row.productId] === undefined || row.warehouseId === mainId) {
          nextRates[row.productId] = String(row.rate ?? 0);
        }
      }

      for (const product of productList) {
        if (nextRates[product._id] === undefined) {
          nextRates[product._id] = product.purchasePrice ? String(product.purchasePrice) : '';
        }
      }

      setCells(nextCells);
      setRates(nextRates);
      setRatesTouched(new Set());
    },
    [],
  );

  const loadGrid = useCallback(
    async (productList: Product[], warehouseList: Warehouse[]) => {
      setGridLoading(true);
      try {
        const rows = await stockInService.getOpeningStockMatrix();
        setPosted(rows);
        seedGrid(rows, productList, warehouseList);
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Failed to load the opening stock grid'));
      } finally {
        setGridLoading(false);
      }
    },
    [seedGrid],
  );

  useEffect(() => {
    Promise.all([warehouseService.getWarehouses(), productService.getProducts()])
      .then(([warehouseList, productList]: [Warehouse[], Product[]]) => {
        setWarehouses(warehouseList);
        setProducts(productList);
        return loadGrid(productList, warehouseList);
      })
      .catch((err) => {
        setGridLoading(false);
        toast.error(getApiErrorMessage(err, 'Failed to load setup data'));
      });
  }, [loadGrid]);

  const loadStatus = useCallback(async (id: string) => {
    if (!id) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      setStatus(await stockInService.getOpeningStockStatus(id));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to check the opening stock status'));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDrafts({});
    loadStatus(warehouseId);
  }, [warehouseId, loadStatus]);

  const postedIds = useMemo(() => new Set(status?.postedProductIds ?? []), [status]);

  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((p) =>
      `${p.name} ${p.barcode}`.toLowerCase().includes(needle),
    );
  }, [products, search]);

  const update = (productId: string, patch: Partial<DraftLine>) => {
    setDrafts((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] ?? emptyDraft()), ...patch },
    }));
  };

  const filledLines = useMemo(() => {
    const out: { productId: string; sellableQty: number; damagedQty: number; rate: number }[] = [];
    for (const [productId, draft] of Object.entries(drafts)) {
      if (postedIds.has(productId)) continue;
      const sellableQty = Number(draft.sellableQty || 0);
      const damagedQty = Number(draft.damagedQty || 0);
      if (sellableQty <= 0 && damagedQty <= 0) continue;
      out.push({ productId, sellableQty, damagedQty, rate: Number(draft.rate || 0) });
    }
    return out;
  }, [drafts, postedIds]);

  const totalValue = useMemo(
    () => filledLines.reduce((sum, l) => sum + (l.sellableQty + l.damagedQty) * l.rate, 0),
    [filledLines],
  );

  const handleSubmit = async () => {
    if (!warehouseId) {
      toast.error('Pick a warehouse first');
      return;
    }
    if (filledLines.length === 0) {
      toast.error('Enter a quantity for at least one product');
      return;
    }
    if (filledLines.some((l) => !Number.isInteger(l.sellableQty) || !Number.isInteger(l.damagedQty))) {
      toast.error('Stock is counted in whole pieces — no fractions');
      return;
    }
    const unpriced = filledLines.filter((l) => l.rate <= 0).length;
    const message =
      `Post opening stock for ${filledLines.length} product(s)?\n\n` +
      'This is the first entry per product at this warehouse. Afterwards the figures are corrected ' +
      'from the all-warehouse grid, or the entry is cancelled to reverse it entirely.' +
      (unpriced > 0
        ? `\n\n${unpriced} line(s) have no rate. Those pieces will carry no cost basis until the ` +
          'first Stock In, so stock value and profit will understate them.'
        : '');
    if (!window.confirm(message)) return;

    setSubmitting(true);
    try {
      const result = await stockInService.postOpeningStock({
        warehouseId,
        lines: filledLines,
      });
      toast.success(result.message ?? 'Opening stock posted');
      setDrafts({});
      loadStatus(warehouseId);
      loadGrid(products, warehouses);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to post opening stock'));
    } finally {
      setSubmitting(false);
    }
  };

  const remainingCount = products.length - postedIds.size;

  // ─── All-warehouse grid ──────────────────────────────────────────────────────

  /**
   * Main first, then the rest alphabetically — and Main appears ONCE. A warehouse flagged as main
   * is shown only in the Main column, never again under its own name.
   */
  const gridWarehouses = useMemo(() => {
    const active = warehouses.filter((w) => w.isActive !== false);
    const main = active.find((w) => w.isMain);
    const others = active
      .filter((w) => w._id !== main?._id)
      .sort((a, b) => a.name.localeCompare(b.name));
    return main ? [main, ...others] : others;
  }, [warehouses]);

  const postedByKey = useMemo(
    () => new Map(posted.map((row) => [cellKey(row.warehouseId, row.productId), row])),
    [posted],
  );

  const gridProducts = useMemo(() => {
    const needle = gridSearch.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((p) => `${p.name} ${p.barcode}`.toLowerCase().includes(needle));
  }, [products, gridSearch]);

  const updateCell = (warehouseId_: string, productId: string, patch: Partial<GridCell>) => {
    setCells((prev) => {
      const key = cellKey(warehouseId_, productId);
      return { ...prev, [key]: { ...(prev[key] ?? emptyCell()), ...patch } };
    });
  };

  /**
   * The cells whose figures differ from what is stored — the entire save payload.
   *
   * Walks EVERY product, not just the ones the search box is showing, so filtering the view never
   * silently drops something already typed.
   */
  const changedCells = useMemo(() => {
    const out: {
      warehouseId: string;
      productId: string;
      sellableQty: number;
      damagedQty: number;
      /** Left off when the rate was not typed in, so the stored per-warehouse rate stands. */
      rate?: number;
      isEdit: boolean;
    }[] = [];

    for (const product of products) {
      const rate = Number(rates[product._id] || 0);
      const rateTyped = ratesTouched.has(product._id);

      for (const warehouse of gridWarehouses) {
        const key = cellKey(warehouse._id, product._id);
        const draft = cells[key];
        const prior = postedByKey.get(key);
        const sellableQty = Number(draft?.sellable || 0);
        const damagedQty = Number(draft?.damaged || 0);

        if (!prior) {
          if (sellableQty > 0 || damagedQty > 0) {
            out.push({
              warehouseId: warehouse._id,
              productId: product._id,
              sellableQty,
              damagedQty,
              rate,
              isEdit: false,
            });
          }
          continue;
        }

        const rateChanged = rateTyped && prior.rate !== rate;
        if (
          prior.sellableQty !== sellableQty ||
          prior.damagedQty !== damagedQty ||
          rateChanged
        ) {
          out.push({
            warehouseId: warehouse._id,
            productId: product._id,
            sellableQty,
            damagedQty,
            ...(rateChanged ? { rate } : {}),
            isEdit: true,
          });
        }
      }
    }

    return out;
  }, [products, gridWarehouses, cells, rates, ratesTouched, postedByKey]);

  const changedKeys = useMemo(
    () => new Set(changedCells.map((c) => cellKey(c.warehouseId, c.productId))),
    [changedCells],
  );

  const rowsWithEntries = useMemo(
    () =>
      products.filter((product) =>
        gridWarehouses.some((warehouse) => {
          const draft = cells[cellKey(warehouse._id, product._id)];
          return (
            draft !== undefined &&
            (Number(draft.sellable || 0) > 0 || Number(draft.damaged || 0) > 0)
          );
        }),
      ).length,
    [products, gridWarehouses, cells],
  );

  const gridValue = useMemo(() => {
    let total = 0;
    for (const product of products) {
      const rate = Number(rates[product._id] || 0);
      if (rate <= 0) continue;
      for (const warehouse of gridWarehouses) {
        const draft = cells[cellKey(warehouse._id, product._id)];
        if (!draft) continue;
        total += (Number(draft.sellable || 0) + Number(draft.damaged || 0)) * rate;
      }
    }
    return total;
  }, [products, gridWarehouses, cells, rates]);

  const nameOfWarehouse = useCallback(
    (id: string) => warehouses.find((w) => w._id === id)?.name ?? 'Warehouse',
    [warehouses],
  );
  const nameOfProduct = useCallback(
    (id?: string) => (id ? products.find((p) => p._id === id)?.name ?? 'Product' : ''),
    [products],
  );

  const handleSaveGrid = async () => {
    if (changedCells.length === 0) {
      toast.info('Nothing has changed since the grid was loaded');
      return;
    }
    if (
      changedCells.some(
        (c) =>
          !Number.isInteger(c.sellableQty) ||
          !Number.isInteger(c.damagedQty) ||
          c.sellableQty < 0 ||
          c.damagedQty < 0,
      )
    ) {
      toast.error('Stock is counted in whole pieces — no fractions or negatives');
      return;
    }

    const edits = changedCells.filter((c) => c.isEdit).length;
    const fresh = changedCells.length - edits;
    const unpriced = changedCells.filter((c) => (c.rate ?? 0) <= 0).length;

    const message =
      `Save ${changedCells.length} cell(s)?\n\n` +
      `• ${fresh} new opening-stock entr${fresh === 1 ? 'y' : 'ies'}\n` +
      `• ${edits} correction(s) to figures already posted\n\n` +
      'A correction reverses the stock that entry had applied and re-posts the new figures, so a ' +
      'changed rate carries through to the average cost.' +
      (unpriced > 0
        ? `\n\n${unpriced} cell(s) have no rate. Those pieces will carry no cost basis until the ` +
          'first Stock In, so stock value and profit will understate them.'
        : '');
    if (!window.confirm(message)) return;

    setGridSaving(true);
    try {
      const result = await stockInService.saveOpeningStockMatrix({
        cells: changedCells.map(({ warehouseId: w, productId, sellableQty, damagedQty, rate }) => ({
          warehouseId: w,
          productId,
          sellableQty,
          damagedQty,
          rate,
        })),
      });

      if (result.failed?.length) {
        const detail = result.failed
          .slice(0, 3)
          .map((f) =>
            f.productId
              ? `${nameOfProduct(f.productId)} at ${nameOfWarehouse(f.warehouseId)}: ${f.message}`
              : `${nameOfWarehouse(f.warehouseId)}: ${f.message}`,
          )
          .join(' — ');
        const more = result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : '';
        toast.warn(`${result.failed.length} cell(s) could not be saved. ${detail}${more}`, {
          autoClose: false,
        });
      } else {
        toast.success(result.message ?? 'Opening stock saved');
      }

      await loadGrid(products, warehouses);
      if (warehouseId) loadStatus(warehouseId);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to save the opening stock grid'));
    } finally {
      setGridSaving(false);
    }
  };

  /** Put every box back to the figure that is stored — the whole point is that it discards typing. */
  const handleClearGrid = () => {
    if (changedCells.length === 0) return;
    if (!window.confirm('Discard every unsaved change and reset the grid to the saved figures?')) {
      return;
    }
    seedGrid(posted, products, warehouses);
  };

  return (
    <Layout>
      <div className={reportStyles.page}>
        <div className={reportStyles.header}>
          <h1>Opening Stock</h1>
        </div>

        <WarehouseModuleNav active="opening-stock" />

        <p className={listStyles.filterSummary}>
          Enter the stock physically present in each warehouse today, split into sellable and
          damaged / claim pieces, with the rate you paid. The rate seeds each product&apos;s average
          cost, so it is worth getting right.
        </p>

        <div className={gridStyles.modeSwitch} role="tablist" aria-label="Entry mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'grid'}
            className={`${gridStyles.modeButton} ${mode === 'grid' ? gridStyles.modeButtonActive : ''}`}
            onClick={() => setMode('grid')}
          >
            All warehouses
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'warehouse'}
            className={`${gridStyles.modeButton} ${mode === 'warehouse' ? gridStyles.modeButtonActive : ''}`}
            onClick={() => setMode('warehouse')}
          >
            One warehouse
          </button>
        </div>

        {mode === 'grid' && (
          <>
            <div className={gridStyles.toolbar}>
              <div className={gridStyles.searchBox}>
                <MagnifyingGlass size={16} weight="bold" />
                <input
                  aria-label="Search by name or SKU"
                  placeholder="Search by name or SKU…"
                  value={gridSearch}
                  onChange={(e) => setGridSearch(e.target.value)}
                />
              </div>
              <span className={gridStyles.entryCount}>
                <strong>{rowsWithEntries}</strong> row(s) have entries
                {changedCells.length > 0 && (
                  <>
                    {' · '}
                    <strong>{changedCells.length}</strong> unsaved
                  </>
                )}
              </span>
            </div>

            {gridLoading && <p>Loading the grid…</p>}

            {!gridLoading && gridWarehouses.length === 0 && (
              <div className={reportStyles.lowStockCallout}>
                No active warehouse yet. Create one first — opening stock is entered per warehouse.
              </div>
            )}

            {!gridLoading && gridWarehouses.length > 0 && (
              <>
                <div className={gridStyles.tableScroll}>
                  <table className={gridStyles.grid}>
                    <thead>
                      <tr>
                        <th rowSpan={2} className={gridStyles.productHead}>
                          Product
                        </th>
                        <th rowSpan={2} className={gridStyles.rateHead}>
                          Rate
                        </th>
                        {gridWarehouses.map((warehouse) => (
                          <th
                            key={warehouse._id}
                            colSpan={2}
                            className={`${gridStyles.warehouseHead} ${gridStyles.groupEdge} ${
                              warehouse.isMain ? gridStyles.mainHead : ''
                            }`}
                          >
                            {warehouse.isMain ? 'Main' : warehouse.name}
                            {warehouse.isMain && warehouse.name.trim().toLowerCase() !== 'main' && (
                              <span className={gridStyles.warehouseSub}>{warehouse.name}</span>
                            )}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {gridWarehouses.map((warehouse) => (
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
                      {gridProducts.map((product) => (
                        <tr key={product._id}>
                          <td className={gridStyles.productCell}>
                            <div className={gridStyles.productName}>{product.name}</div>
                            <div className={gridStyles.productSku}>{product.barcode}</div>
                          </td>
                          <td className={gridStyles.cell}>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              aria-label={`Rate for ${product.name}`}
                              className={gridStyles.rateInput}
                              placeholder="0"
                              value={rates[product._id] ?? ''}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                setRates((prev) => ({ ...prev, [product._id]: e.target.value }));
                                setRatesTouched((prev) =>
                                  prev.has(product._id)
                                    ? prev
                                    : new Set(prev).add(product._id),
                                );
                              }}
                            />
                          </td>
                          {gridWarehouses.map((warehouse) => {
                            const key = cellKey(warehouse._id, product._id);
                            const draft = cells[key] ?? emptyCell();
                            const isPosted = postedByKey.has(key);
                            const isChanged = changedKeys.has(key);
                            const cellClass = `${gridStyles.qtyInput} ${
                              isChanged ? gridStyles.dirty : isPosted ? gridStyles.existing : ''
                            }`;
                            const hint = isPosted
                              ? `Already entered at ${warehouse.name} — saving corrects it`
                              : undefined;

                            return (
                              <React.Fragment key={warehouse._id}>
                                <td className={`${gridStyles.cell} ${gridStyles.groupEdge}`}>
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    title={hint}
                                    aria-label={`Sellable pieces of ${product.name} at ${warehouse.name}`}
                                    className={cellClass}
                                    placeholder="0"
                                    value={draft.sellable}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) =>
                                      updateCell(warehouse._id, product._id, {
                                        sellable: e.target.value,
                                      })
                                    }
                                  />
                                </td>
                                <td className={gridStyles.cell}>
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    title={hint}
                                    aria-label={`Damaged pieces of ${product.name} at ${warehouse.name}`}
                                    className={cellClass}
                                    placeholder="0"
                                    value={draft.damaged}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) =>
                                      updateCell(warehouse._id, product._id, {
                                        damaged: e.target.value,
                                      })
                                    }
                                  />
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ))}

                      {gridProducts.length === 0 && (
                        <tr className={gridStyles.emptyRow}>
                          <td colSpan={2 + gridWarehouses.length * 2}>
                            {products.length === 0
                              ? 'No products yet.'
                              : `No product matches “${gridSearch}”.`}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <p className={gridStyles.legend}>
                  <span className={gridStyles.legendItem}>
                    <span
                      className={`${gridStyles.legendSwatch} ${gridStyles.existing}`}
                      aria-hidden="true"
                    />
                    Already entered — typing over it corrects the entry
                  </span>
                  <span className={gridStyles.legendItem}>
                    <span
                      className={`${gridStyles.legendSwatch} ${gridStyles.dirty}`}
                      aria-hidden="true"
                    />
                    Changed, not yet saved
                  </span>
                </p>

                <div className={reportStyles.plGrid} style={{ marginTop: 16 }}>
                  <div className={reportStyles.plCard}>
                    <span>Rows with entries</span>
                    <strong>{rowsWithEntries}</strong>
                  </div>
                  <div className={reportStyles.plCard}>
                    <span>Cells to save</span>
                    <strong>{changedCells.length}</strong>
                  </div>
                  <div className={reportStyles.plCard}>
                    <span>Total opening value</span>
                    <strong>{formatRsExact(gridValue)}</strong>
                  </div>
                </div>

                <div className={gridStyles.gridActions}>
                  <button
                    type="button"
                    className={formStyles.cancelButton}
                    onClick={handleClearGrid}
                    disabled={gridSaving || changedCells.length === 0}
                    title="Reset every box to the figure that is currently saved"
                  >
                    Clear all entries
                  </button>
                  <button
                    type="button"
                    className={formStyles.submitButton}
                    onClick={handleSaveGrid}
                    disabled={gridSaving || changedCells.length === 0}
                  >
                    {gridSaving ? 'Saving…' : `Save All (${changedCells.length})`}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {mode === 'warehouse' && (
          <>
            <p className={listStyles.filterSummary}>
              One warehouse at a time. Products already entered here are locked — correct their
              figures from the all-warehouse grid instead.
            </p>

            <div className={reportStyles.filterBar}>
              <div className={reportStyles.filterGroup}>
                <label htmlFor="warehouseId">Warehouse</label>
                <SearchableSelect
                  id="warehouseId"
                  name="warehouseId"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  placeholder="Select warehouse"
                  options={[
                    { value: '', label: 'Select warehouse' },
                    ...warehouseSelectOptions(warehouses),
                  ]}
                />
              </div>
              {warehouseId && (
                <div className={reportStyles.filterGroup}>
                  <label htmlFor="search">Find a product</label>
                  <input
                    id="search"
                    className={reportStyles.filterInput}
                    placeholder="Name or barcode…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
            </div>

            {!warehouseId && (
              <div className={reportStyles.lowStockCallout}>
                Pick a warehouse to begin. Each warehouse is set up separately.
              </div>
            )}

            {warehouseId && loading && <p>Checking this warehouse…</p>}

            {warehouseId && !loading && status?.locked && remainingCount === 0 && (
              <div className={reportStyles.lowStockCallout}>
                <strong>Opening stock is already complete for this warehouse.</strong>{' '}
                {status.submittedAt
                  ? `Entered on ${format(new Date(status.submittedAt), 'MMM dd, yyyy')}`
                  : ''}
                {status.submittedBy ? ` by ${employeeDisplayLabel(status.submittedBy)}` : ''}. Use
                the all-warehouse grid to correct a figure, Stock In to add more stock, or a Stock
                Count to recount.
              </div>
            )}

            {warehouseId && !loading && status?.locked && remainingCount > 0 && (
              <div className={reportStyles.lowStockCallout}>
                {postedIds.size} product(s) already have opening stock here and are locked below.{' '}
                {remainingCount} product(s) remain.
              </div>
            )}

            {warehouseId && !loading && remainingCount > 0 && (
              <>
                <div style={{ overflowX: 'auto', marginTop: 16 }}>
                  <table
                    style={{
                      width: '100%',
                      minWidth: 760,
                      borderCollapse: 'collapse',
                      fontSize: '0.875rem',
                    }}
                  >
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={th}>Product</th>
                        <th style={{ ...th, width: 130 }}>Barcode</th>
                        <th style={{ ...th, width: 130 }}>Sellable pcs</th>
                        <th style={{ ...th, width: 130 }}>Damaged pcs</th>
                        <th style={{ ...th, width: 130 }}>Rate / piece</th>
                        <th style={{ ...th, width: 120, textAlign: 'right' }}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProducts.map((product) => {
                        const locked = postedIds.has(product._id);
                        const draft = drafts[product._id] ?? emptyDraft();
                        const value =
                          (Number(draft.sellableQty || 0) + Number(draft.damagedQty || 0)) *
                          Number(draft.rate || 0);

                        return (
                          <tr key={product._id} style={locked ? { opacity: 0.5 } : undefined}>
                            <td style={td}>{product.name}</td>
                            <td style={td}>{product.barcode}</td>
                            <td style={td}>
                              {locked ? (
                                <em>already entered</em>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className={formStyles.input}
                                  style={{ margin: 0 }}
                                  value={draft.sellableQty}
                                  onChange={(e) =>
                                    update(product._id, { sellableQty: e.target.value })
                                  }
                                />
                              )}
                            </td>
                            <td style={td}>
                              {!locked && (
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className={formStyles.input}
                                  style={{ margin: 0 }}
                                  value={draft.damagedQty}
                                  onChange={(e) =>
                                    update(product._id, { damagedQty: e.target.value })
                                  }
                                />
                              )}
                            </td>
                            <td style={td}>
                              {!locked && (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className={formStyles.input}
                                  style={{ margin: 0 }}
                                  placeholder={String(product.purchasePrice ?? 0)}
                                  value={draft.rate}
                                  onChange={(e) => update(product._id, { rate: e.target.value })}
                                />
                              )}
                            </td>
                            <td style={{ ...td, textAlign: 'right' }}>
                              {value > 0 ? formatRsExact(value) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {visibleProducts.length === 0 && (
                  <p className={listStyles.filterSummary}>No product matches “{search}”.</p>
                )}

                <div className={reportStyles.plGrid} style={{ marginTop: 16 }}>
                  <div className={reportStyles.plCard}>
                    <span>Products with a quantity</span>
                    <strong>{filledLines.length}</strong>
                  </div>
                  <div className={reportStyles.plCard}>
                    <span>Total opening value</span>
                    <strong>{formatRsExact(totalValue)}</strong>
                  </div>
                </div>

                <div className={formStyles.formActions}>
                  <button
                    type="button"
                    className={formStyles.cancelButton}
                    onClick={() => setDrafts({})}
                    disabled={submitting || filledLines.length === 0}
                  >
                    Clear entries
                  </button>
                  <button
                    type="button"
                    className={formStyles.submitButton}
                    onClick={handleSubmit}
                    disabled={submitting || filledLines.length === 0}
                  >
                    {submitting ? 'Posting…' : `Post opening stock (${filledLines.length})`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

const th: React.CSSProperties = {
  padding: '0.5rem',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '1px solid #e5e7eb',
};

const td: React.CSSProperties = { padding: '0.5rem', borderBottom: '1px solid #f3f4f6' };

export default function OpeningStockPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <OpeningStockPage />
    </ProtectedRoute>
  );
}
