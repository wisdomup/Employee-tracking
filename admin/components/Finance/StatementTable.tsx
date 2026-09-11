import React from 'react';
import { StatementSection } from '../../services/financeService';
import styles from '../../styles/Finance.module.scss';

/**
 * The body of a financial statement: groups, their accounts, and their totals, nested the way the
 * chart of accounts is.
 *
 * Negative figures are shown in brackets, the way a printed statement shows them, rather than with
 * a minus sign that is easy to miss in a column of numbers.
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
}

const Section: React.FC<{
  section: StatementSection;
  depth: number;
  showCompare: boolean;
  onLedger?: (ledgerId: string) => void;
}> = ({ section, depth, showCompare, onLedger }) => {
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
            <span className={`${styles.amount} ${line.amount < 0 ? styles.amountNegative : ''}`}>
              {statementMoney(line.amount)}
            </span>
          </td>
          {showCompare && (
            <td style={{ textAlign: 'right' }}>
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
        />
      ))}

      <tr>
        <td style={{ ...indent, fontStyle: 'italic' }}>Total {section.name}</td>
        <td style={{ textAlign: 'right', borderTop: '1px solid #e5e7eb' }}>
          <span className={styles.amount}>{statementMoney(section.total)}</span>
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

const StatementTable: React.FC<Props> = ({ sections, showCompare = false, onLedger }) => (
  <>
    {sections.map((section) => (
      <Section
        key={section.groupId}
        section={section}
        depth={0}
        showCompare={showCompare}
        onLedger={onLedger}
      />
    ))}
  </>
);

export default StatementTable;
