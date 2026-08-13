import React, { useRef, useState } from 'react';
import ProductCombobox from '../UI/ProductCombobox';
import { Product } from '../../services/productService';
import { ProductIndex } from '../../utils/productSearch';
import styles from './QuickAddBar.module.scss';

/**
 * Keyboard-only line entry for large receipts.
 *
 * The grid below is still there for correcting what has already been entered, but adding a line
 * through it costs a click on "+ Add Row", a click into the dropdown and two tabs. At 100+ lines
 * that is the whole job. Here one line is: type enough of the name or barcode, Enter, pieces,
 * Enter, rate, Enter — focus returns to the product box and the hands never leave the keyboard.
 */
export interface QuickAddBarProps {
  index: ProductIndex;
  /** Adds or merges the line. Returns false to keep focus put (nothing was added). */
  onAdd: (product: Product, qty: number, rate: number) => boolean;
  defaultRateFor?: (product: Product) => number;
  showRate?: boolean;
  disabled?: boolean;
  /** e.g. `Diet Cola 500ml × 24`. Shown with an Undo link until the next add. */
  lastAddedLabel?: string | null;
  onUndo?: () => void;
}

const QuickAddBar: React.FC<QuickAddBarProps> = ({
  index,
  onAdd,
  defaultRateFor,
  showRate = true,
  disabled = false,
  lastAddedLabel,
  onUndo,
}) => {
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState('1');
  const [rate, setRate] = useState('0');

  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setProduct(null);
    setQty('1');
    setRate('0');
    productInputRef.current?.focus();
  };

  const handleProductChange = (_: string, next: Product | null) => {
    setProduct(next);
    if (next) setRate(String(defaultRateFor ? defaultRateFor(next) : next.lastPurchaseRate ?? 0));
  };

  const commit = () => {
    if (!product) {
      productInputRef.current?.focus();
      return;
    }
    const pieces = Number(qty);
    const unitRate = showRate ? Number(rate) : 0;
    if (!Number.isFinite(pieces) || pieces <= 0) {
      qtyRef.current?.focus();
      return;
    }
    if (showRate && (!Number.isFinite(unitRate) || unitRate < 0)) {
      rateRef.current?.focus();
      return;
    }
    if (onAdd(product, pieces, unitRate)) reset();
  };

  /* Enter anywhere in this bar must never reach the surrounding <form> and submit the receipt. */
  const advanceOn = (e: React.KeyboardEvent<HTMLInputElement>, next: () => void) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    next();
  };

  return (
    <div className={styles.bar}>
      <div className={`${styles.field} ${styles.product}`}>
        <label className={styles.label} htmlFor="quick-add-product">
          Product
        </label>
        <ProductCombobox
          id="quick-add-product"
          index={index}
          value={product?._id ?? ''}
          onChange={handleProductChange}
          onCommit={() => qtyRef.current?.focus()}
          inputRef={productInputRef}
          disabled={disabled}
          autoFocus
        />
      </div>

      <div className={`${styles.field} ${styles.number}`}>
        <label className={styles.label} htmlFor="quick-add-qty">
          Pieces
        </label>
        <input
          id="quick-add-qty"
          ref={qtyRef}
          className={styles.input}
          type="number"
          min={1}
          step={1}
          value={qty}
          disabled={disabled}
          onChange={(e) => setQty(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => advanceOn(e, () => (showRate ? rateRef.current?.focus() : commit()))}
        />
      </div>

      {showRate && (
        <div className={`${styles.field} ${styles.number}`}>
          <label className={styles.label} htmlFor="quick-add-rate">
            Rate
          </label>
          <input
            id="quick-add-rate"
            ref={rateRef}
            className={styles.input}
            type="number"
            min={0}
            step="0.01"
            value={rate}
            disabled={disabled}
            onChange={(e) => setRate(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => advanceOn(e, commit)}
          />
        </div>
      )}

      <button type="button" className={styles.addButton} onClick={commit} disabled={disabled}>
        Add line
      </button>

      <div className={styles.footer}>
        <span className={styles.confirmation}>
          {lastAddedLabel ? (
            <>
              Added {lastAddedLabel}
              {onUndo && (
                <button type="button" className={styles.undo} onClick={onUndo}>
                  undo
                </button>
              )}
            </>
          ) : null}
        </span>
        <span className={styles.hint}>
          Enter moves Product → Pieces{showRate ? ' → Rate' : ''} → next line. Barcodes work too.
        </span>
      </div>
    </div>
  );
};

export default QuickAddBar;
