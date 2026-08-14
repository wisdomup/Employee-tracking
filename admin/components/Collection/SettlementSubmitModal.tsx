import React, { useEffect, useState } from 'react';
import { ImageUpload } from '../UI/ImageUpload';
import { RiderBalance } from '../../services/collectionService';
import { formatRs } from '../../utils/formatCurrency';

/**
 * Spec §6 — the rider handing money back.
 *
 * The single most important thing on this screen is the cash disclaimer: submitting cash does
 * NOT reduce the balance, and if that is not said plainly the rider reports the balance as
 * broken the first time they use it.
 *
 * The screenshot is uploaded through the existing `/api/upload` endpoint (reusing ImageUpload
 * with its camera flow) and only its URL is posted, so the settlement endpoint stays pure JSON.
 */

export interface SettlementSubmitModalProps {
  open: boolean;
  mode: 'cash' | 'online';
  balance: RiderBalance | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (body: { mode: 'cash' | 'online'; amount: number; note?: string; screenshotUrl?: string }) => void | Promise<void>;
}

const SettlementSubmitModal: React.FC<SettlementSubmitModalProps> = ({
  open,
  mode,
  balance,
  busy = false,
  onClose,
  onSubmit,
}) => {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');

  useEffect(() => {
    if (open) {
      setAmount('');
      setNote('');
      setScreenshotUrl('');
    }
  }, [open, mode]);

  if (!open) return null;

  const available =
    mode === 'cash'
      ? (balance?.cash.availableToSettle ?? 0)
      : (balance?.online.availableToSettle ?? 0);

  const parsed = Number.parseFloat(amount);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const overCap = valid && parsed - available >= 0.005;
  const canSave = valid && !overCap && available > 0 && !busy;

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
        aria-labelledby="settlement-title"
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
          <h2 id="settlement-title" style={{ margin: 0, fontSize: '1.125rem', color: '#111827' }}>
            {mode === 'cash' ? 'Pay cash to company' : 'Submit online transfer'}
          </h2>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            You can settle up to <strong>{formatRs(available)}</strong> right now.
          </p>
        </div>

        <div style={{ padding: '1.25rem 1.5rem' }}>
          {mode === 'cash' && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 10,
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                marginBottom: '1rem',
              }}
            >
              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#92400e' }}>
                <strong>Your cash balance will not change yet.</strong> This marks the money as
                handed over. It only comes off your balance once the office confirms it was
                received.
              </p>
            </div>
          )}

          <label
            htmlFor="settlement-amount"
            style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
          >
            Amount
          </label>
          <input
            id="settlement-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            disabled={busy}
            placeholder="0"
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              borderRadius: 8,
              border: `1px solid ${overCap ? '#fca5a5' : '#d1d5db'}`,
              fontSize: '1rem',
            }}
          />
          {overCap && (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#b91c1c' }}>
              That is more than you have available. Anything already submitted and awaiting
              confirmation is excluded.
            </p>
          )}
          {available > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAmount(String(available))}
              style={{
                marginTop: '0.5rem',
                border: '1px solid #d1d5db',
                background: '#f9fafb',
                borderRadius: 999,
                padding: '0.25rem 0.75rem',
                fontSize: '0.75rem',
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              Settle everything ({formatRs(available)})
            </button>
          )}

          {mode === 'online' && (
            <div style={{ marginTop: '1rem' }}>
              <ImageUpload
                value={screenshotUrl}
                onChange={setScreenshotUrl}
                category="settlements"
                label="Transfer screenshot (optional)"
              />
            </div>
          )}

          <div style={{ marginTop: '1rem' }}>
            <label
              htmlFor="settlement-note"
              style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}
            >
              Note <span style={{ fontWeight: 400, color: '#9ca3af' }}>· optional</span>
            </label>
            <textarea
              id="settlement-note"
              value={note}
              disabled={busy}
              maxLength={500}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
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
          </div>

          {available <= 0 && (
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem', color: '#6b7280' }}>
              {mode === 'cash'
                ? 'You have no cash left to hand over.'
                : 'You have no online collection left to settle.'}
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
                onSubmit({
                  mode,
                  amount: parsed,
                  ...(note ? { note } : {}),
                  ...(mode === 'online' && screenshotUrl ? { screenshotUrl } : {}),
                })
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
              {busy ? 'Saving…' : mode === 'cash' ? 'Mark paid to company' : 'Submit transfer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettlementSubmitModal;
