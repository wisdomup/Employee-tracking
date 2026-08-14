import React from 'react';
import dynamic from 'next/dynamic';

const OrderTermsEditor = dynamic(() => import('./OrderTermsEditor'), { ssr: false });

export interface ApproveRiderOption {
  _id: string;
  label: string;
  /** Blank when the rider has no city set — the backend refuses to assign those. */
  city: string;
}

export interface ApproveOrderTermsModalProps {
  open: boolean;
  /** Remount the rich editor when switching context (e.g. order id). */
  editorKey?: string;
  value: string;
  onChange: (html: string) => void;
  onClose: () => void;
  onApprove: () => void | Promise<void>;
  busy?: boolean;
  /**
   * Rider picker. All three are optional so this modal stays usable from any page that only
   * needs the terms editor (e.g. the order detail screen).
   */
  riders?: ApproveRiderOption[];
  assignedRiderId?: string;
  onRiderChange?: (riderId: string) => void;
}

const ApproveOrderTermsModal: React.FC<ApproveOrderTermsModalProps> = ({
  open,
  editorKey,
  value,
  onChange,
  onClose,
  onApprove,
  busy = false,
  riders,
  assignedRiderId = '',
  onRiderChange,
}) => {
  if (!open) return null;

  const showRiderPicker = Array.isArray(riders) && typeof onRiderChange === 'function';
  const selectedRider = riders?.find((r) => r._id === assignedRiderId);
  const riderHasNoCity = Boolean(selectedRider && !selectedRider.city);

  return (
    <div
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
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-order-modal-title"
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 640,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 id="approve-order-modal-title" style={{ margin: 0, fontSize: '1.125rem', color: '#111827' }}>
            Approve order
          </h2>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            {showRiderPicker
              ? 'Hand the order to a delivery boy and optionally set the invoice terms.'
              : 'Optional invoice terms & conditions (shown on the printed invoice when filled).'}
          </p>
        </div>
        <div style={{ padding: '1rem 1.5rem 1.5rem' }}>
          {showRiderPicker && (
            <div style={{ marginBottom: '1.25rem' }}>
              <label
                htmlFor="approve-order-rider"
                style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem' }}
              >
                Delivery boy
              </label>
              <select
                id="approve-order-rider"
                value={assignedRiderId}
                disabled={busy}
                onChange={(e) => onRiderChange!(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  fontSize: '0.875rem',
                  background: '#fff',
                  color: '#111827',
                }}
              >
                <option value="">Assign later</option>
                {riders!.map((rider) => (
                  <option key={rider._id} value={rider._id}>
                    {rider.label}
                  </option>
                ))}
              </select>
              <p style={{ margin: '0.375rem 0 0', fontSize: '0.75rem', color: riderHasNoCity ? '#b45309' : '#6b7280' }}>
                {riderHasNoCity
                  ? 'This rider has no city set. Set a city on their profile first — collections are tracked city-wise and this assignment will be refused.'
                  : 'Only the assigned rider sees this order. You can assign or change it later from the orders list.'}
              </p>
            </div>
          )}
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem' }}>
            Terms &amp; conditions
          </label>
          <OrderTermsEditor key={editorKey ?? 'approve-terms'} value={value} onChange={onChange} />
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: busy ? '#6b7280' : '#111827',
                fontWeight: 500,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove()}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 8,
                border: 'none',
                background: '#059669',
                color: '#fff',
                fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                fontSize: '0.875rem',
              }}
            >
              {busy ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApproveOrderTermsModal;
