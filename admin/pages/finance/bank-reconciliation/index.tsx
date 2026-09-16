import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Table from '../../../components/UI/Table';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  bankReconciliationService,
  BankReconciliation,
  ReconcilableAccount,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import formStyles from '../../../styles/FormPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Bank reconciliation: pick an account, type in what the statement says, tick it off.
 *
 * The account cards lead, rather than the list of past reconciliations, because the question
 * somebody arrives with is "is the bank account checked up to date?" — not "what did we do in
 * March". An account that has never been reconciled says so in as many words.
 */

function money(value: number): string {
  return value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function day(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString('en-PK') : '—';
}

const BankReconciliationPage: React.FC = () => {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ReconcilableAccount[]>([]);
  const [rows, setRows] = useState<BankReconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('all');

  // The start form, shown only once an account has been chosen.
  const [ledgerId, setLedgerId] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [closingBalance, setClosingBalance] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountRows, list] = await Promise.all([
        bankReconciliationService.accounts(),
        bankReconciliationService.list({ status: status === 'all' ? undefined : status }),
      ]);
      setAccounts(accountRows);
      setRows(list);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the reconciliations');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const start = async () => {
    if (!ledgerId || !statementDate || closingBalance.trim() === '') {
      toast.error('Choose an account, the statement date, and the closing balance it shows.');
      return;
    }

    setBusy(true);
    try {
      const created = await bankReconciliationService.create({
        ledgerId,
        statementDate,
        statementClosingBalance: Number(closingBalance),
      });
      router.push(`/finance/bank-reconciliation/${created.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not start the reconciliation');
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'ledgerName',
      title: 'Account',
      render: (value: string, row: BankReconciliation) => (
        <div>
          <span className={styles.code}>{row.ledgerCode}</span> {value}
        </div>
      ),
    },
    { key: 'statementDate', title: 'Statement date', render: (v: string) => day(v) },
    {
      key: 'statementClosingBalance',
      title: 'Bank says',
      render: (v: number) => (
        <span className={`${styles.amount} ${v < 0 ? styles.amountNegative : ''}`}>{money(v)}</span>
      ),
    },
    {
      key: 'unclearedTotal',
      title: 'Still in flight',
      render: (v: number, row: BankReconciliation) =>
        row.status === 'completed' ? (
          <span className={`${styles.amount} ${v < 0 ? styles.amountNegative : ''}`}>
            {money(v)}
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string, row: BankReconciliation) => (
        <span
          className={`${styles.status} ${
            value === 'completed' ? styles.status_posted : styles.status_draft
          }`}
          title={row.reopenReason ? `Reopened: ${row.reopenReason}` : undefined}
        >
          {value === 'completed' ? 'Signed off' : 'In progress'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '',
      render: (_: unknown, row: BankReconciliation) => (
        <div className={listStyles.actions}>
          <button
            className={listStyles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/finance/bank-reconciliation/${row.id}`);
            }}
          >
            {row.status === 'completed' ? 'View' : 'Continue'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Bank Reconciliation</h1>
        </div>

        <FinanceNav />

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>What this screen is for</span>
          Your books and the bank almost never show the same figure on the same day, and that is
          normal — a deposit made on Friday may not land until Monday. Reconciling proves that
          every difference is one of those, and not a mistake or something nobody wrote down.
          <p className={styles.readonlyNote} style={{ marginBottom: 0 }}>
            Nothing here changes an amount. If the statement shows a charge the books have never
            heard of, record it as an expense — this screen will not invent an entry for it.
          </p>
        </div>

        {/* Accounts lead, because "is the bank checked up to date?" is the question people
            actually arrive with. */}
        <div className={styles.settingsGrid}>
          {accounts.map((account) => (
            <div key={account.ledgerId} className={styles.settingCard}>
              <span className={styles.settingLabel}>
                <span className={styles.code}>{account.code}</span> {account.name}
              </span>
              <span className={styles.settingValue}>{money(account.currentBalance)}</span>
              <p className={styles.readonlyNote} style={{ marginBottom: '0.5rem' }}>
                {account.lastStatementDate
                  ? `Checked up to ${day(account.lastStatementDate)}`
                  : 'Never reconciled'}
              </p>
              {account.openDraftId ? (
                <button
                  className={formStyles.submitButton}
                  onClick={() => router.push(`/finance/bank-reconciliation/${account.openDraftId}`)}
                >
                  Continue
                </button>
              ) : (
                can(undefined, 'finance-bank-rec:add') && (
                  <button
                    className={formStyles.cancelButton}
                    onClick={() => {
                      setLedgerId(account.ledgerId);
                      setStatementDate('');
                      setClosingBalance('');
                    }}
                  >
                    New statement
                  </button>
                )
              )}
            </div>
          ))}
        </div>

        {ledgerId && can(undefined, 'finance-bank-rec:add') && (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>
              New statement — {accounts.find((a) => a.ledgerId === ledgerId)?.name}
            </h2>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="statementDate">Statement date</label>
                <input
                  id="statementDate"
                  type="date"
                  className={formStyles.input}
                  value={statementDate}
                  disabled={busy}
                  onChange={(e) => setStatementDate(e.target.value)}
                />
                <p className={formStyles.hint}>
                  The closing date on the statement. Nothing dated after it belongs here.
                </p>
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="closingBalance">Closing balance the bank shows</label>
                <input
                  id="closingBalance"
                  type="number"
                  step="0.01"
                  className={formStyles.input}
                  value={closingBalance}
                  disabled={busy}
                  onChange={(e) => setClosingBalance(e.target.value)}
                  placeholder="0.00"
                />
                <p className={formStyles.hint}>
                  Exactly as printed. If the account is overdrawn, enter it as a negative.
                </p>
              </div>
            </div>

            <div className={formStyles.formActions}>
              <button className={formStyles.submitButton} disabled={busy} onClick={start}>
                Start ticking off
              </button>
              <button
                className={formStyles.cancelButton}
                disabled={busy}
                onClick={() => setLedgerId('')}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <select
                className={listStyles.searchSelect}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All reconciliations</option>
                <option value="draft">In progress</option>
                <option value="completed">Signed off</option>
              </select>
            </div>

            <Table
              columns={columns}
              data={rows}
              loading={loading}
              exportFileName="bank-reconciliations"
              exportPdfTitle="Bank Reconciliations"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function BankReconciliationPageWrapper() {
  return (
    <ProtectedRoute permission="finance-bank-rec:view">
      <BankReconciliationPage />
    </ProtectedRoute>
  );
}
