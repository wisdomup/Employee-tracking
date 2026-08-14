import React, { useEffect, useMemo, useState } from 'react';
import { ReportRow } from '../../services/collectionService';
import { formatRs } from '../../utils/formatCurrency';

/**
 * Spec §7 — an admin rectifying a rider's entry, with no approval step.
 *
 * A correction REALLOCATES between the three modes; the total is fixed because it is the order's
 * own amount. "The rider logged Rs. 5,000 cash but Rs. 2,000 of it was a bank transfer" is the
 * real use case. Changing the total is not a correction — that is a void, which is a separate
 * action with a mandatory reason.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const parse = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

interface Props {
  open: boolean;
  row: ReportRow | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (body: { cash: number; online: number; credit: number; reason?: string }) => void | Promise<void>;
}

const CorrectCollectionModal: React.FC<Props> = ({ open, row, busy = false, onClose, onSubmit }) => {
  const [form, setForm] = useState({ cash: '', online: '', credit: '', reason: '' });

  useEffect(() => {
    if (open && row) {
      setForm({
        cash: String(row.cash),
        online: String(row.online),
        credit: String(row.credit),
        reason: '',
      });
    }
  }, [open, row?.collectionId]);

  const cash = parse(form.cash);
  const online = parse(form.online);
  const credit = parse(form.credit);
  const orderAmount = round2(row?.amount ?? 0);

  const { remaining, balanced, changed } = useMemo(() => {
    const left = round2(orderAmount - round2(cash + online + credit));
    return {
      remaining: left,
      balanced: Math.abs(left) < 0.005,
      changed: row ? cash !== row.cash || online !== row.online || credit !== row.credit : false,
    };
  }, [cash, online, credit, orderAmount, row]);

  if (!open || !row) return null;

  const canSave = balanced && changed && !busy;

  return (
    <div
      role="presentation"
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="correct-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 480,
          width: '100%',
          maxHeight: '92vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 id="correct-title" style={{ margin: 0, fontSize: '1.125rem', color: '#111827' }}>
            Correct collection entry
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            {row.shop} · {row.rider}
            {row.invoiceNumber ? ` · #${row.invoiceNumber}` : ''}
          </p>
        </div>

        <div style={{ padding: '1.25rem 1.5rem' }}>
          <p
            style={{
              margin: '0 0 1rem',
              padding: '0.625rem 0.75rem',
              borderRadius: 8,
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              fontSize: '0.8125rem',
              color: '#374151',
            }}
          >
            Move money between the three modes. The total stays at{' '}
            <strong>{formatRs(orderAmount)}</strong> — it is the order&apos;s amount. To reverse the
            delivery entirely, use <strong>Void</strong> instead.
          </p>

          {(['cash', 'online', 'credit'] as const).map((key) => (
            <div key={key} style={{ marginBottom: '0.875rem' }}>
              <label
                htmlFor={`correct-${key}`}
                style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
                <span style={{ fontWeight: 400, color: '#9ca3af' }}>
                  {' '}
                  · was {formatRs(row[key])}
                </span>
              </label>
              <input
                id={`correct-${key}`}
                type="text"
                inputMode="decimal"
                value={form[key]}
                disabled={busy}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  fontSize: '1rem',
                }}
              />
            </div>
          ))}

          <div
            style={{
              padding: '0.625rem 0.875rem',
              borderRadius: 8,
              background: balanced ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${balanced ? '#a7f3d0' : '#fecaca'}`,
              margin: '0.5rem 0 1rem',
              fontSize: '0.875rem',
              color: balanced ? '#047857' : '#b91c1c',
              fontWeight: 600,
            }}
          >
            {balanced
              ? `Balanced at ${formatRs(orderAmount)} ✓`
              : remaining > 0
                ? `${formatRs(remaining)} short of the order total`
                : `${formatRs(Math.abs(remaining))} over the order total`}
          </div>

          <label
            htmlFor="correct-reason"
            style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
          >
            Reason <span style={{ fontWeight: 400, color: '#9ca3af' }}>· recorded in the audit trail</span>
          </label>
          <textarea
            id="correct-reason"
            value={form.reason}
            disabled={busy}
            maxLength={500}
            rows={2}
            placeholder="e.g. Rs. 2,000 of the cash was actually a bank transfer"
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: '0.875rem',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />

          {row.corrected && (
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
              This entry has already been corrected {row.correctionCount}{' '}
              {row.correctionCount === 1 ? 'time' : 'times'}. Every change is kept.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              style={{
                padding: '0.625rem 1rem',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#111827',
                fontWeight: 500,
                fontSize: '0.875rem',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSave}
              onClick={() =>
                onSubmit({ cash, online, credit, ...(form.reason ? { reason: form.reason } : {}) })
              }
              style={{
                padding: '0.625rem 1.25rem',
                borderRadius: 8,
                border: 'none',
                background: canSave ? 'var(--admin-primary, #2563eb)' : '#9ca3af',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'Saving…' : 'Save correction'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CorrectCollectionModal;
