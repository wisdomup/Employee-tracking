import api from './api';

/**
 * Accounts & Finance — chart of accounts, journal entries, periods and the ledger reports.
 *
 * Two exported objects rather than one: `financeService` is the chart, `journalService` is
 * everything the posting engine exposes. They are separate because they are gated by different
 * matrix rows and used by different screens.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export type SubledgerType = 'dealer' | 'vendor' | 'rider' | 'warehouse' | 'employee';

export const ACCOUNT_TYPES: AccountType[] = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
];

/** What each type means in plain words, for the create and edit forms. */
export const ACCOUNT_TYPE_HELP: Record<AccountType, string> = {
  asset: 'Something the business owns — cash, stock, money customers owe you.',
  liability: 'Something the business owes — suppliers, tax, loans.',
  equity: "The owner's stake, including profit kept in the business.",
  income: 'Money earned — sales, service charges.',
  expense: 'Money spent running the business, and the cost of the goods sold.',
};

export const SUBLEDGER_LABELS: Record<SubledgerType, string> = {
  dealer: 'Per client / shop',
  vendor: 'Per supplier',
  rider: 'Per rider',
  warehouse: 'Per warehouse',
  employee: 'Per employee',
};

/**
 * The block each type's codes must fall in. Mirrors `finance.rules.ts` on the server, which
 * remains the authority — this exists so the form can say what is wanted BEFORE the request,
 * not so the browser can decide.
 */
export const CODE_BLOCK_HINT: Record<AccountType, string> = {
  asset: '1000–1999',
  liability: '2000–2999',
  equity: '3000–3999',
  income: '4000–4999',
  expense: '5000–6999',
};

export interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  accountType: AccountType;
  parentGroupId?: string | null;
  depth: number;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
}

export interface Ledger {
  id: string;
  code: string;
  name: string;
  description?: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  accountType: AccountType;
  /** Derived on the server from the account type. Never editable. */
  normalBalance: 'debit' | 'credit';
  openingBalance: { amount: number; asOf: string | null };
  cachedBalance: number;
  /** Balance in the account's own direction. Negative means it is sitting the wrong way round. */
  naturalBalance: number;
  isControl: boolean;
  subledgerType: SubledgerType | null;
  isCashEquivalent: boolean;
  isSystem: boolean;
  isActive: boolean;
  lastReconciledAt?: string;
  lastReconcileDrift?: number;
}

export interface LedgerFilters {
  groupId?: string;
  accountType?: AccountType;
  isControl?: boolean;
  isCashEquivalent?: boolean;
  status?: 'active' | 'inactive' | 'all';
  search?: string;
}

export interface FinanceSettings {
  fiscalYearStartMonth: number;
  baseCurrency: string;
  currencySymbol: string;
  agingBuckets: number[];
  booksOpenedAt: string | null;
  cutoverDate: string | null;
  roles: Record<string, { ledgerId: string; code?: string; name?: string } | null>;
  postingEnabled: Record<string, boolean>;
}

