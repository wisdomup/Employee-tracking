import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import {
  PARTY_TYPE_LABELS,
  Trail,
  TrailRef,
  sourceTypeLabel,
  trailService,
  trailToQuery,
} from '../../services/financeService';
import styles from '../../styles/Finance.module.scss';

/**
 * The slide-over that answers "what is this figure made of".
 *
 * Holds a STACK of the figures visited, shown as breadcrumbs, so walking four levels down and
 * stepping back up costs nothing. The report stays mounted behind the panel: someone who spent a
 * minute setting dates and filters must not lose them to ask one question.
 *
 * The panel knows nothing about which report opened it. Every row carries its own `drill`
 * reference and the endpoint returns one shape, so following a trail is the same code whether the
 * next level is an account, a group, a shop or a single entry.
 */

interface Props {
  /** Every level visited, oldest first. Empty closes the panel. Owned by `useTrail`. */
  stack: TrailRef[];
  onPush: (ref: TrailRef) => void;
  onGoTo: (index: number) => void;
  onClose: () => void;
}

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The server's own words for what went wrong, when it sent any. */
function apiMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function day(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

/** A short name for a level, for the breadcrumb. */
function crumbLabel(trail: Trail | undefined, ref: TrailRef): string {
  if (trail) return trail.title;
  switch (ref.kind) {
    case 'entry': return 'Entry';
    case 'source': return 'Document';
    case 'group': return 'Group';
    case 'party': return PARTY_TYPE_LABELS[ref.partyType];
    case 'derived': return 'Worked out';
    default: return 'Account';
  }
}

const TrailPanel: React.FC<Props> = ({ stack, onPush, onGoTo, onClose }) => {
  /**
   * What has been fetched, keyed by the figure itself rather than by depth.
   *
   * Keyed on the reference so stepping back up a trail and down a different branch reuses what is
   * already in hand, and so a level never shows the previous occupant of its slot.
   */
  const [trails, setTrails] = useState<Record<string, Trail>>({});

  const depth = stack.length - 1;
  const current = depth >= 0 ? stack[depth] : null;
  const currentKey = current ? trailToQuery(current) : null;
  const trail = currentKey ? trails[currentKey] : undefined;
  // Derived rather than a second piece of state: "not fetched yet" is exactly "no entry in the
  // cache", and a separate loading flag could only ever disagree with it.
  const loading = Boolean(current) && !trail;

  useEffect(() => {
    if (!current || !currentKey || trails[currentKey]) return;
    let cancelled = false;
    trailService
      .get(current)
      .then((data) => {
        if (!cancelled) setTrails((prev) => ({ ...prev, [currentKey]: data }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(apiMessage(error, 'Could not open the trail behind that figure'));
        // Drop the level that failed, so the panel falls back to the last one that worked rather
        // than sitting empty with breadcrumbs promising something it cannot show.
        if (stack.length > 1) onGoTo(stack.length - 2);
        else onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [current, currentKey, trails, stack.length, onGoTo, onClose]);

  // Escape closes, as it does for every other overlay in the app.
  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack.length, onClose]);

  if (!current) return null;

  const cameFrom = (trail?.counterparts ?? []).filter((c) => c.amount > 0);
  const wentTo = (trail?.counterparts ?? []).filter((c) => c.amount < 0);

  return (
    <>
      <div className={styles.trailScrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.trailPanel} role="dialog" aria-label="Money trail">
        <button type="button" className={styles.trailClose} onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className={styles.trailHead}>
          <nav className={styles.trailCrumbs} aria-label="Trail">
            {stack.map((ref, i) => (
              <React.Fragment key={`${i}-${ref.kind}`}>
                {i > 0 && <span aria-hidden="true">/</span>}
                {i === depth ? (
                  <span className={styles.trailCrumbCurrent}>
                    {crumbLabel(trails[trailToQuery(ref)], ref)}
                  </span>
                ) : (
                  <button type="button" className={styles.trailCrumb} onClick={() => onGoTo(i)}>
                    {crumbLabel(trails[trailToQuery(ref)], ref)}
                  </button>
                )}
              </React.Fragment>
            ))}
          </nav>

          <h2 className={styles.trailTitle}>{trail?.title ?? 'Opening…'}</h2>
          <p className={styles.trailSubtitle}>{trail?.subtitle ?? ''}</p>
        </div>

        {trail && (
          <div className={styles.trailTotals}>
            {trail.opening !== null && (
              <div>
                <span className={styles.trailTotalLabel}>Brought forward</span>
                <span className={styles.trailTotalValue}>{money(trail.opening)}</span>
              </div>
            )}
            <div>
              <span className={styles.trailTotalLabel}>
                {trail.opening !== null ? 'Closing' : 'Total'}
              </span>
              <span className={styles.trailTotalValue}>{money(trail.total)}</span>
            </div>
            {trail.parent && (
              <div>
                <span className={styles.trailTotalLabel}>Rolls up into</span>
                <button
                  type="button"
                  className={styles.trailCrumb}
                  onClick={() => onPush(trail.parent!)}
                >
                  Open the figure above this
                </button>
              </div>
            )}
          </div>
        )}

        <div className={styles.trailBody}>
          {loading && !trail && <p className={styles.muted}>Working out where this came from…</p>}

          {trail?.note && (
            <div className={`${styles.banner} ${styles.bannerInfo}`}>{trail.note}</div>
          )}

          {/* Derived figures: the arithmetic, so a headline number is not taken on trust. */}
          {trail && trail.parts.length > 0 && (
            <>
              <h3 className={styles.trailSectionTitle}>Made up of</h3>
              <div className={styles.trailFlow}>
                {trail.parts.map((part, i) => (
                  <button
                    key={`${part.label}-${i}`}
                    type="button"
                    className={styles.trailFlowRow}
                    disabled={!part.drill}
                    onClick={() => part.drill && onPush(part.drill)}
                  >
                    <span>
                      {part.operator !== '=' && <strong>{part.operator} </strong>}
                      {part.label}
                    </span>
                    <span className={`${styles.amount} ${part.amount < 0 ? styles.amountNegative : ''}`}>
                      {money(part.amount)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Where the money came from and where it went — the question behind the question. */}
          {(cameFrom.length > 0 || wentTo.length > 0) && (
            <>
              {cameFrom.length > 0 && (
                <>
                  <h3 className={styles.trailSectionTitle}>Came from</h3>
                  <div className={styles.trailFlow}>
                    {cameFrom.map((c) => (
                      <button
                        key={`in-${c.ledgerId}`}
                        type="button"
                        className={`${styles.trailFlowRow} ${styles.trailIn}`}
                        onClick={() => onPush(c.drill)}
                      >
                        <span>
                          <span className={styles.code}>{c.code}</span> {c.name}
                        </span>
                        <span className={styles.amount}>{money(c.amount)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {wentTo.length > 0 && (
                <>
                  <h3 className={styles.trailSectionTitle}>Went to</h3>
                  <div className={styles.trailFlow}>
                    {wentTo.map((c) => (
                      <button
                        key={`out-${c.ledgerId}`}
                        type="button"
                        className={`${styles.trailFlowRow} ${styles.trailOut}`}
                        onClick={() => onPush(c.drill)}
                      >
                        <span>
                          <span className={styles.code}>{c.code}</span> {c.name}
                        </span>
                        <span className={`${styles.amount} ${styles.amountNegative}`}>
                          {money(c.amount)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {trail && trail.rows.length > 0 && (
            <>
              <h3 className={styles.trailSectionTitle}>
                {trail.rows.length} movement{trail.rows.length === 1 ? '' : 's'}
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.roleTable}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>#</th>
                      <th>What happened</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      {trail.rows.some((r) => r.runningBalance !== null) && (
                        <th style={{ textAlign: 'right' }}>Balance</th>
                      )}
                      <th>Document</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trail.rows.map((row, i) => (
                      <tr key={`${row.entryNo ?? 'x'}-${i}`}>
                        <td>{day(row.date)}</td>
                        <td>
                          {row.drill ? (
                            <button
                              type="button"
                              className={styles.trailCrumb}
                              onClick={() => onPush(row.drill!)}
                            >
                              <span className={styles.code}>{row.entryNo ?? 'view'}</span>
                            </button>
                          ) : (
                            <span className={styles.code}>{row.entryNo ?? '—'}</span>
                          )}
                        </td>
                        <td>
                          {row.label}
                          {row.party && (
                            <>
                              {' '}
                              <span className={styles.muted}>
                                · {PARTY_TYPE_LABELS[row.party.type]} {row.party.name}
                              </span>
                            </>
                          )}
                          {row.status === 'reversed' && (
                            <>
                              {' '}
                              <span className={`${styles.status} ${styles.status_reversed}`}>
                                reversed
                              </span>
                            </>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span
                            className={`${styles.amount} ${row.amount < 0 ? styles.amountNegative : ''}`}
                          >
                            {money(row.amount)}
                          </span>
                        </td>
                        {trail.rows.some((r) => r.runningBalance !== null) && (
                          <td style={{ textAlign: 'right' }}>
                            <span className={styles.amount}>
                              {row.runningBalance === null ? '—' : money(row.runningBalance)}
                            </span>
                          </td>
                        )}
                        <td>
                          {row.document ? (
                            row.document.href ? (
                              <Link className={styles.trailDocLink} href={row.document.href}>
                                {sourceTypeLabel(row.document.sourceType)}
                              </Link>
                            ) : (
                              // No screen for this kind of document. Named rather than linked —
                              // an unfiltered list page answers nothing.
                              <span
                                className={styles.trailDocPlain}
                                title="There is no screen for this kind of document yet"
                              >
                                {sourceTypeLabel(row.document.sourceType)}
                              </span>
                            )
                          ) : (
                            <span className={styles.trailDocPlain}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {trail && trail.rows.length === 0 && trail.parts.length === 0 && !trail.note && (
            <p className={styles.muted}>
              Nothing has been posted behind this figure for the period shown.
            </p>
          )}
        </div>
      </aside>
    </>
  );
};

export default TrailPanel;
