import React from 'react';
import styles from '../../styles/StockReports.module.scss';

/**
 * Sellable / Damaged (and optionally in-transit) piece counts in one table cell, with low-stock
 * highlighting. Appears in the warehouse detail table, the Stock on Hand report and the hub, so the
 * "zero is critical, at-or-below the level is a warning" rule lives in one place.
 */
interface BucketQtyCellProps {
  sellable: number;
  damaged: number;
  inTransit?: number;
  /** Admin-set low-stock level; compared against `totalSellable`, not this warehouse's figure. */
  survivalQuantity?: number | null;
  /** Precomputed by the API — the level is a company-wide total, not a per-warehouse one. */
  isLow?: boolean;
}

const BucketQtyCell: React.FC<BucketQtyCellProps> = ({
  sellable,
  damaged,
  inTransit = 0,
  survivalQuantity,
  isLow,
}) => {
  const low = isLow ?? (typeof survivalQuantity === 'number' && sellable <= survivalQuantity);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.4 }}>
      <span>
        {sellable === 0 ? (
          <span className={styles.criticalBadge}>Out of stock</span>
        ) : low ? (
          <span className={styles.warningBadge}>{sellable} sellable</span>
        ) : (
          <>{sellable} sellable</>
        )}
      </span>
      {damaged > 0 && (
        <span style={{ color: '#b91c1c', fontWeight: 600, fontSize: 12 }}>
          {damaged} damaged / claim
        </span>
      )}
      {inTransit > 0 && (
        <span style={{ color: '#b45309', fontSize: 12 }} title="Left this warehouse on an approved transfer, not yet received">
          {inTransit} in transit
        </span>
      )}
    </div>
  );
};

export default BucketQtyCell;
