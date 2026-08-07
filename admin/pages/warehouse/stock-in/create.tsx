import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import StockLineItemsEditor, {
  StockLine,
  emptyStockLine,
} from '../../../components/Warehouse/StockLineItemsEditor';
import { stockInService } from '../../../services/stockInService';
import { warehouseService, Warehouse } from '../../../services/warehouseService';
import { productService, Product } from '../../../services/productService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatRsExact } from '../../../utils/formatCurrency';
import styles from '../../../styles/FormPage.module.scss';

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Record goods received. Spec §6: pick the product, enter pieces and rate; stock always goes to the
 * main warehouse; the average cost updates automatically.
 *
 * There is no warehouse picker on purpose — the destination is fixed, so showing a dropdown with
 * one always-correct answer would only invite the question of what happens if you change it.
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
  }, []);

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
      toast.success('Stock In recorded');
      router.push('/warehouse/stock-in');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to record Stock In'));
    } finally {
      setLoading(false);
    }
  };

  const noMain = warehouseChecked && !mainWarehouse;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Record Stock In</h1>
          <button className={styles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

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

          <StockLineItemsEditor
            products={products}
            value={lines}
            onChange={setLines}
            qtyLabel="Pieces"
            showRate
            showLastPurchaseRate
            defaultRateFor={(p) => p.lastPurchaseRate ?? p.purchasePrice ?? 0}
            disabled={loading || noMain}
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

          <div className={styles.formActions}>
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
      </div>
    </Layout>
  );
}

export default function CreateStockInPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <CreateStockInPage />
    </ProtectedRoute>
  );
}
