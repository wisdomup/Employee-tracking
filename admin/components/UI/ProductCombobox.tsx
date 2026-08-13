import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Product, productService } from '../../services/productService';
import { ProductIndex, searchProducts } from '../../utils/productSearch';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatRsExact } from '../../utils/formatCurrency';
import styles from './ProductCombobox.module.scss';

/**
 * Type-ahead product picker: a plain input plus a portalled result list.
 *
 * Deliberately not built on `SearchableSelect`/react-select. The stock entry grids mount one picker
 * per line, and a react-select instance per row — each closing over the whole catalogue — is what
 * made a 100-line receipt unusable. This mounts one input and renders a menu only while focused.
 *
 * The menu is portalled to document.body and positioned imperatively, for the same reason
 * react-select uses `menuPortalTarget`: the line-items table scrolls horizontally, which would clip
 * an absolutely positioned child.
 */

/** Above this many products, filter on the server instead of walking the whole list per keystroke. */
const REMOTE_SEARCH_THRESHOLD = 5000;

export interface ProductComboboxProps {
  index: ProductIndex;
  /** Selected product id, or '' for none. */
  value: string;
  onChange: (productId: string, product: Product | null) => void;
  /** Fired after a selection is made, so a parent can advance focus. */
  onCommit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Seeds the query box — used by the paste reconciler to show the text that failed to match. */
  initialQuery?: string;
  /** Show `In stock: N` on each option. Off where the number would be misleading. */
  showStock?: boolean;
  id?: string;
  className?: string;
  inputClassName?: string;
  /** Lets a parent move focus into the box — the quick-add bar cycles focus back here per line. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Fired on Escape with the menu already closed — lets a grid cell drop back to read mode. */
  onDismiss?: () => void;
}

function labelFor(product: Product | undefined | null): string {
  if (!product) return '';
  return product.barcode ? `${product.name} (${product.barcode})` : product.name;
}

const ProductCombobox: React.FC<ProductComboboxProps> = ({
  index,
  value,
  onChange,
  onCommit,
  placeholder = 'Type product name or barcode…',
  disabled = false,
  autoFocus = false,
  initialQuery = '',
  showStock = false,
  id,
  className,
  inputClassName,
  inputRef: externalInputRef,
  onDismiss,
}) => {
  const menuId = `${useId()}-menu`;

  const selected = useMemo(
    () => (value ? index.products.find((p) => p._id === value) ?? null : null),
    [index, value],
  );

  /**
   * What the user has typed, or `null` for "not typing — show the current selection".
   *
   * Holding the untyped state as null rather than mirroring the selection's label into state is
   * what keeps this component effect-free: when the row's product changes from outside (a paste
   * import, an undo, a merge), the displayed label follows automatically.
   */
  const [typed, setTyped] = useState<string | null>(initialQuery || null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remote, setRemote] = useState<Product[] | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /* Mirror the node into the caller's ref rather than using theirs directly — a single internal ref
     keeps the callbacks below dependency-free and stable. */
  const attachInput = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (externalInputRef) externalInputRef.current = node;
    },
    [externalInputRef],
  );

  const query = typed ?? '';
  const displayValue = typed ?? labelFor(selected);

  const useRemote = index.products.length > REMOTE_SEARCH_THRESHOLD;
  const debouncedQuery = useDebouncedValue(query, 250);

  useEffect(() => {
    if (!useRemote || !open) return;
    let cancelled = false;
    productService
      .getProducts({ search: debouncedQuery })
      .then((list: Product[]) => {
        if (!cancelled) setRemote(Array.isArray(list) ? list.slice(0, 50) : []);
      })
      .catch(() => {
        if (!cancelled) setRemote([]);
      });
    return () => {
      cancelled = true;
    };
  }, [useRemote, open, debouncedQuery]);

  const results = useMemo(() => {
    if (useRemote) return remote ?? [];
    return searchProducts(index, query, 50);
  }, [useRemote, remote, index, query]);

  /* Clamp rather than reset through an effect: the list shrinks as the query narrows, and the
     highlight has to stay inside it without a second render pass. */
  const active = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  /**
   * Position imperatively. Storing the rect in state would mean measuring in an effect and setting
   * state during commit — a second render for every scroll event, on a page that may hold 100 of
   * these.
   */
  const positionMenu = useCallback(() => {
    const input = inputRef.current;
    const menu = menuRef.current;
    if (!input || !menu) return;
    const rect = input.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    menu.style.width = `${rect.width}px`;
  }, []);

  const attachMenu = useCallback(
    (node: HTMLDivElement | null) => {
      menuRef.current = node;
      if (node) positionMenu();
    },
    [positionMenu],
  );

  useEffect(() => {
    if (!open) return;
    // Capture phase: the line-items table is itself a scroll container, not just the window.
    window.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
    return () => {
      window.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('resize', positionMenu);
    };
  }, [open, positionMenu]);

  /* Keep the highlighted option in view when arrowing past the fold. Reads the DOM, writes nothing. */
  useEffect(() => {
    if (!open) return;
    const node = menuRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const select = (product: Product) => {
    onChange(product._id, product);
    setTyped(null);
    setActiveIndex(0);
    setOpen(false);
    onCommit?.();
  };

  const revert = () => {
    setTyped(null);
    setActiveIndex(0);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((active + delta + results.length) % results.length);
      return;
    }

    if (e.key === 'Enter') {
      // Always swallow Enter: this sits inside a <form>, and a bare Enter would submit the receipt.
      e.preventDefault();
      if (open && results[active]) select(results[active]);
      else if (!open) setOpen(true);
      return;
    }

    if (e.key === 'Tab') {
      if (open && results[active] && typed) select(results[active]);
      else setOpen(false);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (open) revert();
      else onDismiss?.();
    }
  };

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={attachMenu}
            id={menuId}
            className={styles.menu}
            role="listbox"
            // Pointer-down would blur the input and close the menu before click ever lands.
            onMouseDown={(e) => e.preventDefault()}
          >
            {results.length === 0 ? (
              <div className={styles.empty}>No matching product</div>
            ) : (
              results.map((product, i) => (
                <div
                  key={product._id}
                  role="option"
                  aria-selected={i === active}
                  className={`${styles.option}${i === active ? ` ${styles.optionActive}` : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => select(product)}
                >
                  <div className={styles.optionMain}>
                    <div className={styles.optionName}>{product.name}</div>
                    <div className={styles.optionBarcode}>{product.barcode || '—'}</div>
                  </div>
                  <div className={styles.optionMeta}>
                    <div>
                      Last: {product.lastPurchaseRate ? formatRsExact(product.lastPurchaseRate) : '—'}
                    </div>
                    {showStock && <div>In stock: {product.quantity ?? 0}</div>}
                  </div>
                </div>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`${styles.wrap}${className ? ` ${className}` : ''}`}>
      <input
        ref={attachInput}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-autocomplete="list"
        autoComplete="off"
        className={`${styles.input}${selected ? ` ${styles.inputFilled}` : ''}${
          inputClassName ? ` ${inputClassName}` : ''
        }`}
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          setTyped(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          setActiveIndex(0);
          setOpen(true);
          e.target.select();
        }}
        onBlur={revert}
        onKeyDown={handleKeyDown}
      />
      {menu}
    </div>
  );
};

export default ProductCombobox;
