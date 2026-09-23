import React from 'react';
import { canViewReport } from '../../utils/permissions';
import { TrailRef } from '../../services/financeService';
import styles from '../../styles/Finance.module.scss';

/**
 * A money figure that opens its own back-trail.
 *
 * The click target is the AMOUNT, not the account name beside it. That is the whole point: the
 * question people ask is "where did this number come from", and they ask it of the number.
 *
 * Renders as ordinary text — no underline, no pointer — when there is nothing to drill into or the
 * reader does not hold the Money Trails report. An affordance that refuses on click teaches people
 * to stop clicking, which costs more than never offering it.
 */

interface Props {
  value: number;
  trail?: TrailRef | null;
  /** Opens the panel. Supplied by whichever screen owns the panel. */
  onOpen?: (ref: TrailRef) => void;
  /** Formatter, so a screen keeps its own conventions for negatives and zero. */
  format?: (value: number) => string;
  className?: string;
  /** Said in the tooltip, so hovering explains what a click will do. */
  title?: string;
}

function defaultFormat(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TrailAmount: React.FC<Props> = ({
  value,
  trail,
  onOpen,
  format = defaultFormat,
  className,
  title,
}) => {
  const text = format(value);
  const negative = value < 0;
  const amountClass = `${styles.amount} ${negative ? styles.amountNegative : ''} ${className ?? ''}`;

  const drillable = Boolean(trail && onOpen && canViewReport('finance.trail'));

  if (!drillable) {
    return <span className={amountClass}>{text}</span>;
  }

  return (
    <button
      type="button"
      className={`${styles.trailAmount} ${amountClass}`}
      title={title ?? 'See what this figure is made of'}
      onClick={(e) => {
        e.stopPropagation();
        onOpen!(trail!);
      }}
    >
      {text}
    </button>
  );
};

export default TrailAmount;
