import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import StatusBadge from '../../../../components/UI/StatusBadge';
import SearchableSelect from '../../../../components/UI/SearchableSelect';
import ReasonModal from '../../../../components/Warehouse/ReasonModal';
import {
  stockTransferService,
  StockTransfer,
  TransferLine,
  TRANSFER_STATUS_LABELS,
} from '../../../../services/stockTransferService';
import DataExportButton from '../../../../components/UI/DataExportButton';
import type { TableExportColumn } from '../../../../utils/tableExport';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { formatPieces } from '../../../../utils/formatCurrency';
import { printWarehouseSlip, transferSlipDoc } from '../../../../utils/warehouseSlipPdf';
import { can } from '../../../../utils/permissions';
import { useAuth } from '../../../../contexts/AuthContext';
import styles from '../../../../styles/DetailPage.module.scss';
import modalStyles from '../../../../styles/Modal.module.scss';

/** Mirrors the on-screen Products table, including the sent-vs-received difference. */
const transferExportColumns: TableExportColumn[] = [
  {
    key: 'product',
    title: 'Product',
    exportValue: (row) => (row as TransferLine).productId?.name ?? '',
  },
  {
    key: 'barcode',
    title: 'Barcode',
    exportValue: (row) => (row as TransferLine).productId?.barcode ?? '',
  },
  {
    key: 'sentQty',
    title: 'Sent',
    exportValue: (row) => formatPieces((row as TransferLine).sentQty),
  },
  {
    key: 'receivedQty',
    title: 'Received',
    exportValue: (row) => {
      const received = (row as TransferLine).receivedQty;
      return received === undefined ? '' : formatPieces(received);
    },
  },
  {
    key: 'difference',
    title: 'Difference',
    exportValue: (row) => {
      const line = row as TransferLine;
      if (line.receivedQty === undefined) return '';
      const diff = line.sentQty - line.receivedQty;
      return diff === 0 ? '' : `-${diff}`;
    },
  },
  {
    key: 'receiveNote',
    title: 'Note',
    exportValue: (row) => (row as TransferLine).receiveNote || '',
  },
];

type ModalKind = 'reject' | 'cancel' | null;

function TransferDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [transfer, setTransfer] = useState<StockTransfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState<'write_off' | 'return_to_source'>('write_off');
  const [resolveReason, setResolveReason] = useState('');

  const fetchTransfer = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setLoading(true);
    try {
      setTransfer(await stockTransferService.getTransfer(id));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load the transfer'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTransfer();
  }, [fetchTransfer]);

  const totals = useMemo(() => {
    if (!transfer) return { sent: 0, received: 0, shortfall: 0, anyReceived: false };
    const sent = transfer.products.reduce((sum, p) => sum + p.sentQty, 0);
    const received = transfer.products.reduce((sum, p) => sum + (p.receivedQty ?? 0), 0);
    return {
      sent,
      received,
      shortfall: sent - received,
      anyReceived: transfer.products.some((p) => p.receivedQty !== undefined),
    };
  }, [transfer]);

  const handleApprove = async () => {
    if (!transfer) return;
    if (
      !window.confirm(
        `Approve this transfer? ${formatPieces(totals.sent)} piece(s) leave ${transfer.fromWarehouseId?.name ?? 'the source'} immediately and stay in transit until the destination confirms.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await stockTransferService.approveTransfer(transfer._id);
      toast.success('Approved — the stock is now in transit');
      fetchTransfer();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to approve the transfer'));
    } finally {
      setBusy(false);
    }
  };

  const handleReason = async (reason: string) => {
    if (!transfer || !modal) return;
    setBusy(true);
    try {
      if (modal === 'reject') {
        await stockTransferService.rejectTransfer(transfer._id, reason);
        toast.success('Rejected — no stock moved');
      } else {
        await stockTransferService.cancelTransfer(transfer._id, reason);
        toast.success('Cancelled and stock reversed');
      }
      setModal(null);
      fetchTransfer();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update the transfer'));
    } finally {
      setBusy(false);
    }
  };

  const handleResolve = async () => {
    if (!transfer) return;
    if (resolveReason.trim().length < 3) {
      toast.error('Give a reason of at least 3 characters — it goes on the record');
      return;
    }
    setBusy(true);
    try {
      await stockTransferService.resolveMismatch(transfer._id, resolution, resolveReason.trim());
      toast.success(
        resolution === 'write_off'
          ? 'Shortfall written off — the stock is gone from the books'
          : 'Shortfall returned to the sending warehouse',
      );
      setResolveOpen(false);
      setResolveReason('');
      fetchTransfer();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to resolve the mismatch'));
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = async () => {
    if (!id || typeof id !== 'string') return;
    setPrintBusy(true);
    try {
      const slip = await stockTransferService.getTransferSlip(id);
      await printWarehouseSlip(
        transferSlipDoc({
          documentNo: slip.documentNo,
          transferDateLabel: slip.transferDate
            ? format(new Date(slip.transferDate), 'MMM dd, yyyy')
            : '—',
          status: slip.status,
          statusLabel: TRANSFER_STATUS_LABELS[slip.status as never] ?? slip.status,
          fromWarehouseName: slip.fromWarehouseName,
          toWarehouseName: slip.toWarehouseName,
          preparedBy: slip.preparedBy,
          approvedByName: slip.approvedByName,
          receivedByName: slip.receivedByName,
          notes: slip.notes,
          cancelReason: slip.cancelReason,
          rejectionReason: slip.rejectionReason,
          mismatchResolutionNote: slip.mismatchResolutionNote,
          totalSent: slip.totalSent,
          totalReceived: slip.totalReceived,
          lines: slip.lines,
        }),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to generate the slip'));
    } finally {
      setPrintBusy(false);
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
        <div className={styles.container}>
          <p>Transfer not found.</p>
        </div>
      </Layout>
    );
  }

  const myWarehouseId = user?.role === 'admin' ? null : user?.warehouseId ?? null;
  const canApprove = can(user?.role, 'transfers:approve') && transfer.status === 'pending';
  const canReceive =
    can(user?.role, 'transfers:receive') &&
    transfer.status === 'approved' &&
    (user?.role === 'admin' || String(transfer.toWarehouseId?._id) === myWarehouseId);
  const canResolve = can(user?.role, 'transfers:resolve-mismatch') && transfer.status === 'mismatch';
  const canCancel =
    can(user?.role, 'transfers:cancel') &&
    ['pending', 'approved', 'completed', 'mismatch'].includes(transfer.status);

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            Transfer #{transfer.documentNo ? String(transfer.documentNo).padStart(5, '0') : '—'}
          </h1>
          <div className={styles.headerActions}>
            {canApprove && (
              <button className={styles.approveButton} onClick={handleApprove} disabled={busy}>
                Approve
              </button>
            )}
            {canApprove && (
              <button className={styles.editButton} onClick={() => setModal('reject')} disabled={busy}>
                Reject
              </button>
            )}
            {canReceive && (
              <button
                className={styles.approveButton}
                onClick={() => router.push(`/warehouse/transfers/${transfer._id}/receive`)}
              >
                Confirm receipt
              </button>
            )}
            {canResolve && (
              <button className={styles.approveButton} onClick={() => setResolveOpen(true)} disabled={busy}>
                Resolve shortfall
              </button>
            )}
            {canCancel && (
              <button className={styles.editButton} onClick={() => setModal('cancel')} disabled={busy}>
                Cancel transfer
              </button>
            )}
            <button className={styles.editButton} onClick={handlePrint} disabled={printBusy}>
              {printBusy ? 'Preparing…' : 'Print slip'}
            </button>
            <button
              className={styles.backButton}
              onClick={() => router.push('/warehouse/transfers')}
            >
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Transfer</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Raised</span>
                <span className={styles.value}>
                  {format(new Date(transfer.createdAt), 'MMM dd, yyyy HH:mm')}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>From</span>
                <span className={styles.value}>{transfer.fromWarehouseId?.name ?? '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>To</span>
                <span className={styles.value}>{transfer.toWarehouseId?.name ?? '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status</span>
                <span className={styles.value}>
                  <StatusBadge
                    status={transfer.status === 'approved' ? 'in_transit' : transfer.status}
                  />
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Total sent</span>
                <span className={styles.value}>{formatPieces(totals.sent)}</span>
              </div>
              {totals.anyReceived && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Total received</span>
                  <span className={styles.value}>{formatPieces(totals.received)}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Raised by</span>
                <span className={styles.value}>
                  {transfer.createdBy ? employeeDisplayLabel(transfer.createdBy) : '—'}
                </span>
              </div>
              {transfer.notes && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Notes</span>
                  <span className={styles.value}>{transfer.notes}</span>
                </div>
              )}
            </div>
          </div>

          {transfer.status === 'pending' && (
            <div className={styles.section}>
              <h2>Waiting for approval</h2>
              <p style={{ margin: 0, color: '#4b5563' }}>
                No stock has moved. On approval, {formatPieces(totals.sent)} piece(s) leave{' '}
                {transfer.fromWarehouseId?.name ?? 'the source'} and sit in transit — not sellable
                anywhere — until {transfer.toWarehouseId?.name ?? 'the destination'} confirms what
                arrived.
              </p>
            </div>
          )}

          {transfer.status === 'approved' && (
            <div className={styles.section}>
              <h2>In transit</h2>
              <p style={{ margin: 0, color: '#4b5563' }}>
                {formatPieces(totals.sent)} piece(s) have left{' '}
                {transfer.fromWarehouseId?.name ?? 'the source'} and are not sellable at either
                warehouse until {transfer.toWarehouseId?.name ?? 'the destination'} confirms receipt.
              </p>
            </div>
          )}

          {transfer.status === 'mismatch' && (
            <div className={styles.section}>
              <h2>Quantity mismatch</h2>
              <p style={{ margin: 0, color: '#4b5563' }}>
                {formatPieces(totals.shortfall)} piece(s) fewer arrived than were sent. Only what
                arrived was added to {transfer.toWarehouseId?.name ?? 'the destination'}; the
                shortfall is still held in transit at{' '}
                {transfer.fromWarehouseId?.name ?? 'the source'} and needs an admin to write it off or
                return it.
              </p>
            </div>
          )}

          {(transfer.approvedBy ||
            transfer.receivedBy ||
            transfer.rejectionReason ||
            transfer.cancelReason ||
            transfer.mismatchResolution) && (
            <div className={styles.section}>
              <h2>History</h2>
              <div className={styles.infoGrid}>
                {transfer.approvedBy && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Approved by</span>
                    <span className={styles.value}>
                      {employeeDisplayLabel(transfer.approvedBy)}
                      {transfer.approvedAt
                        ? ` — ${format(new Date(transfer.approvedAt), 'MMM dd, yyyy HH:mm')}`
                        : ''}
                    </span>
                  </div>
                )}
                {transfer.receivedBy && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Received by</span>
                    <span className={styles.value}>
                      {employeeDisplayLabel(transfer.receivedBy)}
                      {transfer.receivedAt
                        ? ` — ${format(new Date(transfer.receivedAt), 'MMM dd, yyyy HH:mm')}`
                        : ''}
                    </span>
                  </div>
                )}
                {transfer.rejectionReason && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Rejected</span>
                    <span className={styles.value}>{transfer.rejectionReason}</span>
                  </div>
                )}
                {transfer.mismatchResolution && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Shortfall resolved</span>
                    <span className={styles.value}>
                      {transfer.mismatchResolution === 'write_off'
                        ? 'Written off'
                        : 'Returned to the sending warehouse'}
                      {transfer.mismatchResolutionNote
                        ? ` — ${transfer.mismatchResolutionNote}`
                        : ''}
                    </span>
                  </div>
                )}
                {transfer.cancelReason && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Cancelled</span>
                    <span className={styles.value}>{transfer.cancelReason}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={styles.section}>
            <div className={styles.sectionHeadRow}>
              <h2>Products</h2>
              <DataExportButton
                columns={transferExportColumns}
                rows={transfer.products}
                fileName={`stock-transfer-${transfer._id}-products`}
                pdfTitle="Stock Transfer — Products"
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: '0.875rem' }}
              >
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={th}>Product</th>
                    <th style={th}>Barcode</th>
                    <th style={{ ...th, textAlign: 'right' }}>Sent</th>
                    <th style={{ ...th, textAlign: 'right' }}>Received</th>
                    <th style={{ ...th, textAlign: 'right' }}>Difference</th>
                    <th style={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {transfer.products.map((line, idx) => {
                    const received = line.receivedQty;
                    const diff = received === undefined ? null : line.sentQty - received;
                    return (
                      <tr key={idx}>
                        <td style={td}>{line.productId?.name ?? '—'}</td>
                        <td style={td}>{line.productId?.barcode ?? '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{formatPieces(line.sentQty)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {received === undefined ? '—' : formatPieces(received)}
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: 'right',
                            color: diff && diff > 0 ? '#b91c1c' : '#6b7280',
                            fontWeight: diff && diff > 0 ? 700 : 400,
                          }}
                        >
                          {diff === null ? '—' : diff === 0 ? '—' : `-${diff}`}
                        </td>
                        <td style={td}>{line.receiveNote || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <ReasonModal
        open={modal !== null}
        title={modal === 'reject' ? 'Reject this transfer' : 'Cancel this transfer'}
        description={
          modal === 'reject'
            ? 'No stock has moved yet, so rejecting simply closes the request with your reason.'
            : transfer.status === 'completed' || transfer.status === 'mismatch'
              ? 'Cancelling takes the goods back off the destination’s shelf. If they have already been sold, the cancellation will be refused.'
              : 'Any stock already in transit goes back to the sending warehouse.'
        }
        label={modal === 'reject' ? 'Rejection reason' : 'Cancel reason'}
        confirmLabel={modal === 'reject' ? 'Reject transfer' : 'Cancel transfer'}
        busy={busy}
        onClose={() => {
          if (!busy) setModal(null);
        }}
        onConfirm={handleReason}
      />

      {resolveOpen && (
        <div
          className={modalStyles.modalOverlay}
          onClick={() => {
            if (!busy) setResolveOpen(false);
          }}
          role="presentation"
        >
          <div
            className={modalStyles.modalContent}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Resolve shortfall"
          >
            <div className={modalStyles.modalHeader}>
              <h2>Resolve the shortfall</h2>
            </div>
            <p style={{ margin: '0 0 16px', color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>
              {formatPieces(totals.shortfall)} piece(s) never arrived and are still held in transit at{' '}
              {transfer.fromWarehouseId?.name ?? 'the source'}.
            </p>

            <div className={modalStyles.formGroup}>
              <label htmlFor="resolution">What happened to them?</label>
              <SearchableSelect
                id="resolution"
                name="resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value as 'write_off' | 'return_to_source')}
                options={[
                  { value: 'write_off', label: 'Write off — the stock is genuinely lost' },
                  {
                    value: 'return_to_source',
                    label: 'Return to source — they were never actually sent',
                  },
                ]}
              />
            </div>

            <div className={modalStyles.formGroup}>
              <label htmlFor="resolveReason">Reason *</label>
              <textarea
                id="resolveReason"
                rows={3}
                value={resolveReason}
                onChange={(e) => setResolveReason(e.target.value)}
                placeholder="What did you find out?"
                disabled={busy}
              />
            </div>

            <div className={modalStyles.modalActions}>
              <button
                type="button"
                className={modalStyles.cancelButton}
                onClick={() => setResolveOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={modalStyles.submitButton}
                onClick={handleResolve}
                disabled={busy || resolveReason.trim().length < 3}
              >
                {busy ? 'Working…' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      )}
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

export default function TransferDetailPageWrapper() {
  return (
    <ProtectedRoute permission="transfers:view">
      <TransferDetailPage />
    </ProtectedRoute>
  );
}
