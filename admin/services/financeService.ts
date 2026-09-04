import api from './api';

/**
 * Accounts & Finance — chart of accounts.
 *
 * Journal entries, periods and the posting engine arrive in a later step and will extend this
 * file rather than replace it.
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
