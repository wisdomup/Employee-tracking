import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import StatusBadge from '../../../../components/UI/StatusBadge';
import ReasonModal from '../../../../components/Warehouse/ReasonModal';
import WarehouseModuleNav from '../../../../components/Warehouse/WarehouseModuleNav';
import {
  stockCountService,
  StockCount,
  STOCK_COUNT_STATUS_LABELS,
} from '../../../../services/stockCountService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { formatPieces } from '../../../../utils/formatCurrency';
import { can } from '../../../../utils/permissions';
import { useAuth } from '../../../../contexts/AuthContext';
import formStyles from '../../../../styles/FormPage.module.scss';
import detailStyles from '../../../../styles/DetailPage.module.scss';
import reportStyles from '../../../../styles/StockReports.module.scss';

/**
 * The count sheet itself. While it is a draft the counted columns are editable; once submitted the
 * page becomes a read-only variance report with the approve / reject actions.
 *
 * Hand-rolled grid rather than the shared `Table`, for the same reason as the other editable sheets:
 * `GlobalDataTable` is read-only and re-renders cells on its own sort/paginate state, which makes
 * inputs inside it lose focus and typed values.
 */
interface DraftLine {
  productId: string;
  productName: string;
  barcode: string;
  systemSellable: number;
  systemDamaged: number;
  countedSellable: string;
  countedDamaged: string;
  note: string;
}

type ModalKind = 'reject' | 'cancel' | null;

function StockCountDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const [count, setCount] = useState<StockCount | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);

  const fetchCount = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    setLoading(true);
    try {
      const data = await stockCountService.getCount(id);
      setCount(data);
      setLines(
        data.lines.map((line) => ({
          productId:
            typeof line.productId === 'object' ? String(line.productId._id) : String(line.productId),
          productName: line.productId?.name ?? '',
          barcode: line.productId?.barcode ?? '',
          systemSellable: line.systemSellable,
          systemDamaged: line.systemDamaged,
          countedSellable: String(line.countedSellable),
          countedDamaged: String(line.countedDamaged),
          note: line.note ?? '',
        })),
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to load the stock count'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  const update = (productId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  };

  const visibleLines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((l) => `${l.productName} ${l.barcode}`.toLowerCase().includes(needle));
  }, [lines, search]);

  const totals = useMemo(() => {
    let diffSellable = 0;
    let diffDamaged = 0;
    let differingLines = 0;
    for (const line of lines) {
      const ds = Number(line.countedSellable || 0) - line.systemSellable;
      const dd = Number(line.countedDamaged || 0) - line.systemDamaged;
      diffSellable += ds;
      diffDamaged += dd;
      if (ds !== 0 || dd !== 0) differingLines += 1;
    }
    return { diffSellable, diffDamaged, differingLines };
  }, [lines]);

  const isDraft = count?.status === 'draft';
  const canApprove = can(user?.role, 'stock-count:approve') && count?.status === 'submitted';
  const canCancel = count ? ['draft', 'submitted'].includes(count.status) : false;

  const handleSave = async () => {
    if (!id || typeof id !== 'string') return;
    if (lines.some((l) => l.countedSellable === '' || l.countedDamaged === '')) {
      toast.error('Enter a counted figure on every row — use 0 where there is none');
      return;
    }
    if (
      lines.some(
        (l) =>
          !Number.isInteger(Number(l.countedSellable)) ||
          !Number.isInteger(Number(l.countedDamaged)) ||
          Number(l.countedSellable) < 0 ||
          Number(l.countedDamaged) < 0,
      )
    ) {
      toast.error('Counted figures must be whole pieces, zero or more');
      return;
    }

    setBusy(true);
    try {
      await stockCountService.saveCount(
        id,
        lines.map((l) => ({
          productId: l.productId,
          countedSellable: Number(l.countedSellable),
          countedDamaged: Number(l.countedDamaged),
          ...(l.note.trim() ? { note: l.note.trim() } : {}),
        })),
      );
      toast.success('Count saved');
      fetchCount();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to save the count'));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!id || typeof id !== 'string') return;
    if (
      !window.confirm(
        `Submit this count for approval?\n\n${totals.differingLines} product(s) differ from the system figure. Nothing is corrected until an admin approves it.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      // Save first so nothing typed is lost, then submit.
      await stockCountService.saveCount(
        id,
        lines.map((l) => ({
          productId: l.productId,
          countedSellable: Number(l.countedSellable || 0),
          countedDamaged: Number(l.countedDamaged || 0),
          ...(l.note.trim() ? { note: l.note.trim() } : {}),
        })),
      );
      await stockCountService.submitCount(id);
      toast.success('Submitted for approval');
      fetchCount();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to submit the count'));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!id || typeof id !== 'string') return;
    if (
      !window.confirm(
        'Approve this count? The difference the counter found will be applied to current stock. Movements that happened since the sheet was submitted are kept.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { drift } = await stockCountService.approveCount(id);
      if (drift.length > 0) {
        toast.info(
          `Approved. Note: ${drift.length} figure(s) had already moved since the sheet was submitted — the counted difference was applied on top of the current stock.`,
          { autoClose: 8000 },
        );
      } else {
        toast.success('Approved — stock corrected');
      }
      fetchCount();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to approve the count'));
    } finally {
      setBusy(false);
    }
  };

  const handleReason = async (reason: string) => {
    if (!id || typeof id !== 'string' || !modal) return;
    setBusy(true);
    try {
      if (modal === 'reject') {
        await stockCountService.rejectCount(id, reason);
        toast.success('Rejected — no stock changed');
      } else {
        await stockCountService.cancelCount(id, reason);
        toast.success('Cancelled');
      }
      setModal(null);
      fetchCount();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update the count'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!count) {
    return (
      <Layout>
        <div className={formStyles.container}>
          <p>Stock count not found.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={formStyles.container}>
        <div className={formStyles.header}>
          <h1>
            Stock Count #{count.documentNo ? String(count.documentNo).padStart(5, '0') : '—'} —{' '}
            {count.warehouseId?.name ?? ''}
          </h1>
          <button className={formStyles.backButton} onClick={() => router.push('/warehouse/stock-count')}>
            ← Back
          </button>
        </div>

        <WarehouseModuleNav active="stock-count" />

        <div className={detailStyles.section}>
          <div className={detailStyles.infoGrid}>
            <div className={detailStyles.infoItem}>
              <span className={detailStyles.label}>Month</span>
              <span className={detailStyles.value}>{count.periodMonth}</span>
            </div>
            <div className={detailStyles.infoItem}>
              <span className={detailStyles.label}>Status</span>
              <span className={detailStyles.value}>
                <StatusBadge status={count.status === 'submitted' ? 'pending' : count.status} />{' '}
                {STOCK_COUNT_STATUS_LABELS[count.status]}
              </span>
            </div>
            <div className={detailStyles.infoItem}>
              <span className={detailStyles.label}>Started by</span>
              <span className={detailStyles.value}>
                {count.createdBy ? employeeDisplayLabel(count.createdBy) : '—'}
              </span>
            </div>
            {count.submittedBy && (
              <div className={detailStyles.infoItem}>
                <span className={detailStyles.label}>Submitted by</span>
                <span className={detailStyles.value}>
                  {employeeDisplayLabel(count.submittedBy)}
                  {count.submittedAt
                    ? ` — ${format(new Date(count.submittedAt), 'MMM dd, yyyy HH:mm')}`
                    : ''}
                </span>
              </div>
            )}
            {count.approvedBy && (
              <div className={detailStyles.infoItem}>
                <span className={detailStyles.label}>Approved by</span>
                <span className={detailStyles.value}>
                  {employeeDisplayLabel(count.approvedBy)}
                  {count.approvedAt
                    ? ` — ${format(new Date(count.approvedAt), 'MMM dd, yyyy HH:mm')}`
                    : ''}
                </span>
              </div>
            )}
            {count.rejectionReason && (
              <div className={detailStyles.infoItem}>
                <span className={detailStyles.label}>Rejection reason</span>
                <span className={detailStyles.value}>{count.rejectionReason}</span>
              </div>
            )}
            {count.cancelReason && (
              <div className={detailStyles.infoItem}>
                <span className={detailStyles.label}>Cancel reason</span>
                <span className={detailStyles.value}>{count.cancelReason}</span>
              </div>
            )}
          </div>
        </div>

        {count.status === 'submitted' && (
          <div className={reportStyles.lowStockCallout}>
            The system figures below are the ones the counter saw when they submitted. Approving applies
            the <strong>difference</strong> they found to current stock — so anything sold, transferred
            or received since then is preserved rather than overwritten.
          </div>
        )}

        {isDraft && lines.length > 12 && (
          <div className={formStyles.formGroup}>
            <label htmlFor="search">Find a product</label>
            <input
              id="search"
              className={formStyles.input}
              placeholder="Name or barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className={formStyles.hint}>
              Filtering only changes what is shown — anything you have already typed is kept.
            </span>
          </div>
        )}

        <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
          <table
            style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: '0.875rem' }}
          >
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={th}>Product</th>
                <th style={{ ...th, width: 110 }}>Barcode</th>
                <th style={{ ...th, width: 90, textAlign: 'right' }}>System sellable</th>
                <th style={{ ...th, width: 120 }}>Counted sellable</th>
                <th style={{ ...th, width: 90, textAlign: 'right' }}>Diff</th>
                <th style={{ ...th, width: 90, textAlign: 'right' }}>System damaged</th>
                <th style={{ ...th, width: 120 }}>Counted damaged</th>
                <th style={{ ...th, width: 90, textAlign: 'right' }}>Diff</th>
                <th style={{ ...th, width: 180 }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((line) => {
                const ds = Number(line.countedSellable || 0) - line.systemSellable;
                const dd = Number(line.countedDamaged || 0) - line.systemDamaged;
                return (
                  <tr key={line.productId}>
                    <td style={td}>{line.productName}</td>
                    <td style={td}>{line.barcode}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{formatPieces(line.systemSellable)}</td>
                    <td style={td}>
                      {isDraft ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className={formStyles.input}
                          style={{ margin: 0 }}
                          value={line.countedSellable}
                          onChange={(e) => update(line.productId, { countedSellable: e.target.value })}
                        />
                      ) : (
                        formatPieces(Number(line.countedSellable))
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', ...diffStyle(ds) }}>
                      {ds === 0 ? '—' : ds > 0 ? `+${ds}` : String(ds)}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{formatPieces(line.systemDamaged)}</td>
                    <td style={td}>
                      {isDraft ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className={formStyles.input}
                          style={{ margin: 0 }}
                          value={line.countedDamaged}
                          onChange={(e) => update(line.productId, { countedDamaged: e.target.value })}
                        />
                      ) : (
                        formatPieces(Number(line.countedDamaged))
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', ...diffStyle(dd) }}>
                      {dd === 0 ? '—' : dd > 0 ? `+${dd}` : String(dd)}
                    </td>
                    <td style={td}>
                      {isDraft ? (
                        <input
                          type="text"
                          className={formStyles.input}
                          style={{ margin: 0 }}
                          placeholder={ds !== 0 || dd !== 0 ? 'Why the difference?' : 'Optional'}
                          value={line.note}
                          onChange={(e) => update(line.productId, { note: e.target.value })}
                        />
                      ) : (
                        line.note || '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleLines.length === 0 && search && (
          <p className={formStyles.hint}>No product matches “{search}”.</p>
        )}

        <div className={reportStyles.plGrid}>
          <div className={reportStyles.plCard}>
            <span>Products differing</span>
            <strong>{totals.differingLines}</strong>
          </div>
          <div
            className={`${reportStyles.plCard} ${totals.diffSellable < 0 ? reportStyles.plCardLoss : totals.diffSellable > 0 ? reportStyles.plCardProfit : ''}`}
          >
            <span>Net sellable difference</span>
            <strong>
              {totals.diffSellable > 0 ? `+${totals.diffSellable}` : totals.diffSellable}
            </strong>
          </div>
          <div className={reportStyles.plCard}>
            <span>Net damaged difference</span>
            <strong>{totals.diffDamaged > 0 ? `+${totals.diffDamaged}` : totals.diffDamaged}</strong>
          </div>
        </div>

        <div className={formStyles.formActions}>
          {canCancel && (
            <button
              type="button"
              className={formStyles.cancelButton}
              onClick={() => setModal('cancel')}
              disabled={busy}
            >
              Cancel count
            </button>
          )}
          {isDraft && (
            <>
              <button
                type="button"
                className={formStyles.cancelButton}
                onClick={handleSave}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save progress'}
              </button>
              <button
                type="button"
                className={formStyles.submitButton}
                onClick={handleSubmit}
                disabled={busy}
              >
                Submit for approval
              </button>
            </>
          )}
          {canApprove && (
            <>
              <button
                type="button"
                className={formStyles.cancelButton}
                onClick={() => setModal('reject')}
                disabled={busy}
              >
                Reject
              </button>
              <button
                type="button"
                className={formStyles.submitButton}
                onClick={handleApprove}
                disabled={busy}
              >
                {busy ? 'Applying…' : 'Approve and correct stock'}
              </button>
            </>
          )}
        </div>
      </div>

      <ReasonModal
        open={modal !== null}
        title={modal === 'reject' ? 'Reject this count' : 'Cancel this count'}
        description={
          modal === 'reject'
            ? 'Rejecting changes no stock. The sheet is kept with your reason so it can be recounted.'
            : 'The sheet is kept for the record with your reason. No stock changes.'
        }
        label={modal === 'reject' ? 'Rejection reason' : 'Cancel reason'}
        confirmLabel={modal === 'reject' ? 'Reject count' : 'Cancel count'}
        busy={busy}
        onClose={() => {
          if (!busy) setModal(null);
        }}
        onConfirm={handleReason}
      />
    </Layout>
  );
}

function diffStyle(diff: number): React.CSSProperties {
  if (diff === 0) return { color: '#6b7280' };
  return { color: diff > 0 ? '#047857' : '#b91c1c', fontWeight: 700 };
}

const th: React.CSSProperties = {
  padding: '0.5rem',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  borderBottom: '1px solid #e5e7eb',
};

const td: React.CSSProperties = { padding: '0.5rem', borderBottom: '1px solid #f3f4f6' };

export default function StockCountDetailPageWrapper() {
  return (
    <ProtectedRoute permission="stock-count:view">
      <StockCountDetailPage />
    </ProtectedRoute>
  );
}
