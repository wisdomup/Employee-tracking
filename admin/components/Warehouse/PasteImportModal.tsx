import React, { useEffect, useMemo, useState } from 'react';
import ProductCombobox from '../UI/ProductCombobox';
import { Product } from '../../services/productService';
import { ProductIndex, resolveProduct } from '../../utils/productSearch';
import {
  ColumnMapping,
  guessColumns,
  looksLikeHeader,
  parseNumericCell,
  parseTabular,
  TabularRow,
} from '../../utils/parseTabularPaste';
import modal from '../../styles/Modal.module.scss';
import styles from './PasteImportModal.module.scss';

/**
 * Bulk line entry from a supplier's spreadsheet.
 *
 * A 100-line receipt that arrived as a file should not be retyped. Matching is done against the
 * product catalogue by barcode first, then by exact name, then by a ranked search — but only a
 * barcode or an exact name is accepted without review. Everything else is put in front of the user,
 * because Stock In writes into an append-only ledger and a wrong guess is corrected by a cancel and
 * a re-entry, not by an edit.
 */

export interface ImportedLine {
  productId: string;
  qty: number;
  rate: number;
}

export interface PasteImportModalProps {
  open: boolean;
  index: ProductIndex;
  /** Show and require the rate column. Off for documents that do not carry a rate. */
  showRate?: boolean;
  onClose: () => void;
  onImport: (lines: ImportedLine[]) => void;
}

interface RowOverride {
  productId?: string;
  qty?: number;
  rate?: number;
  skipped?: boolean;
}

interface PreparedRow {
  key: number;
  cells: TabularRow;
  rawProduct: string;
  qty: number;
  rate: number;
  productId: string;
  product: Product | null;
  /** True when the text matched a barcode or an exact name — importable without review. */
  autoMatched: boolean;
  /**
   * Ranked near-misses for text that did not match outright. Offered as one-click chips: showing
   * the closest product is most of the work of correcting the row, but accepting it stays a
   * decision the user makes, because Stock In writes into an append-only ledger.
   */
  suggestions: Product[];
  qtyValid: boolean;
  skipped: boolean;
  needsAttention: boolean;
}

const PasteImportModal: React.FC<PasteImportModalProps> = ({ open, ...rest }) =>
  open ? <PasteImportModalBody {...rest} /> : null;

