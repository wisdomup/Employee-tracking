import React from 'react';
import { CashFlow, CashFlowSection, CashPosition } from '../../services/financeService';
import { statementMoney } from './StatementTable';
import styles from '../../styles/Finance.module.scss';

/**
 * The two cash reports, rendered.
 *
 * Kept out of the reports page itself so that page stays a list of tabs rather than growing into
 * one enormous file, and because both are read the same way: money in is a plain figure, money
 * out is in brackets.
 */

function monthName(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' });
}

function dayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PK');
}

const FlowSection: React.FC<{
  title: string;
  hint: string;
  section: CashFlowSection;
  onLedger?: (ledgerId: string) => void;
}> = ({ title, hint, section, onLedger }) => (
  <>
    <tr>
      <td colSpan={2} style={{ fontWeight: 600, paddingTop: '0.9rem' }}>
        {title}
        <div className={styles.muted} style={{ fontSize: '0.76rem', fontWeight: 400 }}>{hint}</div>
      </td>
    </tr>
    {section.rows.length === 0 && (
      <tr>
        <td colSpan={2} className={styles.muted} style={{ paddingLeft: '1.6rem' }}>Nothing moved.</td>
      </tr>
    )}
    {section.rows.map((r) => (
      <tr key={r.ledgerId}>
        <td style={{ paddingLeft: '1.6rem' }}>
          {onLedger ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onLedger(r.ledgerId);
              }}
            >
              <span className={styles.code}>{r.code}</span> {r.name}
            </a>
          ) : (
            <>
              <span className={styles.code}>{r.code}</span> {r.name}
            </>
          )}
        </td>
        <td style={{ textAlign: 'right' }}>
          <span className={`${styles.amount} ${r.amount < 0 ? styles.amountNegative : ''}`}>
            {statementMoney(r.amount)}
          </span>
        </td>
      </tr>
    ))}
    <tr>
      <td style={{ fontStyle: 'italic' }}>Net cash from {title.toLowerCase()}</td>
      <td style={{ textAlign: 'right', borderTop: '1px solid #e5e7eb' }}>
        <span className={styles.amount} style={{ fontWeight: 600 }}>{statementMoney(section.total)}</span>
      </td>
    </tr>
  </>
);

export const CashFlowReport: React.FC<{ report: CashFlow; onLedger?: (ledgerId: string) => void }> = ({
  report,
  onLedger,
}) => (
  <>
    <div className={`${styles.banner} ${report.netChange >= 0 ? styles.bannerOk : styles.bannerBad}`}>
      <span className={styles.bannerTitle}>
        Cash {report.netChange >= 0 ? 'went up' : 'went down'} by {statementMoney(Math.abs(report.netChange))}
      </span>
      {monthName(report.from)}
      {report.from !== report.to ? ` to ${monthName(report.to)}` : ''}: from{' '}
      {statementMoney(report.openingCash)} to {statementMoney(report.closingCash)} across the office cash and
      bank accounts.
    </div>

    {!report.reconciles && (
      <div className={`${styles.banner} ${styles.bannerBad}`}>
        <span className={styles.bannerTitle}>
          The flows do not add up to the change in cash — out by {statementMoney(Math.abs(report.difference))}
        </span>
        This should not be possible through normal use. Run the trial balance before relying on this report.
      </div>
    )}

    {report.warnings.map((w) => (
      <div key={w} className={`${styles.banner} ${styles.bannerBad}`}>
        <span className={styles.bannerTitle}>Check this first</span>
        {w}
      </div>
    ))}

    <div style={{ overflowX: 'auto' }}>
      <table className={styles.roleTable}>
        <tbody>
          <tr>
            <td style={{ fontWeight: 600 }}>Cash at the start</td>
            <td style={{ textAlign: 'right' }}>
              <span className={styles.amount} style={{ fontWeight: 600 }}>{statementMoney(report.openingCash)}</span>
            </td>
          </tr>

          <FlowSection
            title="Operating"
            hint="Selling, collecting, buying stock, paying bills and running costs."
            section={report.operating}
            onLedger={onLedger}
          />
          <FlowSection
            title="Investing"
            hint="Buying or selling things the business keeps — vehicles, equipment."
            section={report.investing}
            onLedger={onLedger}
          />
          <FlowSection
            title="Financing"
            hint="Money put in or taken out by the owner, and loans taken or repaid."
            section={report.financing}
            onLedger={onLedger}
          />
        </tbody>
        <tfoot>
          <tr className={styles.reportTotals}>
            <td>Net change in cash</td>
            <td style={{ textAlign: 'right' }}>
              <span className={styles.amount}>{statementMoney(report.netChange)}</span>
            </td>
          </tr>
          <tr className={styles.reportTotals}>
            <td>Cash at the end</td>
            <td style={{ textAlign: 'right' }}>
              <span className={styles.amount}>{statementMoney(report.closingCash)}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p className={styles.readonlyNote}>
      Each figure is the cash that moved against that account. A transfer between the office cash and the
      bank changes nothing here, because the business&apos;s cash did not change; a cheque counts on the day it
      clears, not the day it was written; and money a rider is still carrying is not cash until it is
      handed over.
    </p>
  </>
);

