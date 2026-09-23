import React from 'react';
import { StatementSection, TrailRef } from '../../services/financeService';
import TrailAmount from './TrailAmount';
import styles from '../../styles/Finance.module.scss';

/**
 * The body of a financial statement: groups, their accounts, and their totals, nested the way the
 * chart of accounts is.
 *
 * Negative figures are shown in brackets, the way a printed statement shows them, rather than with
 * a minus sign that is easy to miss in a column of numbers.
 *
 * Every figure here is a click target. The account name stays a link as well — it was the only one
 * before and people will have learned it — but the amount is the one that matters: the question is
 * always asked of the number, not of the label beside it. A group subtotal opens the accounts under
 * it, one level at a time, so the structure the reader is navigating by stays visible.
 */

export function statementMoney(value: number | undefined): string {
  if (value === undefined) return '';
  if (Math.abs(value) < 0.005) return '—';
  const text = Math.abs(value).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${text})` : text;
}

interface Props {
  sections: StatementSection[];
  showCompare?: boolean;
  /** Click-through to an account's statement. */
  onLedger?: (ledgerId: string) => void;
  /** Opens the back-trail panel. */
  onTrail?: (ref: TrailRef) => void;
  /**
   * The window the statement covers, as days.
   *
   * Passed in rather than derived here: a P&L covers a range of months and a Balance Sheet is a
   * position at one date, and only the caller knows which it is looking at.
   */
  window?: { from?: string; to?: string };
}

const Section: React.FC<{
  section: StatementSection;
  depth: number;
  showCompare: boolean;
  onLedger?: (ledgerId: string) => void;
  onTrail?: (ref: TrailRef) => void;
  window?: { from?: string; to?: string };
}> = ({ section, depth, showCompare, onLedger, onTrail, window }) => {
  const indent = { paddingLeft: `${0.5 + depth * 1.1}rem` };

  return (
    <>
      <tr>
        <td colSpan={showCompare ? 3 : 2} style={{ ...indent, fontWeight: 600 }}>
          {section.name}
        </td>
      </tr>

      {section.lines.map((line) => (
        <tr key={line.ledgerId}>
          <td style={{ paddingLeft: `${1.6 + depth * 1.1}rem` }}>
            {onLedger ? (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onLedger(line.ledgerId);
                }}
              >
                <span className={styles.code}>{line.code}</span> {line.name}
              </a>
            ) : (
              <>
                <span className={styles.code}>{line.code}</span> {line.name}
              </>
            )}
          </td>
          <td style={{ textAlign: 'right' }}>
            <TrailAmount
              value={line.amount}
              trail={{ kind: 'ledger', ledgerId: line.ledgerId, from: window?.from, to: window?.to }}
              onOpen={onTrail}
              format={statementMoney}
              title={`What makes up ${line.name}`}
            />
          </td>
          {showCompare && (
            <td style={{ textAlign: 'right' }}>
              {/*
                The comparison column is inert on purpose. Its figures belong to a different window
                from the one the page is showing, and a trail opened from here would silently be
                about those other months — the kind of wrong answer nobody checks.
              */}
              <span className={`${styles.amount} ${styles.muted}`}>{statementMoney(line.compare)}</span>
            </td>
          )}
        </tr>
      ))}

      {section.sections.map((child) => (
        <Section
          key={child.groupId}
          section={child}
          depth={depth + 1}
          showCompare={showCompare}
          onLedger={onLedger}
          onTrail={onTrail}
          window={window}
        />
      ))}

      <tr>
        <td style={{ ...indent, fontStyle: 'italic' }}>Total {section.name}</td>
        <td style={{ textAlign: 'right', borderTop: '1px solid #e5e7eb' }}>
          <TrailAmount
            value={section.total}
            trail={{ kind: 'group', groupId: section.groupId, from: window?.from, to: window?.to }}
            onOpen={onTrail}
            format={statementMoney}
            title={`The accounts that make up ${section.name}`}
          />
        </td>
        {showCompare && (
          <td style={{ textAlign: 'right', borderTop: '1px solid #e5e7eb' }}>
            <span className={`${styles.amount} ${styles.muted}`}>
              {statementMoney(section.compareTotal)}
            </span>
          </td>
        )}
      </tr>
    </>
  );
};

const StatementTable: React.FC<Props> = ({
  sections,
  showCompare = false,
  onLedger,
  onTrail,
  window,
}) => (
  <>
    {sections.map((section) => (
      <Section
        key={section.groupId}
        section={section}
        depth={0}
        showCompare={showCompare}
        onLedger={onLedger}
        onTrail={onTrail}
        window={window}
      />
    ))}
  </>
);

export default StatementTable;
