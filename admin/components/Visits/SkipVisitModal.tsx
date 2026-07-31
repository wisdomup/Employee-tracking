import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { visitService, SkipPreview, VISIT_COMPLETION_THRESHOLD_PERCENT } from '../../services/visitService';

interface SkipVisitModalProps {
  visitId: string;
  clientName?: string;
  onClose: () => void;
  /** Called after a successful skip. `flagged` is true if the rider was reported. */
  onSkipped: (flagged: boolean) => void;
}

function extractApiMessage(error: unknown): string | null {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message ?? null;
  }
  return null;
}

/**
 * Two-step skip. On open it previews the impact on today's completion rate; if that
 * would fall below the pass mark the rider must explicitly acknowledge that their
 * supervisor will be notified before the skip goes through.
 */
const SkipVisitModal: React.FC<SkipVisitModalProps> = ({
  visitId,
  clientName,
  onClose,
  onSkipped,
}) => {
  const [preview, setPreview] = useState<SkipPreview | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    visitService
      .previewSkip(visitId)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((error) => {
        if (!cancelled) toast.error(extractApiMessage(error) || 'Could not check your visit total');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const willBreach = preview?.wouldDropBelowThreshold ?? false;
  const blocked = preview?.blockedReason ?? null;

  const handleSkip = async () => {
    setSaving(true);
    try {
      const result = await visitService.skipVisit(visitId, {
        reason: reason.trim() || undefined,
        // Only send confirm once the rider has ticked the acknowledgement.
        confirm: willBreach ? acknowledged : undefined,
      });
      if (result.requiresConfirmation) {
        // Backend re-checked and still wants confirmation — surface its message.
        toast.warn(result.message || 'Please confirm before skipping.');
        setPreview((p) => (p ? { ...p, wouldDropBelowThreshold: true, projectedRate: result.projectedRate } : p));
        setSaving(false);
        return;
      }
      toast.success(
        result.flagged
          ? `Visit skipped. Today can now finish at best ${result.projectedRate}% — your supervisor has been notified.`
          : 'Visit skipped.',
      );
      onSkipped(Boolean(result.flagged));
    } catch (error) {
      toast.error(extractApiMessage(error) || 'Could not skip this visit');
    } finally {
      setSaving(false);
    }
  };

  const box: React.CSSProperties = {
    background: '#fff',
    borderRadius: '0.75rem',
    padding: '1.5rem',
    width: '100%',
    maxWidth: 440,
    maxHeight: '90vh',
    overflowY: 'auto',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Skip visit"
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
      <div onClick={(e) => e.stopPropagation()} style={box}>
        <h2 style={{ margin: 0, fontSize: '1.125rem' }}>Skip this visit?</h2>
        {clientName && (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 1rem' }}>
            {clientName}
          </p>
        )}

        {loading && <p style={{ color: '#6b7280' }}>Checking today&apos;s visits…</p>}

        {!loading && blocked && (
          <>
            <div
              style={{
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '0.9375rem',
              }}
            >
              {blocked}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button type="button" onClick={onClose} style={btnSecondary}>
                Close
              </button>
            </div>
          </>
        )}

        {!loading && !blocked && preview && (
          <>
            <div
              style={{
                display: 'grid',
                gap: '0.25rem',
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                fontSize: '0.875rem',
                color: '#374151',
                marginBottom: '0.875rem',
              }}
            >
              <div>
                Today: <strong>{preview.completed}</strong> completed of{' '}
                <strong>{preview.assigned}</strong> assigned
                {preview.skipped > 0 && <> · {preview.skipped} already skipped</>}
              </div>
              <div>
                If you skip this one, the best you can finish on is{' '}
                <strong>{preview.projectedRate}%</strong> (pass mark{' '}
                {preview.threshold ?? VISIT_COMPLETION_THRESHOLD_PERCENT}%).
              </div>
            </div>

            {willBreach && (
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: '0.875rem',
                  marginBottom: '0.875rem',
                }}
              >
                <strong>⚠️ This drops you below the {preview.threshold}% pass mark.</strong>
                <div style={{ marginTop: '0.25rem' }}>
                  If you continue, a report is sent to your supervisor.
                </div>
              </div>
            )}

            <label
              htmlFor="skip-reason"
              style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.25rem' }}
            >
              Reason {willBreach ? '(recommended)' : '(optional)'}
            </label>
            <textarea
              id="skip-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Shop closed, owner unavailable"
              style={{
                width: '100%',
                padding: '0.5rem 0.625rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                fontSize: '0.9375rem',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />

            {willBreach && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  marginTop: '0.875rem',
                  fontSize: '0.875rem',
                  color: '#374151',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  style={{ marginTop: '0.2rem' }}
                />
                <span>
                  I understand this takes me below {preview.threshold}% and my supervisor will be
                  notified.
                </span>
              </label>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button type="button" onClick={onClose} style={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSkip}
                disabled={saving || (willBreach && !acknowledged)}
                style={{
                  ...btnPrimary,
                  background: willBreach ? '#dc2626' : 'var(--admin-primary, #0ea5e9)',
                  opacity: saving || (willBreach && !acknowledged) ? 0.6 : 1,
                  cursor: saving || (willBreach && !acknowledged) ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Skipping…' : willBreach ? 'Skip anyway' : 'Skip visit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '0.375rem',
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '0.375rem',
  border: 'none',
  color: '#fff',
};

export default SkipVisitModal;
