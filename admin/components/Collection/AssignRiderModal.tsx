import React, { useState } from 'react';
import { Employee } from '../../services/employeeService';

export interface AssignRiderModalProps {
  open: boolean;
  /** Short human label for the order being assigned, e.g. "#1042 — Ahmed Kiryana". */
  orderLabel: string;
  riders: Employee[];
  /** Currently assigned rider id, or '' when nobody has it. */
  currentRiderId: string;
  busy?: boolean;
  onClose: () => void;
  /** `''` means "take it back off the rider". */
  onSubmit: (riderId: string) => void | Promise<void>;
}

/** Rider option label: name plus the city, because a city-less rider cannot be assigned. */
export function riderOptionLabel(rider: Employee): string {
  const name = rider.fullName || rider.username;
  const city = rider.address?.city?.trim();
  return city ? `${name} — ${city}` : `${name} — no city set`;
}

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#111827',
  fontWeight: 500,
  fontSize: '0.875rem',
  cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 8,
  border: 'none',
  background: 'var(--admin-primary, #2563eb)',
  color: '#fff',
  fontWeight: 600,
  fontSize: '0.875rem',
  cursor: 'pointer',
};

const AssignRiderModal: React.FC<AssignRiderModalProps> = ({
  open,
  orderLabel,
  riders,
  currentRiderId,
  busy = false,
  onClose,
  onSubmit,
}) => {
  const [riderId, setRiderId] = useState(currentRiderId);

  // Reset the draft whenever the modal is opened against a different order.
  React.useEffect(() => {
    if (open) setRiderId(currentRiderId);
  }, [open, currentRiderId]);

  if (!open) return null;

  const selected = riders.find((r) => r._id === riderId);
  const selectedHasNoCity = Boolean(selected && !selected.address?.city?.trim());
  const isUnassigning = riderId === '' && currentRiderId !== '';

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
        aria-labelledby="assign-rider-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 460,
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
          <h2 id="assign-rider-title" style={{ margin: 0, fontSize: '1.125rem', color: '#111827' }}>
            {currentRiderId ? 'Reassign delivery boy' : 'Assign delivery boy'}
          </h2>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>{orderLabel}</p>
        </div>

        <div style={{ padding: '1.25rem 1.5rem' }}>
          <label
            htmlFor="assign-rider-select"
            style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.5rem' }}
          >
            Delivery boy
          </label>
          <select
            id="assign-rider-select"
            value={riderId}
            disabled={busy}
            onChange={(e) => setRiderId(e.target.value)}
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
            <option value="">— Nobody (unassigned) —</option>
            {riders.map((rider) => (
              <option key={rider._id} value={rider._id}>
                {riderOptionLabel(rider)}
              </option>
            ))}
          </select>

          {selectedHasNoCity && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#b45309' }}>
              This rider has no city set. Collections are tracked strictly city-wise, so the server
              will refuse this assignment until an admin sets a city on their profile.
            </p>
          )}
          {isUnassigning && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
              The order will disappear from that rider’s list until you assign someone else.
            </p>
          )}
          {riders.length === 0 && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: '#b45309' }}>
              No active delivery boys found. Create a user with the “delivery_man” role first.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button type="button" style={btnSecondary} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              style={{ ...btnPrimary, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
              disabled={busy}
              onClick={() => onSubmit(riderId)}
            >
              {busy ? 'Saving…' : isUnassigning ? 'Unassign' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssignRiderModal;
