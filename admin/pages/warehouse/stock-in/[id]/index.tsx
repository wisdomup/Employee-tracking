import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import StatusBadge from '../../../../components/UI/StatusBadge';
import ReasonModal from '../../../../components/Warehouse/ReasonModal';
import { stockInService, StockReceipt } from '../../../../services/stockInService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { formatRsExact, formatPieces } from '../../../../utils/formatCurrency';
import { printWarehouseSlip, stockInSlipDoc } from '../../../../utils/warehouseSlipPdf';
import { can } from '../../../../utils/permissions';
import { useAuth } from '../../../../contexts/AuthContext';
import styles from '../../../../styles/DetailPage.module.scss';

function StockInDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [receipt, setReceipt] = useState<StockReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [printBusy, setPrintBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const showMoney = can(user?.role, 'stock:set-low-level'); // admin-only, matches the API

  const fetchReceipt = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setLoading(true);
    try {
      setReceipt(await stockInService.getReceipt(id));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load the receipt'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchReceipt();
  }, [fetchReceipt]);

  const handlePrint = async () => {
    if (!id || typeof id !== 'string') return;
    setPrintBusy(true);
    try {
      // The slip payload comes from the API so the printed document matches what the server
      // considers authoritative — and so cost redaction is applied server-side, not in the browser.
      const slip = await stockInService.getReceiptSlip(id);
      await printWarehouseSlip(
        stockInSlipDoc({
          documentNo: slip.documentNo,
          receiptDateLabel: slip.receiptDate
            ? format(new Date(slip.receiptDate), 'MMM dd, yyyy')
            : '—',
          supplierName: slip.supplierName,
          warehouseName: slip.warehouseName,
          warehouseCity: slip.warehouseCity,
          preparedBy: slip.preparedBy,
          status: slip.status,
          cancelledByName: slip.cancelledByName,
          cancelReason: slip.cancelReason,
          notes: slip.notes,
          totalPieces: slip.totalPieces,
          totalAmount: slip.totalAmount,
          totalAmountLabel:
            slip.totalAmount !== null ? formatRsExact(slip.totalAmount) : undefined,
          lines: slip.lines.map((line) => ({
            productName: line.productName,
            barcode: line.barcode,
            quantity: line.quantity,
            rateLabel: formatRsExact(line.rate),
            amountLabel: formatRsExact(line.amount),
          })),
        }),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to generate the slip'));
    } finally {
      setPrintBusy(false);
    }
  };

  const handleCancel = async (reason: string) => {
    if (!id || typeof id !== 'string') return;
    setCancelBusy(true);
    try {
      await stockInService.cancelReceipt(id, reason);
      toast.success('Receipt cancelled and its stock reversed');
      setCancelOpen(false);
      fetchReceipt();
    } catch (err) {
      // The API refuses when the pieces have already left the warehouse, and says so.
      toast.error(getApiErrorMessage(err, 'Failed to cancel the receipt'));
    } finally {
      setCancelBusy(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!receipt) {
    return (
      <Layout>
        <div className={styles.container}>
          <p>Receipt not found.</p>
        </div>
      </Layout>
    );
  }

  const canCancel = can(user?.role, 'stock-in:cancel') && receipt.status === 'posted';

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            Stock In #{receipt.documentNo ? String(receipt.documentNo).padStart(5, '0') : '—'}
          </h1>
          <div className={styles.headerActions}>
            <button className={styles.editButton} onClick={handlePrint} disabled={printBusy}>
              {printBusy ? 'Preparing…' : 'Print slip'}
            </button>
            {canCancel && (
              <button className={styles.editButton} onClick={() => setCancelOpen(true)}>
                Cancel receipt
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/warehouse/stock-in')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Receipt</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Date</span>
                <span className={styles.value}>
                  {receipt.receiptDate ? format(new Date(receipt.receiptDate), 'MMM dd, yyyy') : '—'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Supplier</span>
                <span className={styles.value}>{receipt.supplierName || '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Received into</span>
                <span className={styles.value}>{receipt.warehouseId?.name ?? '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status</span>
                <span className={styles.value}>
                  <StatusBadge status={receipt.status} />
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Total pieces</span>
                <span className={styles.value}>{formatPieces(receipt.totalPieces ?? 0)}</span>
              </div>
              {showMoney && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Total value</span>
                  <span className={styles.value}>{formatRsExact(receipt.totalAmount ?? 0)}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Entered by</span>
                <span className={styles.value}>
                  {receipt.createdBy ? employeeDisplayLabel(receipt.createdBy) : '—'}
                </span>
              </div>
              {receipt.notes && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Notes</span>
                  <span className={styles.value}>{receipt.notes}</span>
                </div>
              )}
            </div>
          </div>

          {receipt.status === 'cancelled' && (
            <div className={styles.section}>
              <h2>Cancelled</h2>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Reason</span>
                  <span className={styles.value}>{receipt.cancelReason || '—'}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Cancelled by</span>
                  <span className={styles.value}>
                    {receipt.cancelledBy ? employeeDisplayLabel(receipt.cancelledBy) : '—'}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.label}>Cancelled at</span>
                  <span className={styles.value}>
                    {receipt.cancelledAt
                      ? format(new Date(receipt.cancelledAt), 'MMM dd, yyyy HH:mm')
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className={styles.section}>
            <h2>Products</h2>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  minWidth: 520,
                  borderCollapse: 'collapse',
                  fontSize: '0.875rem',
                }}
              >
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={th}>Product</th>
                    <th style={th}>Barcode</th>
                    <th style={{ ...th, textAlign: 'right' }}>Pieces</th>
                    {showMoney && <th style={{ ...th, textAlign: 'right' }}>Rate</th>}
                    {showMoney && <th style={{ ...th, textAlign: 'right' }}>Amount</th>}
                  </tr>
                </thead>
                <tbody>
                  {receipt.products.map((line, idx) => (
                    <tr key={idx}>
                      <td style={td}>{line.productId?.name ?? '—'}</td>
                      <td style={td}>{line.productId?.barcode ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{formatPieces(line.quantity)}</td>
                      {showMoney && (
                        <td style={{ ...td, textAlign: 'right' }}>{formatRsExact(line.rate)}</td>
                      )}
                      {showMoney && (
                        <td style={{ ...td, textAlign: 'right' }}>
                          {formatRsExact(line.quantity * line.rate)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <ReasonModal
        open={cancelOpen}
        title="Cancel this receipt"
        description="The receipt is kept for the record and its stock is reversed. If the pieces have already been transferred or sold, the cancellation will be refused."
        label="Cancel reason"
        confirmLabel="Cancel receipt"
        busy={cancelBusy}
        onClose={() => {
          if (!cancelBusy) setCancelOpen(false);
        }}
        onConfirm={handleCancel}
      />
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

export default function StockInDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <StockInDetailPage />
    </ProtectedRoute>
  );
}
