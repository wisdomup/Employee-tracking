import React from 'react';
import SearchableSelect from '../UI/SearchableSelect';
import { RiderSummary } from '../../services/collectionService';
import { formatRs } from '../../utils/formatCurrency';

interface Props {
  riders: RiderSummary[];
  value: string;
  onChange: (riderId: string) => void;
  /** Label for the "no filter" option. Spec §11 calls it "All Riders". */
  allLabel?: string;
  /** Show each rider's live cash in hand in the option label. */
  showBalance?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Multi-rider selector shared by every report and activity view (spec §11). */
const RiderSelect: React.FC<Props> = ({
  riders,
  value,
  onChange,
  allLabel = 'All Riders',
  showBalance = false,
  className,
  style,
}) => (
  <SearchableSelect
    name="riderId"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={className}
    style={{ maxWidth: 240, ...style }}
    placeholder={allLabel}
    options={[
      { value: '', label: allLabel },
      ...riders.map((r) => {
        const name = r.fullName || r.username;
        const city = r.city && r.city !== 'Unassigned' ? ` — ${r.city}` : '';
        const balance = showBalance ? ` · ${formatRs(r.cashInHand)}` : '';
        return { value: r._id, label: `${name}${city}${balance}` };
      }),
    ]}
  />
);

export default RiderSelect;
