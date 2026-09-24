import { can, canViewReport } from './permissions';

/**
 * Which parts of the finance module a person can open — the one answer every entry point uses.
 *
 * The sidebar, the `/finance` landing page, the tab bar and the Reports page each used to decide
 * this for themselves, and they disagreed: the sidebar and the landing page both required the Chart
 * of Accounts, so someone granted only the journal or only a report had no way in at all, and the
 * landing page's redirect for exactly those people could never run. Someone holding only the health
 * check was sent to a Reports page that had nothing for them and then failed to load a report they
 * could not open. Deriving all four from this list is what stops that recurring.
 */

/** The reports that are tabs on `/finance/reports`. Health and money trails are not among them. */
export const FINANCE_REPORT_TAB_IDS = [
  'finance.profit-and-loss',
  'finance.balance-sheet',
  'finance.receivables-ageing',
  'finance.payables-ageing',
  'finance.party-statement',
  'finance.cash-flow',
  'finance.cash-position',
  'finance.tax-summary',
  'finance.trial-balance',
  'finance.ledger-statement',
  'finance.day-book',
] as const;

export interface FinanceTab {
  href: string;
  label: string;
  /** Shown when the person holds ANY of these. */
  permissions?: string[];
  /** Shown when the person may open ANY of these reports. */
  reportIds?: readonly string[];
}

export const FINANCE_TABS: FinanceTab[] = [
  { href: '/finance/journal', label: 'Journal', permissions: ['finance-journal:view'] },
  { href: '/finance/health', label: 'Health', reportIds: ['finance.health'] },
  // Health has its own tab and page, so it must NOT also satisfy the Reports tab — someone granted
  // only the health check would otherwise be offered a Reports page with nothing on it.
  { href: '/finance/reports', label: 'Reports', reportIds: FINANCE_REPORT_TAB_IDS },
  { href: '/finance/chart', label: 'Chart of Accounts', permissions: ['finance-coa:view'] },
  { href: '/finance/vendors', label: 'Suppliers', permissions: ['finance-vendors:view'] },
  { href: '/finance/bills', label: 'Bills', permissions: ['finance-bills:view'] },
  { href: '/finance/payments', label: 'Payments', permissions: ['finance-payments:view'] },
  { href: '/finance/expenses', label: 'Expenses', permissions: ['finance-expenses:view'] },
  { href: '/finance/vouchers', label: 'Vouchers', permissions: ['finance-vouchers:view'] },
  { href: '/finance/payroll', label: 'Payroll', permissions: ['finance-payroll:view'] },
  {
    href: '/finance/bank-reconciliation',
    label: 'Bank Reconciliation',
    permissions: ['finance-bank-rec:view'],
  },
  {
    href: '/finance/registers',
    label: 'Reversals & Write-offs',
    permissions: ['finance-reversal:view', 'finance-writeoff:view'],
  },
  { href: '/finance/tax-rates', label: 'Tax Rates', permissions: ['finance-tax-rates:view'] },
  { href: '/finance/periods', label: 'Periods', permissions: ['finance-period:view'] },
  {
    href: '/finance/opening-balances',
    label: 'Opening Balances',
    permissions: ['finance-opening:view'],
  },
  { href: '/finance/settings', label: 'Settings', permissions: ['finance-coa:view'] },
];

export function canOpenFinanceTab(tab: FinanceTab): boolean {
  if (tab.reportIds) return tab.reportIds.some((id) => canViewReport(id));
  if (tab.permissions) return tab.permissions.some((key) => can(undefined, key));
  return false;
}

export function visibleFinanceTabs(): FinanceTab[] {
  return FINANCE_TABS.filter(canOpenFinanceTab);
}

/** Whether the module belongs in the sidebar at all, and whether `/finance` should let them in. */
export function canOpenFinance(): boolean {
  return visibleFinanceTabs().length > 0;
}

/** Whether the Reports page has at least one tab for this person. */
export function canViewAnyFinanceReportTab(): boolean {
  return FINANCE_REPORT_TAB_IDS.some((id) => canViewReport(id));
}

