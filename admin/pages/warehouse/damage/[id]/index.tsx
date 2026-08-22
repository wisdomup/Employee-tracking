import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import StatusBadge from '../../../../components/UI/StatusBadge';
import ReasonModal from '../../../../components/Warehouse/ReasonModal';
import {
  damageClaimService,
  DamageClaim,
  DAMAGE_SOURCE_LABELS,
} from '../../../../services/damageClaimService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { formatPieces } from '../../../../utils/formatCurrency';
import { printWarehouseSlip, damageSlipDoc } from '../../../../utils/warehouseSlipPdf';
import { can } from '../../../../utils/permissions';
import { useAuth } from '../../../../contexts/AuthContext';
import styles from '../../../../styles/DetailPage.module.scss';

type ModalKind = 'reject' | 'cancel' | null;

function DamageDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [claim, setClaim] = useState<DamageClaim | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);

  const fetchClaim = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setLoading(true);
    try {
      setClaim(await damageClaimService.getRecord(id));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load the entry'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchClaim();
  }, [fetchClaim]);

  const totalPieces = claim?.products.reduce((sum, p) => sum + p.quantity, 0) ?? 0;

  const handleApprove = async () => {
    if (!claim) return;
    if (
      !window.confirm(
        `Approve this entry? ${totalPieces} piece(s) will move from sellable stock into the damaged / claim bucket.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await damageClaimService.approveRecord(claim._id);
      toast.success('Approved — stock moved to the damaged / claim bucket');
      fetchClaim();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to approve the entry'));
    } finally {
      setBusy(false);
    }
  };

  const handleReason = async (reason: string) => {
    if (!claim || !modal) return;
    setBusy(true);
    try {
      if (modal === 'reject') {
        await damageClaimService.rejectRecord(claim._id, reason);
        toast.success('Rejected — nothing changed');
      } else {
        await damageClaimService.cancelRecord(claim._id, reason);
        toast.success('Cancelled — any approved stock movement was reversed');
      }
      setModal(null);
      fetchClaim();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update the entry'));
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = async () => {
    if (!id || typeof id !== 'string') return;
    setPrintBusy(true);
    try {
      const slip = await damageClaimService.getRecordSlip(id);
      await printWarehouseSlip(
        damageSlipDoc({
          documentNo: slip.documentNo,
          entryDateLabel: slip.entryDate ? format(new Date(slip.entryDate), 'MMM dd, yyyy') : '—',
          status: slip.status,
          sourceLabel: DAMAGE_SOURCE_LABELS[slip.source as never] ?? slip.source,
          clientName: slip.clientName,
          warehouseName: slip.warehouseName,
          reason: slip.reason,
          rejectionReason: slip.rejectionReason,
          cancelReason: slip.cancelReason,
          raisedBy: slip.raisedBy,
          approvedByName: slip.approvedByName,
          totalPieces: slip.totalPieces,
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

  if (!claim) {
    return (
      <Layout>
        <div className={styles.container}>
          <p>Entry not found.</p>
        </div>
      </Layout>
    );
  }

  const canApprove = can(user?.role, 'damage:approve') && claim.status === 'pending';
  const canCancel =
    can(user?.role, 'damage:cancel') && ['pending', 'approved'].includes(claim.status);

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            Damage / Claim #{claim.documentNo ? String(claim.documentNo).padStart(5, '0') : '—'}
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
            {canCancel && (
              <button className={styles.editButton} onClick={() => setModal('cancel')} disabled={busy}>
                Cancel entry
              </button>
            )}
            <button className={styles.editButton} onClick={handlePrint} disabled={printBusy}>
              {printBusy ? 'Preparing…' : 'Print slip'}
            </button>
            <button className={styles.backButton} onClick={() => router.push('/warehouse/damage')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Entry</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Date</span>
                <span className={styles.value}>
                  {format(new Date(claim.createdAt), 'MMM dd, yyyy HH:mm')}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Warehouse</span>
                <span className={styles.value}>{claim.warehouseId?.name ?? '—'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Type</span>
                <span className={styles.value}>
                  <StatusBadge status={claim.source} />
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Client</span>
                <span className={styles.value}>
                  {claim.clientName || claim.dealerId?.shopName || claim.dealerId?.name || '—'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Total pieces</span>
                <span className={styles.value}>{formatPieces(totalPieces)}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status</span>
                <span className={styles.value}>
                  <StatusBadge status={claim.status} />
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Reason</span>
                <span className={styles.value}>{claim.reason}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Raised by</span>
                <span className={styles.value}>
                  {claim.createdBy ? employeeDisplayLabel(claim.createdBy) : '—'}
                </span>
              </div>
              {claim.linkedReturnId && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Raised from</span>
                  <span className={styles.value}>
                    A completed damage-type return — the client-facing document lives under Returns.
                  </span>
                </div>
              )}
            </div>
          </div>

          {claim.status === 'pending' && (
            <div className={styles.section}>
              <h2>Waiting for approval</h2>
              <p style={{ margin: 0, color: '#4b5563' }}>
                No stock has moved yet. On approval, {formatPieces(totalPieces)} piece(s) move from
                sellable to the damaged / claim bucket at {claim.warehouseId?.name ?? 'this warehouse'}.
                A rejection changes nothing.
              </p>
            </div>
          )}

          {(claim.status === 'approved' ||
            claim.status === 'rejected' ||
            claim.status === 'cancelled') && (
            <div className={styles.section}>
              <h2>Decision</h2>
              <div className={styles.infoGrid}>
                {claim.approvedBy && (
                  <>
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Approved by</span>
                      <span className={styles.value}>{employeeDisplayLabel(claim.approvedBy)}</span>
                    </div>
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Approved at</span>
                      <span className={styles.value}>
                        {claim.approvedAt
                          ? format(new Date(claim.approvedAt), 'MMM dd, yyyy HH:mm')
                          : '—'}
                      </span>
                    </div>
                  </>
                )}
                {claim.rejectionReason && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Rejection reason</span>
                    <span className={styles.value}>{claim.rejectionReason}</span>
                  </div>
                )}
                {claim.cancelReason && (
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Cancel reason</span>
                    <span className={styles.value}>{claim.cancelReason}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={styles.section}>
            <h2>Products</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={th}>Product</th>
                    <th style={th}>Barcode</th>
                    <th style={{ ...th, textAlign: 'right' }}>Pieces</th>
                  </tr>
                </thead>
                <tbody>
                  {claim.products.map((line, idx) => (
                    <tr key={idx}>
                      <td style={td}>{line.productId?.name ?? '—'}</td>
                      <td style={td}>{line.productId?.barcode ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{formatPieces(line.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <ReasonModal
        open={modal !== null}
        title={modal === 'reject' ? 'Reject this entry' : 'Cancel this entry'}
        description={
          modal === 'reject'
            ? 'Rejecting changes no stock at all. The entry is kept with your reason.'
            : claim.status === 'approved'
              ? 'Cancelling reverses the write-off: the pieces go back into sellable stock.'
              : 'The entry is kept for the record with your reason.'
        }
        label={modal === 'reject' ? 'Rejection reason' : 'Cancel reason'}
        confirmLabel={modal === 'reject' ? 'Reject entry' : 'Cancel entry'}
        busy={busy}
        onClose={() => {
          if (!busy) setModal(null);
        }}
        onConfirm={handleReason}
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

export default function DamageDetailPageWrapper() {
  return (
    <ProtectedRoute permission="damage:view">
      <DamageDetailPage />
    </ProtectedRoute>
  );
}
