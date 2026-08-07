import React, { useMemo } from 'react';
import SearchableSelect from '../UI/SearchableSelect';
import { Product } from '../../services/productService';
import { formatRsExact } from '../../utils/formatCurrency';
import styles from '../../styles/FormPage.module.scss';

/**
 * Multi-line product editor for warehouse documents: Stock In, transfers, damage claims.
 *
 * Extracted because `orders/create.tsx` already carries ~250 lines of desktop-table +
 * mobile-cards + totals for exactly this shape, and three more copies is the tipping point. It
 * uses only classes that already exist in FormPage.module.scss — no new stylesheet.
 *
 * The orders pages are deliberately NOT retrofitted onto this: they carry order-specific
 * stock/remaining arithmetic and have an edit twin, so folding them in belongs in its own change.
 */
export interface StockLine {
  productId: string;
  qty: number;
  /** Only meaningful when `showRate` is on. */
  rate: number;
}

export interface StockLineItemsEditorProps {
  products: Product[];
  value: StockLine[];
  onChange: (lines: StockLine[]) => void;
  /** 'Pieces' for a receipt, 'Requested Pieces' for a transfer. Always pieces, never cartons. */
  qtyLabel?: string;
  /** Show the rate column and the value totals (Stock In does, a transfer does not). */
  showRate?: boolean;
  /**
   * Show `Last purchase: Rs. X` under the rate input with a button to copy it in. This is spec §4:
   * "the last purchase rate is shown as a reference when entering a new one".
   */
  showLastPurchaseRate?: boolean;
  /**
   * Per-product stock available in the relevant warehouse+bucket. When provided, a line asking for
   * more than this is flagged and reported through `onValidityChange`.
   */
  availableByProduct?: Record<string, number>;
  availableLabel?: string;
  defaultRateFor?: (product: Product) => number;
  disabled?: boolean;
}

const emptyLine = (): StockLine => ({ productId: '', qty: 1, rate: 0 });

export interface StockLineExcess {
  productName: string;
  available: number;
  requested: number;
}

/**
 * The first line asking for more than is available, or null.
 *
 * Exported as a plain function rather than reported through a callback prop: the parent needs it to
 * block its own submit and render its own message, and a function keeps that a pure derivation
 * instead of a render-time side effect. Quantities are aggregated per product, so two lines for the
 * same product cannot jointly oversell.
 */
export function findStockLineExcess(
  lines: StockLine[],
  availableByProduct: Record<string, number>,
  productNameById: (productId: string) => string,
): StockLineExcess | null {
  const requested = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    requested.set(line.productId, (requested.get(line.productId) ?? 0) + (line.qty || 0));
  }

  for (const [productId, qty] of requested) {
    const available = availableByProduct[productId] ?? 0;
    if (qty > available) {
      return { productName: productNameById(productId), available, requested: qty };
    }
  }
  return null;
}