const PasteImportModalBody: React.FC<Omit<PasteImportModalProps, 'open'>> = ({
  index,
  showRate = true,
  onClose,
  onImport,
}) => {
  const [text, setText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [headerTouched, setHeaderTouched] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RowOverride>>({});
  const [showMatched, setShowMatched] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const rows = useMemo(() => (text.trim() ? parseTabular(text) : []), [text]);

  /* Header detection and column guessing follow the pasted text until the user overrides them. */
  const detectedHeader = rows.length > 0 && looksLikeHeader(rows[0]);
  const useHeader = headerTouched ? hasHeader : detectedHeader;
  const guessed = useMemo(() => guessColumns(rows, useHeader), [rows, useHeader]);
  const columns = mapping ?? guessed;

  const columnCount = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.length), 0),
    [rows],
  );

  const dataRows = useHeader ? rows.slice(1) : rows;

  const prepared = useMemo<PreparedRow[]>(() => {
    return dataRows.map((cells, i) => {
      const override = overrides[i] ?? {};
      const rawProduct = columns.product >= 0 ? cells[columns.product] ?? '' : '';
      const resolution = resolveProduct(index, rawProduct);
      const autoMatched = resolution.confidence === 'exact';

      const productId = override.productId ?? (autoMatched ? resolution.product?._id ?? '' : '');
      const product = productId
        ? index.products.find((p) => p._id === productId) ?? null
        : null;

      const parsedQty = columns.qty >= 0 ? parseNumericCell(cells[columns.qty] ?? '') : NaN;
      const qty = override.qty ?? (Number.isFinite(parsedQty) ? parsedQty : NaN);

      const parsedRate = columns.rate >= 0 ? parseNumericCell(cells[columns.rate] ?? '') : NaN;
      const fallbackRate = product?.lastPurchaseRate ?? product?.purchasePrice ?? 0;
      const rate = override.rate ?? (Number.isFinite(parsedRate) ? parsedRate : fallbackRate);

      const qtyValid = Number.isFinite(qty) && qty > 0 && Number.isInteger(qty);
      const skipped = override.skipped ?? false;

      return {
        key: i,
        cells,
        rawProduct,
        qty,
        rate,
        productId,
        product,
        autoMatched,
        suggestions: productId ? [] : resolution.suggestions.slice(0, 3),
        qtyValid,
        skipped,
        needsAttention: !skipped && (!productId || !qtyValid),
      };
    });
  }, [dataRows, overrides, columns, index]);

  const attention = prepared.filter((r) => r.needsAttention);
  const ready = prepared.filter((r) => !r.skipped && !r.needsAttention);
  const skippedCount = prepared.filter((r) => r.skipped).length;

  const patch = (key: number, next: RowOverride) =>
    setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }));

  /** Rows whose text found a near-miss but no outright match — the "did you mean" population. */
  const suggestable = prepared.filter((r) => !r.skipped && !r.productId && r.suggestions.length > 0);

  const acceptAllSuggestions = () =>
    setOverrides((prev) => {
      const next = { ...prev };
      for (const row of suggestable) {
        next[row.key] = { ...next[row.key], productId: row.suggestions[0]._id };
      }
      return next;
    });

  const handleImport = () => {
    /* Two spreadsheet rows for the same product would trip the receipt's one-line-per-product
       rule, so fold them here rather than handing the grid a conflict to report. */
    const merged = new Map<string, ImportedLine>();
    for (const row of ready) {
      const existing = merged.get(row.productId);
      if (existing) {
        existing.qty += row.qty;
        existing.rate = row.rate;
      } else {
        merged.set(row.productId, { productId: row.productId, qty: row.qty, rate: row.rate });
      }
    }
    onImport([...merged.values()]);
    onClose();
  };

  const columnOptions = [
    { value: -1, label: '— none —' },
    ...Array.from({ length: columnCount }, (_, i) => ({
      value: i,
      label: useHeader && rows[0]?.[i] ? `${i + 1}. ${rows[0][i]}` : `Column ${i + 1}`,
    })),
  ];

  const setColumn = (field: keyof ColumnMapping, value: number) =>
    setMapping({ ...columns, [field]: value });

  const renderRow = (row: PreparedRow) => (
    <div
      key={row.key}
      className={`${styles.row}${row.skipped ? ` ${styles.rowSkipped}` : ''}`}
    >
      <div className={styles.raw}>
        <div>{row.rawProduct || <em style={{ color: '#9ca3af' }}>(blank)</em>}</div>
        <div className={styles.rawLine}>Row {row.key + (useHeader ? 2 : 1)}</div>
      </div>

      <div className={styles.productCell}>
        <ProductCombobox
          index={index}
          value={row.productId}
          onChange={(productId) => patch(row.key, { productId })}
          initialQuery={row.productId ? undefined : row.rawProduct}
          disabled={row.skipped}
          placeholder="Pick the product…"
        />
        {!row.skipped && row.suggestions.length > 0 && (
          <div className={styles.suggestions}>
            <span className={styles.suggestionsLabel}>Closest:</span>
            {row.suggestions.map((suggestion) => (
              <button
                key={suggestion._id}
                type="button"
                className={styles.suggestionChip}
                title={`${suggestion.name} (${suggestion.barcode})`}
                onClick={() => patch(row.key, { productId: suggestion._id })}
              >
                {suggestion.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        className={`${styles.numberInput}${row.qtyValid ? '' : ` ${styles.inputError}`}`}
        type="number"
        min={1}
        step={1}
        aria-label="Pieces"
        value={Number.isFinite(row.qty) ? row.qty : ''}
        disabled={row.skipped}
        onChange={(e) => patch(row.key, { qty: parseNumericCell(e.target.value) })}
      />

      {showRate ? (
        <input
          className={styles.numberInput}
          type="number"
          min={0}
          step="0.01"
          aria-label="Rate"
          value={Number.isFinite(row.rate) ? row.rate : ''}
          disabled={row.skipped}
          onChange={(e) => patch(row.key, { rate: parseNumericCell(e.target.value) })}
        />
      ) : (
        <span />
      )}

      <label className={styles.skipCell}>
        <input
          type="checkbox"
          checked={row.skipped}
          onChange={(e) => patch(row.key, { skipped: e.target.checked })}
        />
        skip
      </label>
    </div>
  );

  const headings = (
    <div className={`${styles.row} ${styles.rowHeading}`}>
      <span>Pasted text</span>
      <span>Product</span>
      <span>Pieces</span>
      {showRate ? <span>Rate</span> : <span />}
      <span />
    </div>
  );

  return (
    <div className={modal.modalOverlay} onClick={onClose} role="presentation">
      <div
        className={`${modal.modalContent} ${styles.wide}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Paste products from a spreadsheet"
      >
        <div className={modal.modalHeader}>
          <h2>Paste from Excel</h2>
        </div>

        <div className={modal.formGroup}>
          <label htmlFor="paste-import-text">
            Copy the rows out of the supplier&apos;s sheet and paste them here
          </label>
          <textarea
            id="paste-import-text"
            className={styles.textarea}
            value={text}
            placeholder={'Product\tPieces\tRate\n8901234567890\t24\t85\nDiet Cola 500ml\t12\t42.5'}
            onChange={(e) => {
              setText(e.target.value);
              setOverrides({});
              setMapping(null);
              setHeaderTouched(false);
            }}
          />
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            Tab, comma or semicolon separated. A barcode column matches most reliably.
          </span>
        </div>

        {rows.length > 0 && (
          <>
            <div className={styles.mapper}>
              {(['product', 'qty', 'rate'] as const).map((field) =>
                field === 'rate' && !showRate ? null : (
                  <label key={field} className={styles.mapperField}>
                    {field === 'product' ? 'Product column' : field === 'qty' ? 'Pieces column' : 'Rate column'}
                    <select
                      className={styles.mapperSelect}
                      value={columns[field]}
                      onChange={(e) => setColumn(field, Number(e.target.value))}
                    >
                      {columnOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )}

              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={useHeader}
                  onChange={(e) => {
                    setHeaderTouched(true);
                    setHasHeader(e.target.checked);
                    setOverrides({});
                    setMapping(null);
                  }}
                />
                First row is a header
              </label>
            </div>

            <div className={styles.summary}>
              <span className={styles.summaryItem}>
                <strong>{ready.length}</strong> ready
              </span>
              <span className={`${styles.summaryItem} ${styles.summaryBlocking}`}>
                <strong>{attention.length}</strong> need review
              </span>
              <span className={styles.summaryItem}>
                <strong>{skippedCount}</strong> skipped
              </span>
            </div>

            {attention.length > 0 && (
              <div className={styles.blocked}>
                Nothing is imported until every row is matched to a product with a whole-number
                quantity, or ticked as skipped.
                {suggestable.length > 0 && (
                  <>
                    {' '}
                    Each unmatched row below offers its closest products — click one to use it.
                    <button type="button" className={styles.acceptAll} onClick={acceptAllSuggestions}>
                      Use the closest match on all {suggestable.length}
                    </button>
                  </>
                )}
              </div>
            )}

            {attention.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>Needs review ({attention.length})</div>
                {headings}
                <div className={styles.rows}>{attention.map(renderRow)}</div>
              </div>
            )}

            {(ready.length > 0 || skippedCount > 0) && (
              <div className={styles.section}>
                <button
                  type="button"
                  className={styles.sectionHeader}
                  onClick={() => setShowMatched((v) => !v)}
                >
                  {showMatched ? '▾' : '▸'} Matched and skipped ({ready.length + skippedCount})
                </button>
                {showMatched && (
                  <>
                    {headings}
                    <div className={styles.rows}>
                      {prepared.filter((r) => !r.needsAttention).map(renderRow)}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        <div className={modal.modalActions}>
          <button type="button" className={modal.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={modal.submitButton}
            onClick={handleImport}
            disabled={ready.length === 0 || attention.length > 0}
          >
            Add {ready.length} line{ready.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PasteImportModal;