export const CashPositionReport: React.FC<{ report: CashPosition; onLedger?: (ledgerId: string) => void }> = ({
  report,
  onLedger,
}) => (
  <>
    <div className={styles.settingsGrid}>
      <div className={styles.settingCard}>
        <span className={styles.settingLabel}>Cash and bank on {dayName(report.to)}</span>
        <span className={styles.settingValue}>{statementMoney(report.totals.closing)}</span>
      </div>
      <div className={styles.settingCard}>
        <span className={styles.settingLabel}>Cheques written, not yet cleared</span>
        <span className={styles.settingValue}>{statementMoney(report.unclearedCheques)}</span>
      </div>
      <div className={styles.settingCard}>
        <span className={styles.settingLabel}>Left once they clear</span>
        <span
          className={styles.settingValue}
          style={report.availableAfterCheques < 0 ? { color: '#b91c1c' } : undefined}
        >
          {statementMoney(report.availableAfterCheques)}
        </span>
      </div>
    </div>

    {report.availableAfterCheques < 0 && (
      <div className={`${styles.banner} ${styles.bannerBad}`}>
        <span className={styles.bannerTitle}>More has been written in cheques than there is to cover them</span>
        If every outstanding cheque is presented, the accounts would be overdrawn by{' '}
        {statementMoney(Math.abs(report.availableAfterCheques))}.
      </div>
    )}

    <div style={{ overflowX: 'auto' }}>
      <table className={styles.roleTable}>
        <thead>
          <tr>
            <th>Account</th>
            <th style={{ textAlign: 'right' }}>On {dayName(report.from)}</th>
            <th style={{ textAlign: 'right' }}>Money in</th>
            <th style={{ textAlign: 'right' }}>Money out</th>
            <th style={{ textAlign: 'right' }}>On {dayName(report.to)}</th>
          </tr>
        </thead>
        <tbody>
          {report.accounts.map((a) => (
            <tr key={a.ledgerId}>
              <td>
                {onLedger ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onLedger(a.ledgerId);
                    }}
                  >
                    <span className={styles.code}>{a.code}</span> {a.name}
                  </a>
                ) : (
                  <>
                    <span className={styles.code}>{a.code}</span> {a.name}
                  </>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className={styles.amount}>{statementMoney(a.opening)}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className={styles.amount}>{statementMoney(a.moneyIn)}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className={styles.amount}>{statementMoney(a.moneyOut)}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className={`${styles.amount} ${a.closing < 0 ? styles.amountNegative : ''}`}>
                  {statementMoney(a.closing)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.reportTotals}>
            <td>Total</td>
            <td style={{ textAlign: 'right' }}>
              <span className={styles.amount}>{statementMoney(report.totals.opening)}</span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <span className={styles.amount}>{statementMoney(report.totals.moneyIn)}</span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <span className={styles.amount}>{statementMoney(report.totals.moneyOut)}</span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <span className={styles.amount}>{statementMoney(report.totals.closing)}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p className={styles.readonlyNote}>
      Money in and out includes transfers between these accounts, so the columns are what each account
      itself saw. Uncleared cheques are still in the bank balance above — the bank has not paid them yet.
    </p>
  </>
);