const StockLineItemsEditor: React.FC<StockLineItemsEditorProps> = ({
  products,
  value,
  onChange,
  qtyLabel = 'Pieces',
  showRate = false,
  showLastPurchaseRate = false,
  availableByProduct,
  availableLabel = 'Available',
  defaultRateFor,
  disabled = false,
}) => {
  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p._id, p);
    return map;
  }, [products]);

  const productOptions = useMemo(
    () => [
      { value: '', label: 'Select product' },
      ...products.map((p) => ({ value: p._id, label: `${p.name} (${p.barcode})` })),
    ],
    [products],
  );

  /** Aggregate per product, so two lines for the same product can't jointly oversell. */
  const requestedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of value) {
      if (!line.productId) continue;
      map.set(line.productId, (map.get(line.productId) ?? 0) + (line.qty || 0));
    }
    return map;
  }, [value]);

  const update = (index: number, patch: Partial<StockLine>) => {
    const next = value.map((line, i) => (i === index ? { ...line, ...patch } : line));
    onChange(next);
  };

  const handleProductChange = (index: number, productId: string) => {
    const product = productById.get(productId);
    const rate = product && defaultRateFor ? defaultRateFor(product) : value[index].rate;
    update(index, { productId, rate: showRate ? rate : 0 });
  };

  const addRow = () => onChange([...value, emptyLine()]);
  const removeRow = (index: number) =>
    onChange(value.length === 1 ? [emptyLine()] : value.filter((_, i) => i !== index));

  const totalPieces = value.reduce((sum, l) => sum + (l.qty || 0), 0);
  const totalValue = value.reduce((sum, l) => sum + (l.qty || 0) * (l.rate || 0), 0);

  const lastRateOf = (productId: string) => productById.get(productId)?.lastPurchaseRate ?? null;

  const availableOf = (productId: string) =>
    availableByProduct ? availableByProduct[productId] ?? 0 : null;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <label style={{ fontWeight: 600, color: '#374151' }}>Products *</label>
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className={styles.cancelButton}
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
        >
          + Add Row
        </button>
      </div>

      {/* Desktop: a real table. Editable cells rule out the shared Table component, which is
          read-only and re-renders cells on its own sort/paginate state (inputs lose focus). */}
      <div
        className={styles.desktopOnly}
        style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '0.5rem' }}
      >
        <table
          style={{
            width: '100%',
            minWidth: showRate ? 760 : 600,
            borderCollapse: 'collapse',
            fontSize: '0.875rem',
            color: '#1f2937',
          }}
        >
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Product</th>
              {availableByProduct && <th style={{ ...th, width: 150 }}>{availableLabel}</th>}
              <th style={{ ...th, width: 110 }}>{qtyLabel} *</th>
              {showRate && <th style={{ ...th, width: 160 }}>Rate (per piece) *</th>}
              {showRate && <th style={{ ...th, width: 120, textAlign: 'right' }}>Amount</th>}
              <th style={{ width: 40, borderBottom: '1px solid #e5e7eb' }} />
            </tr>
          </thead>
          <tbody>
            {value.map((line, idx) => {
              const available = availableOf(line.productId);
              const requested = line.productId ? requestedByProduct.get(line.productId) ?? 0 : 0;
              const over = available !== null && line.productId ? requested > available : false;
              const lastRate = lastRateOf(line.productId);

              return (
                <tr key={idx}>
                  <td style={td}>
                    <SearchableSelect
                      name={`productId-${idx}`}
                      value={line.productId}
                      onChange={(e) => handleProductChange(idx, e.target.value)}
                      className={styles.select}
                      style={{ margin: 0 }}
                      placeholder="Select product"
                      disabled={disabled}
                      options={productOptions}
                    />
                  </td>

                  {availableByProduct && (
                    <td style={{ ...td, fontSize: '0.8125rem', verticalAlign: 'top' }}>
                      {line.productId ? (
                        <div>
                          <div>
                            {availableLabel}: <strong>{available}</strong>
                          </div>
                          {over && (
                            <div style={{ color: '#b91c1c', fontWeight: 500, marginTop: 2 }}>
                              Exceeds by {requested - (available ?? 0)}
                            </div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}

                  <td style={td}>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.qty}
                      disabled={disabled}
                      onChange={(e) => update(idx, { qty: Number(e.target.value) })}
                      className={styles.input}
                      style={{ margin: 0, ...(over ? { borderColor: '#dc2626' } : {}) }}
                    />
                  </td>

                  {showRate && (
                    <td style={td}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.rate}
                        disabled={disabled}
                        onChange={(e) => update(idx, { rate: Number(e.target.value) })}
                        className={styles.input}
                        style={{ margin: 0 }}
                      />
                      {showLastPurchaseRate && line.productId && (
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                          Last purchase: {lastRate ? formatRsExact(lastRate) : '—'}
                          {lastRate ? (
                            <button
                              type="button"
                              onClick={() => update(idx, { rate: lastRate })}
                              disabled={disabled}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--admin-primary, #111827)',
                                cursor: 'pointer',
                                padding: '0 0 0 6px',
                                fontSize: '0.75rem',
                                textDecoration: 'underline',
                              }}
                            >
                              use
                            </button>
                          ) : null}
                        </div>
                      )}
                    </td>
                  )}

                  {showRate && (
                    <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>
                      {formatRsExact((line.qty || 0) * (line.rate || 0))}
                    </td>
                  )}

                  <td style={{ ...td, textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={disabled}
                      aria-label="Remove row"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '1.125rem',
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f9fafb' }}>
              <td colSpan={availableByProduct ? 2 : 1} style={{ ...td, fontWeight: 600 }}>
                Total
              </td>
              <td style={{ ...td, fontWeight: 700 }}>{totalPieces} pcs</td>
              {showRate && <td style={td} />}
              {showRate && (
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                  {formatRsExact(totalValue)}
                </td>
              )}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile: cards, matching orders/create.tsx */}
      <div className={styles.mobileOnly}>
        <div className={styles.lineItemCards}>
          {value.map((line, idx) => {
            const available = availableOf(line.productId);
            const requested = line.productId ? requestedByProduct.get(line.productId) ?? 0 : 0;
            const over = available !== null && line.productId ? requested > available : false;
            const lastRate = lastRateOf(line.productId);

            return (
              <div key={idx} className={styles.lineItemCard}>
                <span className={styles.lineItemFieldLabel}>Product</span>
                <SearchableSelect
                  name={`m-productId-${idx}`}
                  value={line.productId}
                  onChange={(e) => handleProductChange(idx, e.target.value)}
                  className={styles.select}
                  placeholder="Select product"
                  disabled={disabled}
                  options={productOptions}
                />

                {availableByProduct && line.productId && (
                  <span className={styles.lineItemMeta}>
                    {availableLabel}: {available}
                    {over ? ` — exceeds by ${requested - (available ?? 0)}` : ''}
                  </span>
                )}

                <span className={styles.lineItemFieldLabel}>{qtyLabel}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={line.qty}
                  disabled={disabled}
                  onChange={(e) => update(idx, { qty: Number(e.target.value) })}
                  className={styles.input}
                />

                {showRate && (
                  <>
                    <span className={styles.lineItemFieldLabel}>Rate (per piece)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.rate}
                      disabled={disabled}
                      onChange={(e) => update(idx, { rate: Number(e.target.value) })}
                      className={styles.input}
                    />
                    {showLastPurchaseRate && line.productId && (
                      <span className={styles.lineItemMeta}>
                        Last purchase: {lastRate ? formatRsExact(lastRate) : '—'}
                      </span>
                    )}
                    <span className={styles.lineItemMeta}>
                      Amount: {formatRsExact((line.qty || 0) * (line.rate || 0))}
                    </span>
                  </>
                )}

                <div className={styles.lineItemActions}>
                  <button
                    type="button"
                    className={styles.lineItemRemoveButton}
                    onClick={() => removeRow(idx)}
                    disabled={disabled}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.lineItemTotals}>
          <span>Total pieces</span>
          <strong>{totalPieces}</strong>
        </div>
        {showRate && (
          <div className={styles.lineItemGrandTotal}>
            <span>Total value</span>
            <strong>{formatRsExact(totalValue)}</strong>
          </div>
        )}
      </div>
    </div>
  );
};

const th: React.CSSProperties = {
  padding: '0.5rem',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '1px solid #e5e7eb',
};

const td: React.CSSProperties = { padding: '0.5rem' };

export default StockLineItemsEditor;
export { emptyLine as emptyStockLine };
