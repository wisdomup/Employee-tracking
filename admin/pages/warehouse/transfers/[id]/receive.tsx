import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import WarehouseModuleNav from '../../../../components/Warehouse/WarehouseModuleNav';
import { stockTransferService, StockTransfer } from '../../../../services/stockTransferService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { formatPieces } from '../../../../utils/formatCurrency';
import formStyles from '../../../../styles/FormPage.module.scss';
import reportStyles from '../../../../styles/StockReports.module.scss';

/**
 * The receiving warehouse confirms what actually turned up (spec §8 step 3).
 *
 * Received is prefilled with the sent quantity, so an untouched form means "everything arrived".
 * Any difference is shown live and the banner spells out the consequence, because a mismatch is not
 * a validation error — it is a real event that needs an admin to resolve.
 */
interface DraftLine {
  productId: string;
  productName: string;
  barcode: string;
  sentQty: number;
  receivedQty: string;
  receiveNote: string;
}

function ReceiveTransferPage() {
  const router = useRouter();
  const { id } = router.query;
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchTransfer = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setLoading(true);
    try {
      const data = await stockTransferService.getTransfer(id);
      setTransfer(data);
      setLines(
        data.products.map((p) => ({
          productId: typeof p.productId === 'object' ? String(p.productId._id) : String(p.productId),
          productName: p.productId?.name ?? '',
          barcode: p.productId?.barcode ?? '',
          sentQty: p.sentQty,
          // Prefilled, so confirming a clean delivery is one click.
          receivedQty: String(p.sentQty),
          receiveNote: '',
        })),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load the transfer'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTransfer();
  }, [fetchTransfer]);

  const update = (index: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const totals = useMemo(() => {
    let sent = 0;
    let received = 0;
    let differingLines = 0;
    let overReceived = false;
    for (const line of lines) {
      const qty = Number(line.receivedQty || 0);
      sent += line.sentQty;
      received += qty;
      if (qty !== line.sentQty) differingLines += 1;
      if (qty > line.sentQty) overReceived = true;
    }
    return { sent, received, differingLines, shortfall: sent - received, overReceived };
  }, [lines]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || typeof id !== 'string') return;

    if (lines.some((l) => l.receivedQty === '' || Number.isNaN(Number(l.receivedQty)))) {
      toast.error('Enter a received quantity for every line — use 0 if nothing arrived');
      return;
    }
    if (lines.some((l) => !Number.isInteger(Number(l.receivedQty)) || Number(l.receivedQty) < 0)) {
      toast.error('Received quantities must be whole pieces, zero or more');
      return;
    }
    if (totals.overReceived) {
      // The API refuses this too — receiving more than was sent would create stock from nothing.
      toast.error(
        'You cannot receive more than was sent. If more pieces genuinely arrived, correct it with a stock count instead.',
      );
      return;
    }

    if (totals.shortfall > 0) {
      const confirmed = window.confirm(
        `${totals.differingLines} line(s) differ from what was sent, ${totals.shortfall} piece(s) short in total.\n\n` +
          'Only what you confirm will be added to this warehouse. The shortfall stays in transit and ' +
          'is flagged for an admin to write off or return to the source.\n\nSubmit anyway?',
      );
      if (!confirmed) return;
    }

    setSubmitting(true);
    try {
      await stockTransferService.receiveTransfer(
        id,
        lines.map((l) => ({
          productId: l.productId,
          receivedQty: Number(l.receivedQty),
          ...(l.receiveNote.trim() ? { receiveNote: l.receiveNote.trim() } : {}),
        })),
      );
      toast.success(
        totals.shortfall > 0
          ? 'Received with a shortfall — flagged for admin review'
          : 'Received in full — transfer completed',
      );
      router.push(`/warehouse/transfers/${id}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to confirm receipt'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!transfer) {
    return (
      <Layout>
        <div className={formStyles.container}>
          <p>Transfer not found.</p>
        </div>
      </Layout>
    );
  }

  if (transfer.status !== 'approved') {
    return (
      <Layout>
        <div className={formStyles.container}>
          <div className={formStyles.header}>
            <h1>Confirm Receipt</h1>
            <button
              className={formStyles.backButton}
              onClick={() => router.push(`/warehouse/transfers/${transfer._id}`)}
            >
              ← Back
            </button>
          </div>
          <div className={reportStyles.lowStockCallout}>
            This transfer is <strong>{transfer.status}</strong>, so it cannot be received. Only a
            transfer that has been approved and is in transit can be confirmed.
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={formStyles.container}>
        <div className={formStyles.header}>
          <h1>
            Confirm Receipt — Transfer #
            {transfer.documentNo ? String(transfer.documentNo).padStart(5, '0') : ''}
          </h1>
          <button className={formStyles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

        <WarehouseModuleNav active="transfers" />

        <form className={formStyles.form} onSubmit={handleSubmit}>
          <div className={formStyles.formGroup}>
            <span className={formStyles.hint}>
              From <strong>{transfer.fromWarehouseId?.name ?? '—'}</strong> to{' '}
              <strong>{transfer.toWarehouseId?.name ?? '—'}</strong>. Approved by{' '}
              {transfer.approvedBy ? employeeDisplayLabel(transfer.approvedBy) : '—'}
              {transfer.approvedAt
                ? ` on ${format(new Date(transfer.approvedAt), 'MMM dd, yyyy')}`
                : ''}
              .
            </span>
            {transfer.notes && (
              <span className={formStyles.hint}>Note from the sender: {transfer.notes}</span>
            )}
          </div>

          {/* Hand-rolled grid: the shared Table is read-only and loses input focus on its own
              sort/paginate re-renders. */}
          <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table
              style={{
                width: '100%',
                minWidth: 720,
                borderCollapse: 'collapse',
                fontSize: '0.875rem',
              }}
            >
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={th}>Product</th>
                  <th style={{ ...th, width: 120 }}>Barcode</th>
                  <th style={{ ...th, width: 90, textAlign: 'right' }}>Sent</th>
                  <th style={{ ...th, width: 130 }}>Received *</th>
                  <th style={{ ...th, width: 110, textAlign: 'right' }}>Difference</th>
                  <th style={{ ...th, width: 200 }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const qty = Number(line.receivedQty || 0);
                  const diff = line.sentQty - qty;
                  const over = qty > line.sentQty;

                  return (
                    <tr key={line.productId}>
                      <td style={td}>{line.productName}</td>
                      <td style={td}>{line.barcode}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{formatPieces(line.sentQty)}</td>
                      <td style={td}>
                        <input
                          type="number"
                          min={0}
                          max={line.sentQty}
                          step={1}
                          className={formStyles.input}
                          style={{ margin: 0, ...(over ? { borderColor: '#dc2626' } : {}) }}
                          value={line.receivedQty}
                          onChange={(e) => update(idx, { receivedQty: e.target.value })}
                        />
                      </td>
                      <td
                        style={{
                          ...td,
                          textAlign: 'right',
                          fontWeight: diff !== 0 ? 700 : 400,
                          color: over ? '#dc2626' : diff > 0 ? '#b91c1c' : '#6b7280',
                        }}
                      >
                        {over ? `+${qty - line.sentQty}` : diff === 0 ? '—' : `-${diff}`}
                      </td>
                      <td style={td}>
                        <input
                          type="text"
                          className={formStyles.input}
                          style={{ margin: 0 }}
                          placeholder={diff !== 0 ? 'Why the difference?' : 'Optional'}
                          value={line.receiveNote}
                          onChange={(e) => update(idx, { receiveNote: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f9fafb' }}>
                  <td colSpan={2} style={{ ...td, fontWeight: 600 }}>
                    Total
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                    {formatPieces(totals.sent)}
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{formatPieces(totals.received)}</td>
                  <td
                    style={{
                      ...td,
                      textAlign: 'right',
                      fontWeight: 700,
                      color: totals.shortfall > 0 ? '#b91c1c' : '#6b7280',
                    }}
                  >
                    {totals.shortfall === 0 ? '—' : `-${totals.shortfall}`}
                  </td>
                  <td style={td} />
                </tr>
              </tfoot>
            </table>
          </div>

          {totals.overReceived && (
            <p className={formStyles.errorText}>
              A received quantity is higher than what was sent. That would create stock out of
              nothing — correct a genuine surplus with a stock count at this warehouse instead.
            </p>
          )}

          {!totals.overReceived && totals.shortfall > 0 && (
            <div className={reportStyles.lowStockCallout}>
              <strong>
                {totals.differingLines} line(s) differ from what was sent — {totals.shortfall}{' '}
                piece(s) short.
              </strong>{' '}
              Submitting will add only what you confirmed to this warehouse. The shortfall stays in
              transit at the sending warehouse and is flagged for an admin to write off or return.
            </div>
          )}

          <div className={formStyles.formActions}>
            <button
              type="button"
              className={formStyles.cancelButton}
              onClick={() => router.push(`/warehouse/transfers/${transfer._id}`)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={formStyles.submitButton}
              disabled={submitting || totals.overReceived}
            >
              {submitting ? 'Confirming…' : 'Confirm receipt'}
            </button>
          </div>
        </form>
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

export default function ReceiveTransferPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <ReceiveTransferPage />
    </ProtectedRoute>
  );
}
