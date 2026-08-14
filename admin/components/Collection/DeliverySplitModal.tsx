import React, { useEffect, useMemo, useState } from 'react';
import { RiderOrder } from '../../services/collectionService';
import { formatRs } from '../../utils/formatCurrency';

/**
 * Spec §4 — Cash + Online + Credit must equal the order amount, with any partial split allowed.
 *
 * Designed for a phone held in one hand outside a shop, so: a large always-visible "remaining"
 * line, `inputMode="decimal"` (a `type="number"` spinner is unusable there and eats decimal
 * separators in some Android locales), and a "put the rest here" chip beside each field that
 * makes a balanced split a two-tap operation. That chip is the control riders actually use.
 *
 * The validation here is UX only. The server re-validates the same invariant against the order's
 * own grand total, which is the figure that counts.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const parse = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export interface DeliverySplitModalProps {
  open: boolean;
  order: RiderOrder | null;
  shopName: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (split: { cash: number; online: number; credit: number; note?: string }) => void | Promise<void>;
}

type Field = 'cash' | 'online' | 'credit';
const FIELDS: { key: Field; label: string; hint: string }[] = [
  { key: 'cash', label: 'Cash', hint: 'Received in hand' },
  { key: 'online', label: 'Online', hint: 'Received digitally' },
  { key: 'credit', label: 'Credit', hint: 'Left pending against the client' },
];

const DeliverySplitModal: React.FC<DeliverySplitModalProps> = ({
  open,
  order,
  shopName,
  busy = false,
  onClose,
  onSubmit,
}) => {
  const [form, setForm] = useState({ cash: '', online: '', credit: '', note: '' });

  // Reset whenever the modal opens against a different order, or a stale split carries over.
  useEffect(() => {
    if (open) setForm({ cash: '', online: '', credit: '', note: '' });
  }, [open, order?._id]);

  const orderAmount = round2(order?.grandTotal ?? 0);
  const cash = parse(form.cash);
  const online = parse(form.online);
  const credit = parse(form.credit);

  const { entered, remaining, balanced } = useMemo(() => {
    const total = round2(cash + online + credit);
    const left = round2(orderAmount - total);
    return { entered: total, remaining: left, balanced: Math.abs(left) < 0.005 };
  }, [cash, online, credit, orderAmount]);

  const canSave = balanced && orderAmount > 0 && !busy;

  if (!open || !order) return null;

  const setField = (key: Field, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** "Put the rest here": set this field to its current value plus whatever is unallocated. */
  const putRestHere = (key: Field) => {
    const current = key === 'cash' ? cash : key === 'online' ? online : credit;
    const next = round2(current + remaining);
    setField(key, next > 0 ? String(next) : '0');
  };

  const remainingTone = balanced ? '#047857' : remaining > 0 ? '#b45309' : '#b91c1c';
  const remainingText = balanced
    ? 'Balanced ✓'
    : remaining > 0
      ? `${formatRs(remaining)} left to allocate`
      : `${formatRs(Math.abs(remaining))} over the order total`;

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
        aria-labelledby="deliver-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 460,
          width: '100%',
          maxHeight: '92vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 id="deliver-title" style={{ margin: 0, fontSize: '1.125rem', color: '#111827' }}>
            Record collection
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            {shopName}
            {order.invoiceNumber ? ` · #${order.invoiceNumber}` : ''}
          </p>
        </div>

        <div style={{ padding: '1.25rem 1.5rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '0.75rem 1rem',
              borderRadius: 10,
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              marginBottom: '1rem',
            }}
          >
            <span style={{ fontSize: '0.8125rem', color: '#6b7280', fontWeight: 600 }}>
              Order amount
            </span>
            <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
              {formatRs(orderAmount)}
            </span>
          </div>

          {order.paidAmount > 0 && (
            <p
              style={{
                margin: '0 0 1rem',
                padding: '0.625rem 0.75rem',
                borderRadius: 8,
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                fontSize: '0.8125rem',
                color: '#92400e',
              }}
            >
              An advance of {formatRs(order.paidAmount)} was recorded when this order was created.
              Enter the <strong>full</strong> order amount below — this entry replaces it.
            </p>
          )}

          {FIELDS.map(({ key, label, hint }) => (
            <div key={key} style={{ marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label
                  htmlFor={`split-${key}`}
                  style={{ fontWeight: 600, fontSize: '0.875rem', color: '#374151' }}
                >
                  {label}
                  <span style={{ fontWeight: 400, color: '#9ca3af' }}> · {hint}</span>
                </label>
                {!balanced && remaining !== 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => putRestHere(key)}
                    style={{
                      border: '1px solid #d1d5db',
                      background: '#f9fafb',
                      borderRadius: 999,
                      padding: '0.15rem 0.6rem',
                      fontSize: '0.75rem',
                      color: '#374151',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Put the rest here →
                  </button>
                )}
              </div>
              <input
                id={`split-${key}`}
                // type="text" + inputMode: a number spinner is unusable on a phone and some
                // Android locales drop the decimal separator from type="number".
                type="text"
                inputMode="decimal"
                value={form[key]}
                disabled={busy}
                placeholder="0"
                onChange={(e) => setField(key, e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  fontSize: '1rem',
                  color: '#111827',
                }}
              />
            </div>
          ))}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 1rem',
              borderRadius: 10,
              background: balanced ? '#ecfdf5' : remaining > 0 ? '#fffbeb' : '#fef2f2',
              border: `1px solid ${balanced ? '#a7f3d0' : remaining > 0 ? '#fcd34d' : '#fecaca'}`,
              margin: '0.5rem 0 1rem',
            }}
          >
            <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
              Entered {formatRs(entered)}
            </span>
            <strong style={{ fontSize: '1rem', color: remainingTone }}>{remainingText}</strong>
          </div>

          <label
            htmlFor="split-note"
            style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
          >
            Note <span style={{ fontWeight: 400, color: '#9ca3af' }}>· optional</span>
          </label>
          <textarea
            id="split-note"
            value={form.note}
            disabled={busy}
            maxLength={500}
            rows={2}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
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

          {orderAmount <= 0 && (
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem', color: '#b91c1c' }}>
              This order has no amount recorded. Ask an admin to fix it before delivering.
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
                onSubmit({ cash, online, credit, ...(form.note ? { note: form.note } : {}) })
              }
              style={{
                padding: '0.625rem 1.25rem',
                borderRadius: 8,
                border: 'none',
                background: canSave ? '#059669' : '#9ca3af',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'Saving…' : 'Save & mark delivered'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeliverySplitModal;
