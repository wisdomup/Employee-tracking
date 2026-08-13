import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import DatePickerFilter from '../../../../components/UI/DatePickerFilter';
import StockLineItemsEditor, {
  StockLine,
  emptyStockLine,
  toStockLine,
} from '../../../../components/Warehouse/StockLineItemsEditor';
import { stockInService, StockReceipt } from '../../../../services/stockInService';
import { productService, Product } from '../../../../services/productService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { formatRsExact } from '../../../../utils/formatCurrency';
import styles from '../../../../styles/FormPage.module.scss';

/** `YYYY-MM-DD` from an ISO timestamp, for the date picker. */
function dayKey(value: string | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function idOf(ref: unknown): string {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  return String((ref as { _id?: unknown })._id ?? '');
}

/**
 * Correct a wrong Stock In — admin only.
 *
 * This is not a normal edit form. Saving reverses the receipt's original ledger posting in full
 * and re-applies the corrected one, which is what lets a wrong *rate* leave the product's
 * weighted-average cost. Two consequences the admin needs to see before they press Save, and
 * which the page states plainly:
 *
 *  • the correction is refused outright if the pieces have already been sold or transferred
 *    out of the main warehouse — there is nothing left to take back;
 *  • the document number does not change, so a slip already handed to a supplier still matches.
 */
function EditStockInPage() {
  const router = useRouter();
  const { id } = router.query;

  const [receipt, setReceipt] = useState<StockReceipt | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);

  const [receiptDate, setReceiptDate] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<StockLine[]>([emptyStockLine()]);

  useEffect(() => {
    productService
      .getProducts()
      .then(setProducts)
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load products')));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    stockInService
      .getReceipt(id as string)
      .then((data) => {
        if (cancelled) return;
        setReceipt(data);
        setReceiptDate(dayKey(data.receiptDate));
        setSupplierName(data.supplierName ?? '');
        setNotes(data.notes ?? '');
        setLines(
          data.products.map((line) =>
            toStockLine({
              productId: idOf(line.productId),
              qty: line.quantity,
              rate: line.rate,
            }),
          ),
        );
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load the receipt')))
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const totals = useMemo(() => {
    const pieces = lines.reduce((sum, l) => sum + (l.qty || 0), 0);
    const value = lines.reduce((sum, l) => sum + (l.qty || 0) * (l.rate || 0), 0);
    return { pieces, value };
  }, [lines]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receipt) return;

    if (!receiptDate) {
      toast.error('Pick the date the goods were received');
      return;
    }
    if (!reason.trim()) {
      toast.error('Say why the receipt is being corrected — it goes on the audit trail');
      return;
    }

    const validLines = lines.filter((l) => l.productId && l.qty > 0);
    if (validLines.length === 0) {
      toast.error('A receipt needs at least one product with a quantity');
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

    setSaving(true);
    try {
      await stockInService.updateReceipt(receipt._id, {
        receiptDate,
        supplierName: supplierName.trim(),
        notes: notes.trim(),
        reason: reason.trim(),
        products: validLines.map((l) => ({
          productId: l.productId,
          quantity: l.qty,
          rate: l.rate,
        })),
      });
      toast.success('Receipt corrected and stock re-posted');
      router.push(`/warehouse/stock-in/${receipt._id}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to correct the receipt'));
    } finally {
      setSaving(false);
    }
  };

  if (fetching) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!receipt) {
    return (
      <Layout>
        <div className={styles.container}>Stock In receipt not found</div>
      </Layout>
    );
  }

  if (receipt.status === 'cancelled') {
    return (
      <Layout>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1>Edit Stock In</h1>
            <button className={styles.backButton} onClick={() => router.back()}>
              ← Back
            </button>
          </div>
          <p className={styles.hint}>
            This receipt was cancelled, so its stock has already been given back. A cancelled
            receipt cannot be corrected — record a new Stock In instead.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            Correct Stock In
            {receipt.documentNo ? ` #${String(receipt.documentNo).padStart(5, '0')}` : ''}
          </h1>
          <button className={styles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

        <div
          style={{
            padding: '0.9rem 1.15rem',
            marginBottom: '1.25rem',
            borderRadius: '0.6rem',
            border: '1px solid #fcd34d',
            background: '#fffbeb',
            color: '#78350f',
            fontSize: '0.875rem',
            lineHeight: 1.55,
          }}
        >
          Saving reverses this receipt&apos;s original stock movement in full and re-posts the
          corrected one, so a wrong rate also leaves the product&apos;s average cost. The document
          number stays the same. If any of these pieces have already been sold or transferred out
          of the main warehouse, the correction will be refused — cancel the receipt instead.
          {receipt.editCount ? (
            <div style={{ marginTop: '0.5rem' }}>
              This receipt has already been corrected {receipt.editCount} time
              {receipt.editCount === 1 ? '' : 's'}.
            </div>
          ) : null}
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
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
            disabled={saving}
          />

          <div className={styles.formGroup}>
            <label htmlFor="reason">Reason for the correction *</label>
            <input
              id="reason"
              className={styles.input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Counted 120 pieces, the invoice said 100"
              maxLength={500}
            />
            <span className={styles.hint}>
              Recorded against the receipt and the stock ledger — the old figures were already on a
              printed slip.
            </span>
          </div>

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
              After the correction this receipt will hold{' '}
              <strong>{totals.pieces} piece(s)</strong> worth{' '}
              <strong>{formatRsExact(totals.value)}</strong> (was {receipt.totalPieces} piece(s)
              worth {formatRsExact(receipt.totalAmount)}).
            </span>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push(`/warehouse/stock-in/${receipt._id}`)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Saving…' : 'Save Correction'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function EditStockInPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <EditStockInPage />
    </ProtectedRoute>
  );
}
