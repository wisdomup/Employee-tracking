import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ProductCombobox from '../UI/ProductCombobox';
import { Product } from '../../services/productService';
import { buildProductIndex, ProductIndex } from '../../utils/productSearch';
import { formatRsExact } from '../../utils/formatCurrency';
import type { TableExportColumn } from '../../utils/tableExport';
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
 *
 * Built for receipts of 100+ lines. Three things keep it responsive at that size, and none of them
 * are optional:
 *   1. Rows are keyed by a stable `id`, not their array index — otherwise removing a row shifts
 *      every input's state up one row.
 *   2. Each row is a `React.memo` component fed identity-stable callbacks (see `linesRef` below),
 *      so typing a quantity re-renders one row rather than all of them.
 *   3. The product cell is a plain input (`ProductCombobox`), not react-select. One react-select
 *      per row, each closing over the whole catalogue, is what made large receipts unusable.
 */
export interface StockLine {
  /** Stable across edits and removals. Local only — stripped before the payload is sent. */
  id: string;
  productId: string;
  qty: number;
  /** Only meaningful when `showRate` is on. */
  rate: number;
}

export interface StockLineItemsEditorProps {
  products: Product[];
  value: StockLine[];
  onChange: (lines: StockLine[]) => void;
  /**
   * Prebuilt search index. Pass it when the page already builds one (so the quick-add bar and the
   * grid share a single index); omitted, the editor builds its own from `products`.
   */
  productIndex?: ProductIndex;
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
  /** Rendered in the header strip, next to "+ Add Row" — used for "Paste from Excel". */
  headerActions?: React.ReactNode;
  /** Briefly highlighted after the quick-add bar merges into an existing line. */
  flashLineId?: string | null;
}

/**
 * Local row identity. `crypto.randomUUID` is unavailable during SSR and on older mobile browsers,
 * so a counter backs it up — these ids never leave the page.
 */
let lineIdCounter = 0;
function newLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  lineIdCounter += 1;
  return `line-${lineIdCounter}-${Date.now()}`;
}

const emptyLine = (): StockLine => ({ id: newLineId(), productId: '', qty: 1, rate: 0 });

/** Build a line from server data (or a pasted row), minting the local id. */
export function toStockLine(source: { productId: string; qty: number; rate?: number }): StockLine {
  return { id: newLineId(), productId: source.productId, qty: source.qty, rate: source.rate ?? 0 };
}

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

/**
 * Fold every line sharing a product into the first one that used it: quantities sum, and the
 * surviving line keeps its own rate so the number on screen is the number that is kept.
 */
export function mergeDuplicateLines(lines: StockLine[]): StockLine[] {
  const seen = new Map<string, StockLine>();
  const out: StockLine[] = [];

  for (const line of lines) {
    if (!line.productId) {
      out.push(line);
      continue;
    }
    const existing = seen.get(line.productId);
    if (existing) {
      existing.qty += line.qty || 0;
      continue;
    }
    const copy = { ...line };
    seen.set(line.productId, copy);
    out.push(copy);
  }

  return out;
}

/** Product ids that appear on more than one line. */
function findDuplicateProductIds(lines: StockLine[]): Set<string> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    counts.set(line.productId, (counts.get(line.productId) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [productId, count] of counts) if (count > 1) dupes.add(productId);
  return dupes;
}

const toNumber = (raw: string): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface StockLineRowProps {
  line: StockLine;
  rowNumber: number;
  product: Product | undefined;
  productIndex: ProductIndex;
  qtyLabel: string;
  showRate: boolean;
  showLastPurchaseRate: boolean;
  showAvailable: boolean;
  availableLabel: string;
  available: number;
  requested: number;
  isDuplicate: boolean;
  isFlashing: boolean;
  disabled: boolean;
  onProductChange: (id: string, product: Product | null) => void;
  onPatch: (id: string, patch: Partial<StockLine>) => void;
  onRemove: (id: string) => void;
  onMergeDuplicates: () => void;
}