export const financeService = {
  async getGroups(): Promise<AccountGroup[]> {
    const response = await api.get('/finance/chart/groups');
    return response.data;
  },

  async createGroup(data: {
    name: string;
    code: string;
    accountType?: AccountType;
    parentGroupId?: string | null;
    sortOrder?: number;
  }) {
    const response = await api.post('/finance/chart/groups', data);
    return response.data;
  },

  async updateGroup(
    id: string,
    data: { name?: string; code?: string; accountType?: AccountType; sortOrder?: number },
  ) {
    const response = await api.patch(`/finance/chart/groups/${id}`, data);
    return response.data;
  },

  async setGroupStatus(id: string, isActive: boolean) {
    const response = await api.patch(`/finance/chart/groups/${id}/status`, { isActive });
    return response.data;
  },

  async deleteGroup(id: string) {
    const response = await api.delete(`/finance/chart/groups/${id}`);
    return response.data;
  },

  async getLedgers(filters: LedgerFilters = {}): Promise<Ledger[]> {
    const params = new URLSearchParams();
    if (filters.groupId) params.append('groupId', filters.groupId);
    if (filters.accountType) params.append('accountType', filters.accountType);
    // Only send a boolean when one was chosen. An absent filter must stay absent, or the
    // unfiltered list quietly hides every control account.
    if (filters.isControl !== undefined) params.append('isControl', String(filters.isControl));
    if (filters.isCashEquivalent !== undefined) {
      params.append('isCashEquivalent', String(filters.isCashEquivalent));
    }
    if (filters.status) params.append('status', filters.status);
    if (filters.search) params.append('search', filters.search);
    const response = await api.get(`/finance/chart/ledgers?${params.toString()}`);
    return response.data;
  },

  async getLedger(id: string): Promise<Ledger> {
    const response = await api.get(`/finance/chart/ledgers/${id}`);
    return response.data;
  },

  async suggestCode(accountType: AccountType): Promise<string> {
    const response = await api.get(
      `/finance/chart/ledgers/next-code?accountType=${accountType}`,
    );
    return response.data.code;
  },

  async createLedger(data: {
    name: string;
    code?: string;
    groupId: string;
    description?: string;
    openingBalance?: { amount: number; asOf: string | null };
    isControl?: boolean;
    subledgerType?: SubledgerType | null;
    isCashEquivalent?: boolean;
  }): Promise<Ledger> {
    const response = await api.post('/finance/chart/ledgers', data);
    return response.data;
  },

  async updateLedger(id: string, data: Record<string, unknown>): Promise<Ledger> {
    const response = await api.patch(`/finance/chart/ledgers/${id}`, data);
    return response.data;
  },

  async setLedgerStatus(id: string, isActive: boolean): Promise<Ledger> {
    const response = await api.patch(`/finance/chart/ledgers/${id}/status`, { isActive });
    return response.data;
  },

  async deleteLedger(id: string) {
    const response = await api.delete(`/finance/chart/ledgers/${id}`);
    return response.data;
  },

  async getSettings(): Promise<FinanceSettings> {
    const response = await api.get('/finance/settings');
    return response.data;
  },

  async getHealth(): Promise<{ ok: boolean; problems: string[] }> {
    const response = await api.get('/finance/settings/health');
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Journal entries, periods and the ledger reports
// ---------------------------------------------------------------------------

export type EntryStatus = 'draft' | 'posted' | 'reversed' | 'void';

export interface JournalLine {
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  debit: number;
  credit: number;
  lineNarration?: string;
  balanceAfter?: number;
}

export interface JournalEntry {
  _id: string;
  entryNo?: number;
  date: string;
  postingPeriod: string;
  referenceNo?: string;
  narration?: string;
  sourceType: string;
  status: EntryStatus;
  isSystemGenerated: boolean;
  totalDebit: number;
  totalCredit: number;
  postedAt?: string;
  reversalOf?: string;
  reversedByEntryId?: string;
  reversalReason?: string;
  lines?: JournalLine[];
  /** Present on the detail read: whether the entry's month still accepts postings. */
  canPost?: boolean;
  postBlockedReason?: string;
  periodStatus?: string;
}

export interface DraftLineInput {
  ledgerId: string;
  debit?: number;
  credit?: number;
  lineNarration?: string;
}

export type PeriodStatus = 'open' | 'closed' | 'locked';

export interface FinancialPeriod {
  _id: string;
  period: string;
  fiscalYear: string;
  status: PeriodStatus;
  closedAt?: string;
  reopenedAt?: string;
  reopenReason?: string;
}

export interface CloseCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface TrialBalanceRow {
  ledgerId: string;
  code: string;
  name: string;
  groupName: string;
  accountType: AccountType;
  closingDebit: number;
  closingCredit: number;
}

export const journalService = {
  async list(filters: {
    status?: string;
    sourceType?: string;
    period?: string;
    from?: string;
    to?: string;
    search?: string;
    limit?: number;
    skip?: number;
  } = {}): Promise<{ entries: JournalEntry[]; total: number }> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.append(k, String(v));
    });
    const response = await api.get(`/finance/journal?${params.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<JournalEntry> {
    const response = await api.get(`/finance/journal/${id}`);
    return response.data;
  },

  async createDraft(data: {
    date: string;
    narration: string;
    referenceNo?: string;
    lines: DraftLineInput[];
  }): Promise<JournalEntry> {
    const response = await api.post('/finance/journal', data);
    return response.data;
  },

  async updateDraft(id: string, data: Record<string, unknown>): Promise<JournalEntry> {
    const response = await api.patch(`/finance/journal/${id}`, data);
    return response.data;
  },

  async deleteDraft(id: string) {
    const response = await api.delete(`/finance/journal/${id}`);
    return response.data;
  },

  async post(id: string): Promise<JournalEntry> {
    const response = await api.patch(`/finance/journal/${id}/post`);
    return response.data;
  },

  async reverse(id: string, reason: string, date?: string) {
    const response = await api.post(`/finance/journal/${id}/reverse`, { reason, date });
    return response.data;
  },

  async trialBalance(asOf?: string) {
    const q = asOf ? `?asOf=${asOf}` : '';
    const response = await api.get(`/finance/reports/trial-balance${q}`);
    return response.data;
  },

  async ledgerStatement(ledgerId: string, filters: { from?: string; to?: string } = {}) {
    const params = new URLSearchParams();
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    const response = await api.get(
      `/finance/reports/ledger-statement/${ledgerId}?${params.toString()}`,
    );
    return response.data;
  },

  async dayBook(from: string, to?: string) {
    const params = new URLSearchParams({ from });
    if (to) params.append('to', to);
    const response = await api.get(`/finance/reports/day-book?${params.toString()}`);
    return response.data;
  },

  async listPeriods(fiscalYear?: string): Promise<FinancialPeriod[]> {
    const q = fiscalYear ? `?fiscalYear=${fiscalYear}` : '';
    const response = await api.get(`/finance/periods${q}`);
    return response.data;
  },

  async periodChecks(period: string): Promise<{ period: string; checks: CloseCheck[] }> {
    const response = await api.get(`/finance/periods/${period}/checks`);
    return response.data;
  },

  async openPeriod(period: string) {
    const response = await api.post('/finance/periods/open', { period });
    return response.data;
  },

  async openFiscalYear(fiscalYear: string) {
    const response = await api.post('/finance/periods/open-year', { fiscalYear });
    return response.data;
  },

  async closePeriod(period: string) {
    const response = await api.post('/finance/periods/close', { period });
    return response.data;
  },

  async reopenPeriod(period: string, reason: string) {
    const response = await api.post('/finance/periods/reopen', { period, reason });
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Finance health
// ---------------------------------------------------------------------------

export interface ControlCheck {
  checkId: string;
  label: string;
  ledgerCode: string;
  ledgerBalance: number;
  operationalValue: number;
  drift: number;
  ok: boolean;
  breakdown: Record<string, number>;
  note?: string;
}

export interface PostingSwitch {
  event: string;
  label: string;
  enabled: boolean;
}

export interface PostingFailure {
  id: string;
  event: string;
  sourceType: string;
  sourceId: string | null;
  lastError: string;
  attempts: number;
  lastAttemptAt: string;
  resolved: boolean;
}

export const healthService = {
  async controls(refresh = false): Promise<{
    day: string;
    checks: ControlCheck[];
    ok: boolean;
    failing: number;
  }> {
    const response = await api.get(`/finance/health/controls${refresh ? '?refresh=true' : ''}`);
    return response.data;
  },

  async history(checkId: string, days = 30) {
    const response = await api.get(
      `/finance/health/controls/${checkId}/history?days=${days}`,
    );
    return response.data;
  },

  async switches(): Promise<PostingSwitch[]> {
    const response = await api.get('/finance/health/posting-switches');
    return response.data;
  },

  async setSwitch(event: string, enabled: boolean) {
    const response = await api.patch(`/finance/health/posting-switches/${event}`, { enabled });
    return response.data;
  },

  async failures(includeResolved = false): Promise<PostingFailure[]> {
    const response = await api.get(
      `/finance/health/failed-postings${includeResolved ? '?includeResolved=true' : ''}`,
    );
    return response.data;
  },

  async retryFailures(): Promise<{ retried: number; recovered: number }> {
    const response = await api.post('/finance/health/failed-postings/retry');
    return response.data;
  },
};

/** Write off a rider cash shortfall. Lives on the collections API, gated on finance-writeoff. */
export async function writeOffRiderCash(body: {
  riderId: string;
  mode: 'cash' | 'online';
  amount: number;
  reason: string;
}) {
  const response = await api.post('/collections/settlements/write-off', body);
  return response.data;
}

/**
 * Plain words for every way an entry can come to exist.
 *
 * Complete on purpose. The list started as a handful and the rest fell through to the raw enum
 * value, so screens were showing `stock_count_adjustment` and `settlement_variance` to people
 * whose job is not reading enums. Anything missing here shows its identifier, which is a bug,
 * not a fallback.
 */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: 'Typed by hand',
  opening_balance: 'Opening balance',

  order_delivery: 'Sale on delivery',
  order_cogs: 'Cost of goods',
  collection: 'Money collected at delivery',
  collection_correction: 'Collection corrected',
  collection_void: 'Collection cancelled',
  credit_recovery: 'Old credit recovered',
  credit_recovery_correction: 'Recovery corrected',

  settlement_received: 'Rider handed money over',
  settlement_variance: 'Rider cash written off',

  stock_receipt: 'Stock received from a supplier',
  stock_receipt_reversal: 'Stock receipt cancelled',
  customer_return: 'Goods returned by a shop',
  damage_claim: 'Damaged stock written off',
  transfer_out: 'Stock sent to another warehouse',
  transfer_in: 'Stock received from another warehouse',
  transfer_shrinkage: 'Stock lost in transfer',
  stock_count_adjustment: 'Stock count correction',

  invoice: 'Service invoice',
  bill: 'Supplier bill',
  payment_received: 'Payment received',
  payment_made: 'Payment made',
  expense: 'Expense',
  payroll_accrual: 'Salaries',
  bad_debt_writeoff: 'Debt written off',
  year_end_close: 'Year-end close',
};

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}

export interface SourceEntryLine {
  ledgerCode: string;
  ledgerName: string;
  debit: number;
  credit: number;
}

export interface SourceEntry {
  id: string;
  entryNo: number | null;
  date: string;
  narration: string;
  sourceType: string;
  status: string;
  totalDebit: number;
  totalCredit: number;
  reversedByEntryId: string | null;
  reversalOf: string | null;
  lines: SourceEntryLine[];
}

/** Every entry a delivery, receipt or other document produced. */
export async function entriesForSource(
  sourceId: string,
): Promise<{ entries: SourceEntry[]; totalDebit: number }> {
  const response = await api.get(`/finance/journal/by-source/${sourceId}`);
  return response.data;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface Vendor {
  id: string;
  code: number;
  reference: string;
  name: string;
  phone?: string;
  email?: string;
  taxRegistrationNo?: string;
  paymentTermsDays: number;
  openingBalance: { amount: number; asOf: string | null };
  /** The typed names on goods receipts that were attached to this supplier. */
  mergedFromNames: string[];
  isPlaceholder: boolean;
  isActive: boolean;
  notes?: string;
  receiptCount: number;
  receiptValue: number;
}

export interface SupplierCandidate {
  typedName: string;
  receiptCount: number;
  totalValue: number;
  firstSeen: string;
  lastSeen: string;
  resolvedTo?: { id: string; name: string };
  suggestions: { id: string; name: string }[];
}

export interface MigrationProgress {
  totalReceipts: number;
  linkedReceipts: number;
  unlinkedReceipts: number;
  onPlaceholder: number;
  vendorCount: number;
  complete: boolean;
}

export const vendorService = {
  async list(filters: { search?: string; status?: string } = {}): Promise<Vendor[]> {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.status) params.append('status', filters.status);
    const response = await api.get(`/finance/vendors?${params.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<Vendor> {
    const response = await api.get(`/finance/vendors/${id}`);
    return response.data;
  },

  async create(data: Record<string, unknown>): Promise<Vendor> {
    const response = await api.post('/finance/vendors', data);
    return response.data;
  },

  async update(id: string, data: Record<string, unknown>): Promise<Vendor> {
    const response = await api.patch(`/finance/vendors/${id}`, data);
    return response.data;
  },

  async setStatus(id: string, isActive: boolean): Promise<Vendor> {
    const response = await api.patch(`/finance/vendors/${id}/status`, { isActive });
    return response.data;
  },

  async remove(id: string) {
    const response = await api.delete(`/finance/vendors/${id}`);
    return response.data;
  },

  async candidates(): Promise<{ candidates: SupplierCandidate[]; unnamedReceipts: number }> {
    const response = await api.get('/finance/vendors/migration/candidates');
    return response.data;
  },

  async progress(): Promise<MigrationProgress> {
    const response = await api.get('/finance/vendors/migration/progress');
    return response.data;
  },

  async assign(body: { vendorId?: string; newVendorName?: string; typedNames: string[] }) {
    const response = await api.post('/finance/vendors/migration/assign', body);
    return response.data;
  },

  async parkUnassigned() {
    const response = await api.post('/finance/vendors/migration/park-unassigned');
    return response.data;
  },
};
