import React, { useState } from 'react';
import { toast } from 'react-toastify';
import {
  targetService,
  PerformanceRow,
  formatPeriodMonth,
} from '../../services/analyticsService';
import { employeeDisplayLabel } from '../../utils/employeeDisplayLabel';

interface TargetModalProps {
  row: PerformanceRow;
  periodMonth: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Empty string means "no target for this metric"; 0 is a real (if odd) target. */
function toNumberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

const TargetModal: React.FC<TargetModalProps> = ({ row, periodMonth, onClose, onSaved }) => {
  const [salesAmount, setSalesAmount] = useState(
    row.targetSalesAmount != null ? String(row.targetSalesAmount) : '',
  );
  const [orderCount, setOrderCount] = useState(
    row.targetOrderCount != null ? String(row.targetOrderCount) : '',
  );
  const [visitCount, setVisitCount] = useState(
    row.targetVisitCount != null ? String(row.targetVisitCount) : '',
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const payload = {
      employeeId: row.employeeId,
      periodMonth,
      salesAmount: toNumberOrUndefined(salesAmount),
      orderCount: toNumberOrUndefined(orderCount),
      visitCount: toNumberOrUndefined(visitCount),
    };
    if (
      payload.salesAmount === undefined &&
      payload.orderCount === undefined &&
      payload.visitCount === undefined
    ) {
      toast.error('Set at least one target value.');
      return;
    }
    if ([payload.salesAmount, payload.orderCount, payload.visitCount].some((v) => v != null && v < 0)) {
      toast.error('Targets cannot be negative.');
      return;
    }
    setSaving(true);
    try {
      await targetService.saveTarget(payload);
      toast.success('Target saved');
      onSaved();
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      toast.error(message || 'Failed to save target');
    } finally {
      setSaving(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.625rem',
    border: '1px solid #d1d5db',
    borderRadius: '0.375rem',
    fontSize: '0.9375rem',
  };
  const label: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8125rem',
    color: '#374151',
    marginBottom: '0.25rem',
    fontWeight: 500,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set monthly target"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          width: '100%',
          maxWidth: 420,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Monthly Target</h2>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 1.25rem' }}>
          {employeeDisplayLabel(row) || row.username} · {formatPeriodMonth(periodMonth)}
        </p>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label style={label} htmlFor="target-sales">
              Sales amount
            </label>
            <input
              id="target-sales"
              type="number"
              min={0}
              step="any"
              value={salesAmount}
              onChange={(e) => setSalesAmount(e.target.value)}
              placeholder="e.g. 500000"
              style={field}
            />
            <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
              Measured against delivered order value.
            </span>
          </div>

          <div>
            <label style={label} htmlFor="target-orders">
              Order count
            </label>
            <input
              id="target-orders"
              type="number"
              min={0}
              step={1}
              value={orderCount}
              onChange={(e) => setOrderCount(e.target.value)}
              placeholder="e.g. 40"
              style={field}
            />
          </div>

          <div>
            <label style={label} htmlFor="target-visits">
              Visits completed
            </label>
            <input
              id="target-visits"
              type="number"
              min={0}
              step={1}
              value={visitCount}
              onChange={(e) => setVisitCount(e.target.value)}
              placeholder="e.g. 120"
              style={field}
            />
            <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
              Counts visits that were checked in and checked out.
            </span>
          </div>
        </div>

        <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.75rem' }}>
          Leave a field blank to set no target for that metric.
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: 'var(--admin-primary, #0ea5e9)',
              color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save target'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TargetModal;
