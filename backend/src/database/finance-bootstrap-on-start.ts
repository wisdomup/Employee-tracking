import { LedgerModel } from '../models/ledger.model';
import { seedFinanceChart } from './seeds/finance-chart.seed';
import { verifyLedgerMap } from '../modules/finance/chart.service';
import { seedFinanceCounters } from '../modules/finance/finance-counters';
import { completeInterruptedPostings } from '../modules/finance/posting.service';

/**
 * Make sure the chart of accounts and the engine's ledger map exist before anything tries to
 * post against them.
 *
 * Follows `access-bootstrap-on-start.ts`, and for a similar reason: a fresh database, a restored
 * backup taken before this feature, or a dropped collection would otherwise leave the finance
 * module resolving every engine role to nothing. Unlike the permission matrix, that fails loudly
 * rather than silently — but it fails at the first posting, in production, hours after the
 * deploy that caused it.
 *
 * After the first run this costs one indexed `countDocuments` and returns.
 *
 * Existing groups and ledgers are never overwritten: `seedFinanceChart` matches on code and
 * skips. An accountant's renamed account survives every redeploy. The ledger map is the one
 * thing repaired on every run, because a role pointing at a deleted account is the single state
 * that stops the module working.
 *
 * Env:
 *   FINANCE_BOOTSTRAP_ON_START=false   skip entirely
 */
function parseBoolEnv(value: string | undefined, defaultTrue: boolean): boolean {
  if (value === undefined || value === '') return defaultTrue;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

export async function runFinanceBootstrapOnStart(): Promise<void> {
  if (!parseBoolEnv(process.env.FINANCE_BOOTSTRAP_ON_START, true)) {
    console.log('Finance bootstrap skipped (FINANCE_BOOTSTRAP_ON_START=false)');
    return;
  }

  try {
    await seedFinanceCounters();

    const existing = await LedgerModel.countDocuments().exec();
    if (existing === 0) {
      const result = await seedFinanceChart();
      console.log(
        `[finance-bootstrap] Seeded the chart of accounts: `
          + `${result.groupsCreated.length} groups, ${result.ledgersCreated.length} ledgers, `
          + `${result.rolesMapped} engine roles mapped`,
      );
    }

    // Expense categories: seeded only on a database that has none, so a category an accountant
    // renamed or retired is never recreated behind them on the next deploy. Loaded lazily so the
    // expense module is not pulled in before the chart it points at exists.
    const { seedDefaultExpenseCategories } = await import('../modules/finance/expenses.service');
    const categories = await seedDefaultExpenseCategories();
    if (categories.created.length > 0) {
      console.log(
        `[finance-bootstrap] Seeded ${categories.created.length} expense categories: `
          + categories.created.join(', '),
      );
    }

    // The one gap the transaction-free posting design leaves: a process that died between
    // writing an entry's lines and stamping its header. The balances and every report are
    // already correct — the Day Book reads headers, so the entry would just be missing from it.
    const swept = await completeInterruptedPostings();
    if (swept.completed > 0) {
      console.log(
        `[finance-bootstrap] Completed ${swept.completed} posting(s) interrupted before the `
          + 'header was stamped. Balances were already correct; the entries are now visible in '
          + 'the day book.',
      );
    }

    const health = await verifyLedgerMap();
    if (!health.ok) {
      // Deliberately a loud warning rather than a thrown error. Refusing to boot would take the
      // whole application down — orders, visits, collections — over a finance misconfiguration
      // that only affects finance. The posting service in the next step refuses individual
      // postings on the same check, which is where the failure belongs.
      console.warn(
        '[finance-bootstrap] The engine ledger map has problems. Posting will refuse until '
          + `they are fixed:\n  - ${health.problems.join('\n  - ')}`,
      );
    }
  } catch (err) {
    console.error('[finance-bootstrap] Failed:', err);
  }
}
