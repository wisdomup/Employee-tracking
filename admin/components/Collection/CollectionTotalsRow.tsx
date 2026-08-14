import React from 'react';
import { formatRs } from '../../utils/formatCurrency';

export interface TotalsTile {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'cash' | 'online' | 'credit';
}

const TONES: Record<string, { bg: string; border: string; fg: string }> = {
  default: { bg: '#f9fafb', border: '#e5e7eb', fg: '#111827' },
  cash: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857' },
  online: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8' },
  credit: { bg: '#fffbeb', border: '#fcd34d', fg: '#b45309' },
};

/**
 * KPI strip above a collection table — the same idea as region-sales' <TotalsRow>.
 *
 * Cash / online / credit are colour-coded consistently across every screen in the module, so a
 * figure is recognisable by position and colour rather than by reading the label each time.
 */
const CollectionTotalsRow: React.FC<{ tiles: TotalsTile[] }> = ({ tiles }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: '0.75rem',
      marginBottom: '1rem',
    }}
  >
    {tiles.map((tile) => {
      const tone = TONES[tile.tone ?? 'default'];
      return (
        <div
          key={tile.label}
          style={{
            padding: '0.875rem 1rem',
            borderRadius: 10,
            background: tone.bg,
            border: `1px solid ${tone.border}`,
          }}
        >
          <div
            style={{
              fontSize: '0.6875rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#6b7280',
              fontWeight: 600,
            }}
          >
            {tile.label}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: tone.fg, marginTop: '0.15rem' }}>
            {tile.value}
          </div>
          {tile.hint && (
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem' }}>
              {tile.hint}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

/** The four tiles every collection screen shows, in the spec's own order. */
export function splitTiles(totals: {
  amount: number;
  cash: number;
  online: number;
  credit: number;
  count?: number;
}): TotalsTile[] {
  return [
    {
      label: 'Total',
      value: formatRs(totals.amount),
      ...(totals.count !== undefined
        ? { hint: `${totals.count} ${totals.count === 1 ? 'entry' : 'entries'}` }
        : {}),
    },
    { label: 'Cash', value: formatRs(totals.cash), tone: 'cash' },
    { label: 'Online', value: formatRs(totals.online), tone: 'online' },
    { label: 'Credit', value: formatRs(totals.credit), tone: 'credit' },
  ];
}

export default CollectionTotalsRow;
