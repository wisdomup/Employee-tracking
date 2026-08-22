import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import StockLineItemsEditor, {
  StockLine,
  emptyStockLine,
  mergeDuplicateLines,
  toStockLine,
} from '../../../components/Warehouse/StockLineItemsEditor';
import QuickAddBar from '../../../components/Warehouse/QuickAddBar';
import PasteImportModal, { ImportedLine } from '../../../components/Warehouse/PasteImportModal';
import { stockInService } from '../../../services/stockInService';
import { warehouseService, Warehouse } from '../../../services/warehouseService';
import { productService, Product } from '../../../services/productService';
import { buildProductIndex } from '../../../utils/productSearch';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatRsExact } from '../../../utils/formatCurrency';
import styles from '../../../styles/FormPage.module.scss';

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/** Local only. Bumped if the draft shape ever changes, so a stale draft is ignored, not misread. */
const DRAFT_KEY = 'stockin-draft-v1';

interface StockInDraft {
  receiptDate: string;
  supplierName: string;
  notes: string;
  lines: StockLine[];
  savedAt: number;
}

function readDraft(): StockInDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as StockInDraft;
    if (!Array.isArray(draft.lines) || draft.lines.length === 0) return null;
    // A single blank starter line is not work worth restoring.
    if (!draft.lines.some((l) => l.productId)) return null;
    return draft;
  } catch {
    return null;
  }
}

/**
 * The form opens with one blank line so the grid is not empty. Once the quick-add bar or an import
 * supplies real lines, that placeholder is dropped — but only when it is genuinely the untouched
 * starter, never blank rows the user added themselves and has not filled in yet.
 */
function withoutStarterLine(lines: StockLine[]): StockLine[] {
  return lines.length === 1 && !lines[0].productId ? [] : lines;
}

/**
 * Record goods received. Spec §6: pick the product, enter pieces and rate; stock always goes to the
 * main warehouse; the average cost updates automatically.
 *
 * There is no warehouse picker on purpose — the destination is fixed, so showing a dropdown with
 * one always-correct answer would only invite the question of what happens if you change it.
 *
 * Receipts here run to 100+ lines, so there are three ways in: the quick-add bar (keyboard only,
 * one line per three Enters), Paste from Excel for supplier files, and the grid itself for
 * corrections. All three write the same `lines` state.
 */
function CreateStockInPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [mainWarehouse, setMainWarehouse] = useState<Warehouse | null>(null);
  const [warehouseChecked, setWarehouseChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  const [receiptDate, setReceiptDate] = useState(todayKey());
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<StockLine[]>([emptyStockLine()]);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [lastAddedLabel, setLastAddedLabel] = useState<string | null>(null);
  const [flashLineId, setFlashLineId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StockInDraft | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);

  /** Snapshot taken before each quick add, so Undo restores exactly what was there. */
  const undoSnapshot = useRef<StockLine[] | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    productService
      .getProducts()
      .then(setProducts)
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load products')));

    warehouseService
      .getMainWarehouse()
      .then(setMainWarehouse)
      .catch(() => setMainWarehouse(null))
      .finally(() => setWarehouseChecked(true));

    setDraft(readDraft());
  }, []);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const productIndex = useMemo(() => buildProductIndex(products), [products]);

  /**
   * Autosave. A hundred typed lines lost to an accidental refresh or a tapped Back is the worst
   * failure this page has, and it costs one debounced localStorage write to prevent.
   */
  useEffect(() => {
    if (submitted.current) return;
    if (!lines.some((l) => l.productId)) return;

    const timer = setTimeout(() => {
      try {
        const payload: StockInDraft = { receiptDate, supplierName, notes, lines, savedAt: Date.now() };
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      } catch {
        /* Private mode or a full quota — autosave is a convenience, never a blocker. */
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [receiptDate, supplierName, notes, lines]);

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  const restoreDraft = () => {
    if (!draft) return;
    setReceiptDate(draft.receiptDate || todayKey());
    setSupplierName(draft.supplierName ?? '');
    setNotes(draft.notes ?? '');
    // Older drafts predate stable line ids; mint any that are missing.
    setLines(draft.lines.map((l) => (l.id ? l : toStockLine(l))));
    setDraft(null);
  };

  const flash = (lineId: string) => {
    setFlashLineId(lineId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashLineId(null), 1200);
  };

  /**
   * Add one line, or fold into the existing line for that product. Re-entering a product is how a
   * second carton of the same item gets recorded, and the receipt only allows one line per product
   * — so merging is the correct reading of the action, not an error to report at submit time.
   */
  const handleQuickAdd = useCallback((product: Product, qty: number, rate: number) => {
    undoSnapshot.current = lines;

    const existing = lines.find((l) => l.productId === product._id);
    if (existing) {
      setLines(lines.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + qty, rate } : l)));
      flash(existing.id);
      setLastAddedLabel(`${product.name} × ${qty} (merged, now ${existing.qty + qty})`);
      return true;
    }

    const line = toStockLine({ productId: product._id, qty, rate });
    setLines([...withoutStarterLine(lines), line]);
    flash(line.id);
    setLastAddedLabel(`${product.name} × ${qty}`);
    return true;
  }, [lines]);

  const handleUndo = () => {
    if (!undoSnapshot.current) return;
    setLines(undoSnapshot.current);
    undoSnapshot.current = null;
    setLastAddedLabel(null);
  };

  const handleImport = (imported: ImportedLine[]) => {
    undoSnapshot.current = lines;
    const merged = mergeDuplicateLines([
      ...withoutStarterLine(lines),
      ...imported.map((line) => toStockLine(line)),
    ]);
    setLines(merged.length > 0 ? merged : [emptyStockLine()]);
    setLastAddedLabel(`${imported.length} line(s) from the pasted sheet`);
    toast.success(`Added ${imported.length} line(s)`);
  };

  const totals = useMemo(() => {
    const pieces = lines.reduce((sum, l) => sum + (l.qty || 0), 0);
    const value = lines.reduce((sum, l) => sum + (l.qty || 0) * (l.rate || 0), 0);
    return { pieces, value };
  }, [lines]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!mainWarehouse) {
      toast.error('No main warehouse is configured — create one first');
      return;
    }
    if (!receiptDate) {
      toast.error('Pick the date the goods were received');
      return;
    }

    const validLines = lines.filter((l) => l.productId && l.qty > 0);
    if (validLines.length === 0) {
      toast.error('Add at least one product with a quantity');
      return;
    }
    if (validLines.some((l) => !Number.isInteger(l.qty))) {
      toast.error('Stock is counted in whole pieces — no fractions');
      return;
    }
    if (validLines.some((l) => l.rate < 0)) {
      toast.error('A rate cannot be negative');
      return;
    }
    const productIds = validLines.map((l) => l.productId);
    if (new Set(productIds).size !== productIds.length) {
      toast.error('The same product appears on more than one line — combine them into one');
      return;
    }

    setLoading(true);
    try {
      await stockInService.createReceipt({
        receiptDate,
        ...(supplierName.trim() ? { supplierName: supplierName.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        products: validLines.map((l) => ({
          productId: l.productId,
          quantity: l.qty,
          rate: l.rate,
        })),
      });
      submitted.current = true;
      clearDraft();
      toast.success('Stock In recorded');
      router.push('/warehouse/stock-in');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to record Stock In'));
    } finally {
      setLoading(false);
    }
  };

  const noMain = warehouseChecked && !mainWarehouse;
  const entryDisabled = loading || noMain;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Record Stock In</h1>
          <button className={styles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

        {draft && !draftDismissed && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              borderRadius: 8,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1e40af',
              fontSize: '0.875rem',
            }}
          >
            <span>
              Unfinished Stock In from{' '}
              {new Date(draft.savedAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              — {draft.lines.filter((l) => l.productId).length} line(s).
            </span>
            <button type="button" className={styles.cancelButton} onClick={restoreDraft}>
              Restore
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => {
                clearDraft();
                setDraft(null);
                setDraftDismissed(true);
              }}
            >
              Discard
            </button>
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label>Received into</label>
            <span className={styles.hint} style={{ fontSize: '0.9375rem', color: '#111827' }}>
              {noMain ? (
                <strong style={{ color: '#b91c1c' }}>
                  No main warehouse is configured. Create a warehouse and mark it as Main before
                  recording Stock In.
                </strong>
              ) : mainWarehouse ? (
                <>
                  <strong>{mainWarehouse.name}</strong>
                  {mainWarehouse.city ? ` — ${mainWarehouse.city}` : ''}
                </>
              ) : (
                'Loading…'
              )}
            </span>
            <span className={styles.hint}>
              All purchases land in the main warehouse first. Use a transfer to move stock out to
              another warehouse.
            </span>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="receiptDate">Receipt date *</label>
              <DatePickerFilter
                id="receiptDate"
                value={receiptDate}
                onChange={setReceiptDate}
                placeholder="Select date"
                fullWidth
              />
              <span className={styles.hint}>
                This is the business date — a backdated receipt sorts by when the goods arrived.
              </span>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="supplierName">Supplier</label>
              <input
                id="supplierName"
                className={styles.input}
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="e.g. Acme Traders"
              />
              <span className={styles.hint}>Optional — free text, for the receipt only.</span>
            </div>
          </div>

          <QuickAddBar
            index={productIndex}
            onAdd={handleQuickAdd}
            defaultRateFor={(p) => p.lastPurchaseRate ?? p.purchasePrice ?? 0}
            disabled={entryDisabled}
            lastAddedLabel={lastAddedLabel}
            onUndo={lastAddedLabel ? handleUndo : undefined}
          />

          <StockLineItemsEditor
            products={products}
            productIndex={productIndex}
            value={lines}
            onChange={setLines}
            qtyLabel="Pieces"
            showRate
            showLastPurchaseRate
            defaultRateFor={(p) => p.lastPurchaseRate ?? p.purchasePrice ?? 0}
            disabled={entryDisabled}
            flashLineId={flashLineId}
            headerActions={
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setPasteOpen(true)}
                disabled={entryDisabled}
                style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
              >
                Paste from Excel
              </button>
            }
          />

          <div className={styles.formGroup}>
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              className={styles.textarea}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <span className={styles.hint}>
              Recording this receipt adds <strong>{totals.pieces} piece(s)</strong> worth{' '}
              <strong>{formatRsExact(totals.value)}</strong> and updates each product’s running
              average cost.
            </span>
          </div>

          <div
            className={styles.formActions}
            style={{
              position: 'sticky',
              bottom: 0,
              background: '#fff',
              paddingTop: '0.75rem',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <span
              style={{
                marginRight: 'auto',
                fontSize: '0.875rem',
                color: '#374151',
                alignSelf: 'center',
              }}
            >
              <strong>{totals.pieces}</strong> pcs · <strong>{formatRsExact(totals.value)}</strong>
            </span>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/warehouse/stock-in')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading || noMain}>
              {loading ? 'Recording…' : 'Record Stock In'}
            </button>
          </div>
        </form>

        <PasteImportModal
          open={pasteOpen}
          index={productIndex}
          onClose={() => setPasteOpen(false)}
          onImport={handleImport}
        />
      </div>
    </Layout>
  );
}

export default function CreateStockInPageWrapper() {
  return (
    <ProtectedRoute permission="stock-in:add">
      <CreateStockInPage />
    </ProtectedRoute>
  );
}
