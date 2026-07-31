import React from 'react';
import type { AchievementStatus } from '../../services/analyticsService';

interface AchievementBarProps {
  actual: number;
  target: number | null;
  percent: number | null;
  status: AchievementStatus;
  /** Formats the numbers for display (e.g. money with thousands separators). */
  format?: (value: number) => string;
}

const STATUS_COLOR: Record<AchievementStatus, string> = {
  achieved: '#16a34a',
  on_track: '#0ea5e9',
  at_risk: '#f59e0b',
  behind: '#dc2626',
  no_target: '#9ca3af',
};

const STATUS_LABEL: Record<AchievementStatus, string> = {
  achieved: 'Achieved',
  on_track: 'On track',
  at_risk: 'At risk',
  behind: 'Behind',
  no_target: 'No target',
};

/**
 * Progress of an actual value against its target.
 *
 * With no target set we deliberately show a dash rather than 0% — "no target" is not
 * the same as "achieved nothing", and colouring it red would be misleading.
 */
const AchievementBar: React.FC<AchievementBarProps> = ({
  actual,
  target,
  percent,
  status,
  format = (v) => String(v),
}) => {
  const color = STATUS_COLOR[status] ?? '#9ca3af';
  // The bar caps at 100% width, but the printed percentage is uncapped so
  // over-performance is still visible.
  const width = percent == null ? 0 : Math.min(percent, 100);

  return (
    <div style={{ minWidth: 150 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.5rem',
          fontSize: '0.8125rem',
          marginBottom: '0.25rem',
        }}
      >
        <strong>{format(actual)}</strong>
        <span style={{ color: '#6b7280' }}>{target == null ? '—' : format(target)}</span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 9999,
          background: '#e5e7eb',
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-valuenow={percent ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Target achievement"
      >
        <div style={{ width: `${width}%`, height: '100%', background: color }} />
      </div>
      <div style={{ fontSize: '0.75rem', color, marginTop: '0.25rem', fontWeight: 600 }}>
        {percent == null ? STATUS_LABEL.no_target : `${percent}% · ${STATUS_LABEL[status]}`}
      </div>
    </div>
  );
};

export default AchievementBar;
