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
