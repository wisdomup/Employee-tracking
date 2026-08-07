import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import { stockInService, OpeningStockStatus } from '../../../services/stockInService';
import { productService, Product } from '../../../services/productService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { formatRsExact } from '../../../utils/formatCurrency';
import formStyles from '../../../styles/FormPage.module.scss';
import listStyles from '../../../styles/ListPage.module.scss';
import reportStyles from '../../../styles/StockReports.module.scss';

/**
 * One-time starting stock (spec §11): per warehouse, per product, split sellable / damaged, with a
 * quantity and a rate.
 *
 * The grid is hand-rolled rather than using the shared `Table`: that wraps
 * react-data-table-component, which is read-only and re-renders cells on its own sort and paginate
 * state — inputs inside it lose focus and typed values. Entries are held in a
 * `Record<productId, line>` so the search box filters what is DISPLAYED without discarding
 * anything already typed.
 */
interface DraftLine {
  sellableQty: string;
  damagedQty: string;
  rate: string;
}

const emptyDraft = (): DraftLine => ({ sellableQty: '', damagedQty: '', rate: '' });

function OpeningStockPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<OpeningStockStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLine>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([warehouseService.getWarehouses(), productService.getProducts()])
      .then(([warehouseList, productList]) => {
        setWarehouses(warehouseList);
        setProducts(productList);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load setup data')));
  }, []);

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
      'This is a one-time entry per product at this warehouse. To correct it afterwards you have ' +
      'to cancel the entry, which reverses the stock.' +
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
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to post opening stock'));
    } finally {
      setSubmitting(false);
    }
  };

  const remainingCount = products.length - postedIds.size;

  return (
    <Layout>
      <div className={reportStyles.page}>
        <div className={reportStyles.header}>
          <h1>Opening Stock</h1>
        </div>

        <WarehouseModuleNav active="opening-stock" />

        <p className={listStyles.filterSummary}>
          One-time setup. Enter the stock physically present in a warehouse today, split into
          sellable and damaged / claim pieces, with the rate you paid. The rate seeds each
          product&apos;s average cost, so it is worth getting right.
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
            {status.submittedBy ? ` by ${employeeDisplayLabel(status.submittedBy)}` : ''}. Use Stock
            In to add more stock, or a Stock Count to correct a figure.
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
                              onChange={(e) => update(product._id, { sellableQty: e.target.value })}
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
                              onChange={(e) => update(product._id, { damagedQty: e.target.value })}
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
