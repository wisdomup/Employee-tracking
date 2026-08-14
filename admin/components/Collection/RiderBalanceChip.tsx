import React from 'react';
import { RiderBalance } from '../../services/collectionService';
import { formatRs } from '../../utils/formatCurrency';

interface Props {
  balance: RiderBalance | null;
  /** `full` adds the online and credit figures; `compact` is just cash in hand. */
  variant?: 'compact' | 'full';
}

const card: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  padding: '0.875rem 1rem',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
};

const cell: React.CSSProperties = { minWidth: 120 };
const labelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#6b7280',
  fontWeight: 600,
};
const valueStyle: React.CSSProperties = { fontSize: '1.125rem', fontWeight: 700, color: '#111827' };

const Figure: React.FC<{ label: string; value: string; hint?: string; tone?: string }> = ({
  label,
  value,
  hint,
  tone,
}) => (
  <div style={cell}>
    <div style={labelStyle}>{label}</div>
    <div style={{ ...valueStyle, ...(tone ? { color: tone } : {}) }}>{value}</div>
    {hint && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{hint}</div>}
  </div>
);

/** The rider's money at a glance. Cash in hand is what the office will ask them for. */
const RiderBalanceChip: React.FC<Props> = ({ balance, variant = 'full' }) => {
  if (!balance) {
    return (
      <div style={card}>
        <Figure label="Cash in hand" value="—" />
      </div>
    );
  }

  return (
    <div style={card}>
      <Figure
        label="Cash in hand"
        value={formatRs(balance.cash.inHand)}
        hint={
          balance.cash.pendingSettlement > 0
            ? `${formatRs(balance.cash.pendingSettlement)} awaiting office confirmation`
            : undefined
        }
        tone={balance.cash.inHand > 0 ? '#b45309' : undefined}
      />
      {variant === 'full' && (
        <>
          <Figure
            label="Online not settled"
            value={formatRs(balance.online.outstanding)}
          />
          <Figure
            label="Credit with clients"
            value={formatRs(balance.creditIssuedOutstanding)}
            hint="Recover from the Credit Recovery tab"
          />
        </>
      )}
    </div>
  );
};

export default RiderBalanceChip;
