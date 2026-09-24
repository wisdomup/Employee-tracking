import React from 'react';
import { canViewReport } from '../../utils/permissions';
import { TrailRef } from '../../services/financeService';
import styles from '../../styles/Finance.module.scss';

/**
 * Anything that is not a money figure but still opens a trail: an entry number, a party, a document.
 *
 * The same rule as `TrailAmount`: shown as a link only to someone who holds the Money Trails report,
 * and as its plain contents to everyone else. These used to be buttons calling the panel directly,
 * so a person without that report was offered a link that answered with a refusal.
 */
interface Props {
  trail: TrailRef | null;
  onOpen?: (ref: TrailRef) => void;
  title?: string;
  children: React.ReactNode;
}

const TrailLink: React.FC<Props> = ({ trail, onOpen, title, children }) => {
  if (!trail || !onOpen || !canViewReport('finance.trail')) return <>{children}</>;
  return (
    <button
      type="button"
      className={styles.trailCrumb}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(trail);
      }}
    >
      {children}
    </button>
  );
};

export default TrailLink;