/**
 * One desktop row. Memoized, and every callback it receives is identity-stable, so editing line 97
 * does not re-render lines 1–96.
 */
const StockLineRow = React.memo<StockLineRowProps>(function StockLineRow({
  line,
  rowNumber,
  product,
  productIndex,
  showRate,
  showLastPurchaseRate,
  showAvailable,
  availableLabel,
  available,
  requested,
  isDuplicate,
  isFlashing,
  disabled,
  onProductChange,
  onPatch,
  onRemove,
  onMergeDuplicates,
}) {
  const over = showAvailable && line.productId ? requested > available : false;
  const lastRate = product?.lastPurchaseRate ?? null;

  return (
    <tr style={isFlashing ? { background: 'var(--admin-primary-muted, #e0f2fe)' } : undefined}>
      <td style={{ ...td, color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{rowNumber}</td>

      <td style={td}>
        <ProductCombobox
          index={productIndex}
          value={line.productId}
          onChange={(_, next) => onProductChange(line.id, next)}
          disabled={disabled}
          showStock={showAvailable}
        />
        {isDuplicate && (
          <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 4 }}>
            Already on another line
            <button
              type="button"
              onClick={onMergeDuplicates}
              disabled={disabled}
              style={linkButton}
            >
              merge
            </button>
          </div>
        )}
      </td>

      {showAvailable && (
        <td style={{ ...td, fontSize: '0.8125rem', verticalAlign: 'top' }}>
          {line.productId ? (
            <div>
              <div>
                {availableLabel}: <strong>{available}</strong>
              </div>
              {over && (
                <div style={{ color: '#b91c1c', fontWeight: 500, marginTop: 2 }}>
                  Exceeds by {requested - available}
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
          onChange={(e) => onPatch(line.id, { qty: toNumber(e.target.value) })}
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
            onChange={(e) => onPatch(line.id, { rate: toNumber(e.target.value) })}
            className={styles.input}
            style={{ margin: 0 }}
          />
          {showLastPurchaseRate && line.productId && (
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
              Last purchase: {lastRate ? formatRsExact(lastRate) : '—'}
              {lastRate ? (
                <button
                  type="button"
                  onClick={() => onPatch(line.id, { rate: lastRate })}
                  disabled={disabled}
                  style={linkButton}
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
          onClick={() => onRemove(line.id)}
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
});

const StockLineItemsEditor: React.FC<StockLineItemsEditorProps> = ({
  products,
  value,
  onChange,
  productIndex,
  qtyLabel = 'Pieces',
  showRate = false,
  showLastPurchaseRate = false,
  availableByProduct,
  availableLabel = 'Available',
  defaultRateFor,
  disabled = false,
  headerActions,
  flashLineId = null,
}) => {
  const fallbackIndex = useMemo(() => buildProductIndex(products), [products]);
  const index = productIndex ?? fallbackIndex;

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p._id, p);
    return map;
  }, [products]);

  /**
   * Latest props behind refs so the row callbacks below can be created once with `[]` deps. Without
   * this, every keystroke would hand all 100 memoized rows a fresh callback and defeat the memo.
   */
  const linesRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const defaultRateRef = useRef(defaultRateFor);
  const showRateRef = useRef(showRate);

  /* Synced after commit rather than during render. The callbacks below only fire from event
     handlers, which is always after the effect for the render they were handed to. */
  useEffect(() => {
    linesRef.current = value;
    onChangeRef.current = onChange;
    defaultRateRef.current = defaultRateFor;
    showRateRef.current = showRate;
  });

  /** Aggregate per product, so two lines for the same product can't jointly oversell. */
  const requestedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of value) {
      if (!line.productId) continue;
      map.set(line.productId, (map.get(line.productId) ?? 0) + (line.qty || 0));
    }
    return map;
  }, [value]);

  const duplicateProductIds = useMemo(() => findDuplicateProductIds(value), [value]);

  const patchLine = useCallback((id: string, patch: Partial<StockLine>) => {
    onChangeRef.current(linesRef.current.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const handleProductChange = useCallback((id: string, product: Product | null) => {
    const current = linesRef.current.find((l) => l.id === id);
    if (!current) return;
    const rateFor = defaultRateRef.current;
    const rate = product && rateFor ? rateFor(product) : current.rate;
    onChangeRef.current(
      linesRef.current.map((l) =>
        l.id === id
          ? { ...l, productId: product?._id ?? '', rate: showRateRef.current ? rate : 0 }
          : l,
      ),
    );
  }, []);

  const removeLine = useCallback((id: string) => {
    const next = linesRef.current.filter((l) => l.id !== id);
    onChangeRef.current(next.length === 0 ? [emptyLine()] : next);
  }, []);

  const mergeDuplicates = useCallback(() => {
    onChangeRef.current(mergeDuplicateLines(linesRef.current));
  }, []);

  const addRow = () => onChange([...value, emptyLine()]);

  const totalPieces = value.reduce((sum, l) => sum + (l.qty || 0), 0);
  const totalValue = value.reduce((sum, l) => sum + (l.qty || 0) * (l.rate || 0), 0);

  const showAvailable = Boolean(availableByProduct);
  const availableOf = (productId: string) => availableByProduct?.[productId] ?? 0;

  /**
   * Only lines that name a product. A freshly added blank row still carries the default qty of 1,
   * which is noise on screen but would read as a real line in a file — so the export totals are
   * summed over these rows rather than reusing the on-screen figures.
   */
  const exportRows = useMemo(() => value.filter((line) => line.productId), [value]);

  const exportColumns = useMemo<TableExportColumn[]>(() => {
    const nameOf = (productId: string) => productById.get(productId)?.name ?? '';
    return [
      {
        key: 'product',
        title: 'Product',
        exportValue: (row) => nameOf((row as StockLine).productId),
      },
      {
        key: 'barcode',
        title: 'Barcode',
        exportValue: (row) => productById.get((row as StockLine).productId)?.barcode ?? '',
      },
      ...(availableByProduct
        ? [
            {
              key: 'available',
              title: availableLabel,
              exportValue: (row: unknown) =>
                String(availableByProduct[(row as StockLine).productId] ?? 0),
            },
          ]
        : []),
      { key: 'qty', title: qtyLabel, exportValue: (row) => String((row as StockLine).qty || 0) },
      ...(showRate
        ? [
            {
              key: 'rate',
              title: 'Rate (per piece)',
              exportValue: (row: unknown) => formatRsExact((row as StockLine).rate || 0),
            },
            {
              key: 'amount',
              title: 'Amount',
              exportValue: (row: unknown) => {
                const line = row as StockLine;
                return formatRsExact((line.qty || 0) * (line.rate || 0));
              },
            },
          ]
        : []),
    ];
  }, [availableByProduct, availableLabel, productById, qtyLabel, showRate]);

  const exportTotalRow = useMemo(() => {
    const pieces = exportRows.reduce((sum, l) => sum + (l.qty || 0), 0);
    const amount = exportRows.reduce((sum, l) => sum + (l.qty || 0) * (l.rate || 0), 0);
    return [
      'Total',
      '',
      ...(availableByProduct ? [''] : []),
      `${pieces} pcs`,
      ...(showRate ? ['', formatRsExact(amount)] : []),
    ];
  }, [availableByProduct, exportRows, showRate]);

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '0.75rem',
        }}
      >
        <label style={{ fontWeight: 600, color: '#374151' }}>
          Products * <span style={{ fontWeight: 400, color: '#6b7280' }}>({value.length})</span>
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {headerActions}
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
      </div>

      {duplicateProductIds.size > 0 && (
        <div
          style={{
            marginBottom: '0.75rem',
            padding: '0.5rem 0.75rem',
            borderRadius: 8,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: '0.8125rem',
          }}
        >
          {duplicateProductIds.size} product(s) appear on more than one line — the receipt cannot be
          saved until each appears once.
          <button type="button" onClick={mergeDuplicates} disabled={disabled} style={linkButton}>
            Merge them all
          </button>
        </div>
      )}

      {/* Desktop: a real table. Editable cells rule out the shared Table component, which is
          read-only and re-renders cells on its own sort/paginate state (inputs lose focus). */}
      <div
        className={styles.desktopOnly}
        style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '0.5rem' }}
      >
        <table
          style={{
            width: '100%',
            minWidth: showRate ? 800 : 640,
            borderCollapse: 'collapse',
            fontSize: '0.875rem',
            color: '#1f2937',
          }}
        >
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ ...th, width: 40 }}>#</th>
              <th style={th}>Product</th>
              {showAvailable && <th style={{ ...th, width: 150 }}>{availableLabel}</th>}
              <th style={{ ...th, width: 110 }}>{qtyLabel} *</th>
              {showRate && <th style={{ ...th, width: 160 }}>Rate (per piece) *</th>}
              {showRate && <th style={{ ...th, width: 120, textAlign: 'right' }}>Amount</th>}
              <th style={{ width: 40, borderBottom: '1px solid #e5e7eb' }} />
            </tr>
          </thead>
          <tbody>
            {value.map((line, idx) => (
              <StockLineRow
                key={line.id}
                line={line}
                rowNumber={idx + 1}
                product={productById.get(line.productId)}
                productIndex={index}
                qtyLabel={qtyLabel}
                showRate={showRate}
                showLastPurchaseRate={showLastPurchaseRate}
                showAvailable={showAvailable}
                availableLabel={availableLabel}
                available={availableOf(line.productId)}
                requested={requestedByProduct.get(line.productId) ?? 0}
                isDuplicate={duplicateProductIds.has(line.productId)}
                isFlashing={flashLineId === line.id}
                disabled={disabled}
                onProductChange={handleProductChange}
                onPatch={patchLine}
                onRemove={removeLine}
                onMergeDuplicates={mergeDuplicates}
              />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f9fafb' }}>
              <td colSpan={showAvailable ? 3 : 2} style={{ ...td, fontWeight: 600 }}>
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
            const product = productById.get(line.productId);
            const available = availableOf(line.productId);
            const requested = requestedByProduct.get(line.productId) ?? 0;
            const over = showAvailable && line.productId ? requested > available : false;
            const lastRate = product?.lastPurchaseRate ?? null;

            return (
              <div
                key={line.id}
                className={styles.lineItemCard}
                style={
                  flashLineId === line.id
                    ? { background: 'var(--admin-primary-muted, #e0f2fe)' }
                    : undefined
                }
              >
                <span className={styles.lineItemFieldLabel}>Product {idx + 1}</span>
                <ProductCombobox
                  index={index}
                  value={line.productId}
                  onChange={(_, next) => handleProductChange(line.id, next)}
                  disabled={disabled}
                  showStock={showAvailable}
                />
                {duplicateProductIds.has(line.productId) && (
                  <span className={styles.lineItemMeta} style={{ color: '#b45309' }}>
                    Already on another line
                  </span>
                )}

                {showAvailable && line.productId && (
                  <span className={styles.lineItemMeta}>
                    {availableLabel}: {available}
                    {over ? ` — exceeds by ${requested - available}` : ''}
                  </span>
                )}

                <span className={styles.lineItemFieldLabel}>{qtyLabel}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={line.qty}
                  disabled={disabled}
                  onChange={(e) => patchLine(line.id, { qty: toNumber(e.target.value) })}
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
                      onChange={(e) => patchLine(line.id, { rate: toNumber(e.target.value) })}
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
                    onClick={() => removeLine(line.id)}
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

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--admin-primary, #111827)',
  cursor: 'pointer',
  padding: '0 0 0 6px',
  fontSize: '0.75rem',
  textDecoration: 'underline',
};

export default StockLineItemsEditor;
export { emptyLine as emptyStockLine };
