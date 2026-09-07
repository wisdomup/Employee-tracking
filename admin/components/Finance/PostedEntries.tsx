import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { can } from '../../utils/permissions';
import {
  entriesForSource,
  sourceTypeLabel,
  SourceEntry,
} from '../../services/financeService';
import styles from '../../styles/Finance.module.scss';

/**
 * What this document did to the accounts.
 *
 * Dropped onto an order, a delivery or a stock receipt so the question "what did this do to the
 * books?" is answered where it is asked, rather than by going to the journal and searching.
 *
 * Renders nothing at all when there is nothing to show. Automatic posting is switched on one
 * event at a time, so for a long while most documents will have posted nothing — an empty panel
 * headed "Accounting" on every order would read as something being broken.
 */

interface Props {
  sourceId: string;
  /** Shown above the entries. Defaults to something neutral. */
  title?: string;
}

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PostedEntries: React.FC<Props> = ({ sourceId, title = 'In the accounts' }) => {
  const [entries, setEntries] = useState<SourceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const allowed = can(undefined, 'finance-journal:view');

  useEffect(() => {
    if (!sourceId || !allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    entriesForSource(sourceId)
      .then((data) => {
        if (!cancelled) setEntries(data.entries);
      })
      // Silent: this is supplementary. A document's own screen must not show an error banner
      // because a panel beside it could not load.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceId, allowed]);

  if (!allowed || loading || entries.length === 0) return null;

  return (
    <div className={styles.panel} style={{ marginTop: '1.25rem' }}>
      <h2 className={styles.panelTitle}>{title}</h2>

      {entries.map((entry) => (
        <div key={entry.id} style={{ marginBottom: '1rem' }}>
          <div
            style={{
              display: 'flex',
              gap: '0.625rem',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              marginBottom: '0.375rem',
            }}
          >
            <span className={styles.code}>#{entry.entryNo ?? '—'}</span>
            <strong>{sourceTypeLabel(entry.sourceType)}</strong>
            <span className={styles.muted}>{new Date(entry.date).toLocaleDateString()}</span>
            <span className={`${styles.status} ${styles[`status_${entry.status}`]}`}>
              {entry.status}
            </span>
            <Link
              href={`/finance/journal/${entry.id}`}
              style={{ marginLeft: 'auto', fontSize: '0.82rem' }}
            >
              Open entry
            </Link>
          </div>

          {/* A reversed entry is kept visible rather than hidden. Somebody looking at this
              document needs to see that a correction happened, not a tidied-up final state. */}
          {entry.status === 'reversed' && (
            <p className={styles.readonlyNote} style={{ marginTop: 0 }}>
              This was reversed. Its effect on the accounts has been cancelled out.
            </p>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table className={styles.roleTable}>
              <tbody>
                {entry.lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <span className={styles.code}>{line.ledgerCode}</span> {line.ledgerName}
                    </td>
                    <td style={{ textAlign: 'right', width: '8rem' }}>
                      <span className={styles.amount}>
                        {line.debit ? money(line.debit) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', width: '8rem' }}>
                      <span className={styles.amount}>
                        {line.credit ? money(line.credit) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PostedEntries;
