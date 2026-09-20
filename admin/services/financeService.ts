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
  /**
   * What is owed to this supplier now, from the ledger — so money paid on account already counts.
   * Negative means they owe us: an advance not yet used up.
   */
  payableBalance: number;
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

// ---------------------------------------------------------------------------
// Supplier bills
// ---------------------------------------------------------------------------

/** A goods receipt from this supplier that is not yet fully billed. */
export interface OpenReceipt {
  id: string;
  documentNo?: number;
  receiptDate: string;
  /** What was typed on the receipt on the day — kept, never overwritten by the supplier name. */
  typedName?: string;
  totalAmount: number;
  billedAmount: number;
  outstanding: number;
}

export interface Bill {
  id: string;
  billNo?: number;
  /** `B-0001`, or the word Draft. A draft carries no number until it is posted. */
  reference: string;
  vendorId: string;
  vendorName: string;
  supplierBillNo?: string;
  billDate: string;
  dueDate: string;
  goodsAmount: number;
  chargesAmount: number;
  taxAmount: number;
  totalAmount: number;
  status: 'draft' | 'posted' | 'cancelled';
  receiptCount: number;
  /** Settled by posted payments. Zero unless the bill is posted. */
  paidAmount: number;
  outstanding: number;
  /** Null unless posted — a draft or cancelled bill is not owed, so it is not "unpaid" either. */
  paymentStatus: BillPaymentStatus | null;
  /** Still owed and past its due date. A bill paid in full is never overdue. */
  isOverdue: boolean;
  journalEntryId?: string;
  notes?: string;
  createdAt: string;
}

export type BillPaymentStatus = 'unpaid' | 'part_paid' | 'paid';

export const BILL_PAYMENT_STATUS_LABELS: Record<BillPaymentStatus, string> = {
  unpaid: 'Unpaid',
  part_paid: 'Part paid',
  paid: 'Paid',
};

/** A posted payment that settled part of a bill. */
export interface BillPayment {
  paymentId: string;
  reference: string;
  paymentDate: string;
  method: PaymentMethod;
  amount: number;
}

export interface BillDetail extends Bill {
  payments: BillPayment[];
  matchedReceipts: {
    receiptId: string;
    documentNo?: number;
    receiptDate?: string;
    typedName?: string;
    receiptTotal: number;
    amount: number;
  }[];
  lines: {
    description: string;
    ledgerId: string;
    ledgerCode: string;
    ledgerName: string;
    amount: number;
  }[];
  cancelReason?: string;
}

export interface BillInput {
  vendorId: string;
  supplierBillNo?: string;
  billDate: string;
  dueDate?: string;
  matchedReceipts?: { receiptId: string; amount?: number }[];
  lines?: { description: string; ledgerId: string; amount: number }[];
  taxAmount?: number;
  notes?: string;
}

export const billService = {
  async list(filters: {
    vendorId?: string;
    status?: string;
    from?: string;
    to?: string;
    overdue?: boolean;
    search?: string;
  } = {}): Promise<Bill[]> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== false) params.append(k, String(v));
    });
    const response = await api.get(`/finance/bills?${params.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<BillDetail> {
    const response = await api.get(`/finance/bills/${id}`);
    return response.data;
  },

  /**
   * The receipts this supplier has outstanding.
   *
   * `billId` is passed when editing a draft, so the receipts that draft already claims stay on
   * the list instead of disappearing as already-billed the moment the form reopens.
   */
  async openReceipts(vendorId: string, billId?: string): Promise<OpenReceipt[]> {
    const query = billId ? `?billId=${billId}` : '';
    const response = await api.get(`/finance/bills/open-receipts/${vendorId}${query}`);
    return response.data;
  },

  async create(data: BillInput): Promise<BillDetail> {
    const response = await api.post('/finance/bills', data);
    return response.data;
  },

  async update(id: string, data: BillInput): Promise<BillDetail> {
    const response = await api.put(`/finance/bills/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/bills/${id}`);
    return response.data;
  },

  async post(id: string): Promise<BillDetail> {
    const response = await api.patch(`/finance/bills/${id}/post`);
    return response.data;
  },

  async cancel(id: string, reason: string): Promise<BillDetail> {
    const response = await api.patch(`/finance/bills/${id}/cancel`, { reason });
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Supplier payments
// ---------------------------------------------------------------------------

export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
};

/** A posted bill from this supplier that still has something unpaid. */
export interface OpenBill {
  id: string;
  reference: string;
  supplierBillNo?: string;
  billDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  isOverdue: boolean;
}

export interface Payment {
  id: string;
  paymentNo?: number;
  /** `P-0001`, or the word Draft. A payment carries no number until it is released. */
  reference: string;
  vendorId: string;
  vendorName: string;
  paymentDate: string;
  method: PaymentMethod;
  /** For a cheque, the bank account it is drawn on. */
  paidFromLedgerId: string;
  paidFromName: string;
  chequeNo?: string;
  chequeDate?: string;
  /** The day the cheque showed on the bank statement. */
  chequeClearedAt?: string;
  /** A released cheque that has not shown on the bank statement yet. */
  isChequeUncleared: boolean;
  transferReference?: string;
  /** The gross: what the supplier's invoice is settled by, before anything is withheld. */
  amount: number;
  /** Kept back from the supplier and owed on to the revenue office. */
  taxWithheldAmount: number;
  /** `amount` less the tax withheld — what actually left the account. */
  netPaid: number;
  allocatedAmount: number;
  /** Paid, but not set against any bill — held on account against the supplier. */
  unallocatedAmount: number;
  billCount: number;
  status: 'draft' | 'posted' | 'cancelled';
  journalEntryId?: string;
  notes?: string;
  createdAt: string;
}

export interface PaymentDetail extends Payment {
  allocations: {
    billId: string;
    reference: string;
    supplierBillNo?: string;
    billDate?: string;
    billTotal: number;
    amount: number;
  }[];
  cancelReason?: string;
}

export interface PaymentInput {
  vendorId: string;
  paymentDate: string;
  method: PaymentMethod;
  paidFromLedgerId: string;
  chequeNo?: string;
  chequeDate?: string;
  transferReference?: string;
  /** The gross — what the invoice is settled by, not what is handed over. */
  amount: number;
  /** A withholding rate to apply, or a figure. Never both; the server refuses both. */
  taxRateId?: string;
  taxWithheldAmount?: number;
  allocations?: { billId: string; amount?: number }[];
  notes?: string;
}

export const paymentService = {
  /**
   * Record that a cheque showed on the bank statement. `clearedOn` is the statement date, which
   * is when the bank balance actually moves.
   */
  async clearCheque(id: string, clearedOn: string): Promise<PaymentDetail> {
    const response = await api.patch(`/finance/payments/${id}/clear-cheque`, { clearedOn });
    return response.data;
  },

  async list(filters: {
    vendorId?: string;
    status?: string;
    method?: string;
    from?: string;
    to?: string;
    search?: string;
    /** Released cheques not yet on the bank statement. */
    unclearedCheques?: boolean;
  } = {}): Promise<Payment[]> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.append(k, String(v));
    });
    const response = await api.get(`/finance/payments?${params.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<PaymentDetail> {
    const response = await api.get(`/finance/payments/${id}`);
    return response.data;
  },

  /**
   * The supplier's bills with something unpaid, oldest due first.
   *
   * `paymentId` is passed when editing, so the bills that draft already settles stay listed
   * instead of reading as paid the moment the form reopens.
   */
  async openBills(vendorId: string, paymentId?: string): Promise<OpenBill[]> {
    const query = paymentId ? `?paymentId=${paymentId}` : '';
    const response = await api.get(`/finance/payments/open-bills/${vendorId}${query}`);
    return response.data;
  },

  async create(data: PaymentInput): Promise<PaymentDetail> {
    const response = await api.post('/finance/payments', data);
    return response.data;
  },

  async update(id: string, data: PaymentInput): Promise<PaymentDetail> {
    const response = await api.put(`/finance/payments/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/payments/${id}`);
    return response.data;
  },

  /** Release: post it to the accounts. */
  async post(id: string): Promise<PaymentDetail> {
    const response = await api.patch(`/finance/payments/${id}/post`);
    return response.data;
  },

  async cancel(id: string, reason: string): Promise<PaymentDetail> {
    const response = await api.patch(`/finance/payments/${id}/cancel`, { reason });
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseStatus = 'draft' | 'pending_approval' | 'rejected' | 'posted' | 'cancelled';

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  rejected: 'Sent back',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

export interface ExpenseCategory {
  id: string;
  name: string;
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  /** Every expense in the category waits for a second person. */
  requiresApproval: boolean;
  /** Expenses above this wait for approval even if the category otherwise goes straight through. */
  approvalAbove: number | null;
  requiresReceipt: boolean;
  isActive: boolean;
  notes?: string;
  expenseCount: number;
}

export interface ExpenseCategoryInput {
  name?: string;
  ledgerId?: string;
  requiresApproval?: boolean;
  approvalAbove?: number | null;
  requiresReceipt?: boolean;
  isActive?: boolean;
  notes?: string;
}

export interface Expense {
  id: string;
  expenseNo?: number;
  /** `E-0001`, or the word Draft. The number is used only when the expense posts. */
  reference: string;
  categoryId: string;
  categoryName: string;
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  expenseDate: string;
  description: string;
  payeeName?: string;
  vendorId?: string;
  vendorName?: string;
  warehouseId?: string;
  warehouseName?: string;
  cityKey?: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  method: PaymentMethod;
  paidFromLedgerId: string;
  paidFromName: string;
  chequeNo?: string;
  chequeDate?: string;
  chequeClearedAt?: string;
  isChequeUncleared: boolean;
  transferReference?: string;
  attachments: string[];
  status: ExpenseStatus;
  /** Why it has to wait for approval, in words — or null when it goes straight through. */
  approvalNeeded: string | null;
  receiptRequired: boolean;
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  journalEntryId?: string;
  cancelReason?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

export interface ExpenseInput {
  categoryId: string;
  expenseDate: string;
  description: string;
  amount: number;
  taxAmount?: number;
  method: PaymentMethod;
  paidFromLedgerId: string;
  chequeNo?: string;
  chequeDate?: string;
  transferReference?: string;
  vendorId?: string;
  payeeName?: string;
  warehouseId?: string;
  attachments?: string[];
  notes?: string;
}

export interface ExpenseSummary {
  rows: {
    categoryId: string;
    categoryName: string;
    count: number;
    amount: number;
    taxAmount: number;
  }[];
  amount: number;
  taxAmount: number;
  count: number;
}

export const expenseCategoryService = {
  async list(status: 'active' | 'inactive' | 'all' = 'active'): Promise<ExpenseCategory[]> {
    const response = await api.get(`/finance/expense-categories?status=${status}`);
    return response.data;
  },

  async create(data: ExpenseCategoryInput): Promise<ExpenseCategory> {
    const response = await api.post('/finance/expense-categories', data);
    return response.data;
  },

  async update(id: string, data: ExpenseCategoryInput): Promise<ExpenseCategory> {
    const response = await api.put(`/finance/expense-categories/${id}`, data);
    return response.data;
  },
};

export const expenseService = {
  async list(filters: {
    status?: string;
    categoryId?: string;
    method?: string;
    from?: string;
    to?: string;
    search?: string;
    unclearedCheques?: boolean;
  } = {}): Promise<Expense[]> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.append(k, String(v));
    });
    const response = await api.get(`/finance/expenses?${params.toString()}`);
    return response.data;
  },

  async summary(range: { from?: string; to?: string } = {}): Promise<ExpenseSummary> {
    const params = new URLSearchParams();
    if (range.from) params.append('from', range.from);
    if (range.to) params.append('to', range.to);
    const response = await api.get(`/finance/expenses/summary?${params.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<Expense> {
    const response = await api.get(`/finance/expenses/${id}`);
    return response.data;
  },

  async create(data: ExpenseInput): Promise<Expense> {
    const response = await api.post('/finance/expenses', data);
    return response.data;
  },

  async update(id: string, data: ExpenseInput): Promise<Expense> {
    const response = await api.put(`/finance/expenses/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/expenses/${id}`);
    return response.data;
  },

  /** Posts it now, or queues it for approval — the category decides which. */
  async submit(id: string): Promise<Expense> {
    const response = await api.patch(`/finance/expenses/${id}/submit`);
    return response.data;
  },

  async approve(id: string): Promise<Expense> {
    const response = await api.patch(`/finance/expenses/${id}/approve`);
    return response.data;
  },

  async reject(id: string, reason: string): Promise<Expense> {
    const response = await api.patch(`/finance/expenses/${id}/reject`, { reason });
    return response.data;
  },

  async cancel(id: string, reason: string): Promise<Expense> {
    const response = await api.patch(`/finance/expenses/${id}/cancel`, { reason });
    return response.data;
  },

  async clearCheque(id: string, clearedOn: string): Promise<Expense> {
    const response = await api.patch(`/finance/expenses/${id}/clear-cheque`, { clearedOn });
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

export interface StatementLine {
  ledgerId: string;
  code: string;
  name: string;
  amount: number;
  compare?: number;
}

export interface StatementSection {
  groupId: string;
  code: string;
  name: string;
  lines: StatementLine[];
  sections: StatementSection[];
  total: number;
  compareTotal?: number;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  fiscalYear: string;
  compareFrom?: string;
  compareTo?: string;
  income: StatementSection[];
  incomeTotal: number;
  costOfSales: StatementSection[];
  costOfSalesTotal: number;
  grossProfit: number;
  operatingExpenses: StatementSection[];
  operatingExpensesTotal: number;
  netProfit: number;
  compare: {
    incomeTotal: number;
    costOfSalesTotal: number;
    grossProfit: number;
    operatingExpensesTotal: number;
    netProfit: number;
  } | null;
  warnings: string[];
}

export interface BalanceSheet {
  asOf: string;
  fiscalYear: string;
  fiscalYearStart: string;
  assets: StatementSection[];
  totalAssets: number;
  liabilities: StatementSection[];
  totalLiabilities: number;
  equity: StatementSection[];
  equityAccountsTotal: number;
  profitBroughtForward: number;
  profitThisYear: number;
  totalEquity: number;
  balanced: boolean;
  difference: number;
  warnings: string[];
}

export const statementService = {
  async profitAndLoss(params: {
    from?: string;
    to?: string;
    compare?: boolean;
    showZero?: boolean;
  } = {}): Promise<ProfitAndLoss> {
    const q = new URLSearchParams();
    if (params.from) q.append('from', params.from);
    if (params.to) q.append('to', params.to);
    if (params.compare) q.append('compare', 'true');
    if (params.showZero) q.append('showZero', 'true');
    const response = await api.get(`/finance/reports/profit-and-loss?${q.toString()}`);
    return response.data;
  },

  async balanceSheet(params: { asOf?: string; showZero?: boolean } = {}): Promise<BalanceSheet> {
    const q = new URLSearchParams();
    if (params.asOf) q.append('asOf', params.asOf);
    if (params.showZero) q.append('showZero', 'true');
    const response = await api.get(`/finance/reports/balance-sheet?${q.toString()}`);
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Ageing and party statements
// ---------------------------------------------------------------------------

export interface AgeingBucket {
  label: string;
  from: number;
  to: number | null;
}

export interface ReceivablesAgeing {
  asOf: string;
  buckets: AgeingBucket[];
  rows: {
    dealerId: string;
    name: string;
    shopName?: string;
    phone?: string;
    city?: string;
    total: number;
    amounts: number[];
    oldestDay?: string;
  }[];
  bucketTotals: number[];
  totalOwed: number;
  inCredit: { dealerId: string; name: string; shopName?: string; amount: number }[];
  totalInCredit: number;
  netReceivable: number;
}

export interface PayablesAgeing {
  asOf: string;
  buckets: AgeingBucket[];
  rows: {
    vendorId: string;
    name: string;
    notDue: number;
    overdue: number[];
    onAccount: number;
    total: number;
    ledgerBalance: number;
    agrees: boolean;
    oldestDueDate?: string;
  }[];
  totals: {
    notDue: number;
    overdue: number[];
    onAccount: number;
    total: number;
    ledgerBalance: number;
  };
  disagreements: number;
}

export type PartyType = 'dealer' | 'vendor';

export interface PartyStatement {
  party: { type: PartyType; id: string; name: string; detail?: string };
  ledgerCode: string;
  ledgerName: string;
  from?: string;
  to?: string;
  opening: number;
  closing: number;
  rows: {
    date: string;
    day: string;
    entryId: string;
    entryNo: number | null;
    referenceNo: string | null;
    narration: string;
    sourceType: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  truncated: boolean;
}

export const partyReportService = {
  async receivablesAgeing(asOf?: string): Promise<ReceivablesAgeing> {
    const q = asOf ? `?asOf=${asOf}` : '';
    const response = await api.get(`/finance/reports/receivables-ageing${q}`);
    return response.data;
  },

  async payablesAgeing(): Promise<PayablesAgeing> {
    const response = await api.get('/finance/reports/payables-ageing');
    return response.data;
  },

  async parties(type: PartyType): Promise<{ id: string; name: string; detail?: string }[]> {
    const response = await api.get(`/finance/reports/parties?type=${type}`);
    return response.data;
  },

  async statement(params: { type: PartyType; id: string; from?: string; to?: string }): Promise<PartyStatement> {
    const q = new URLSearchParams({ type: params.type, id: params.id });
    if (params.from) q.append('from', params.from);
    if (params.to) q.append('to', params.to);
    const response = await api.get(`/finance/reports/party-statement?${q.toString()}`);
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Cash flow and cash & bank
// ---------------------------------------------------------------------------

export interface CashFlowSection {
  /** Positive: cash came in from that account. Negative: cash went out to it. */
  rows: { ledgerId: string; code: string; name: string; amount: number }[];
  total: number;
}

export interface CashFlow {
  from: string;
  to: string;
  cashAccounts: { ledgerId: string; code: string; name: string; opening: number; closing: number }[];
  openingCash: number;
  closingCash: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
  reconciles: boolean;
  difference: number;
  warnings: string[];
}

export interface CashPosition {
  from: string;
  to: string;
  accounts: {
    ledgerId: string;
    code: string;
    name: string;
    opening: number;
    moneyIn: number;
    moneyOut: number;
    closing: number;
  }[];
  totals: { opening: number; moneyIn: number; moneyOut: number; closing: number };
  unclearedCheques: number;
  availableAfterCheques: number;
}

export const cashReportService = {
  async cashFlow(params: { from?: string; to?: string } = {}): Promise<CashFlow> {
    const q = new URLSearchParams();
    if (params.from) q.append('from', params.from);
    if (params.to) q.append('to', params.to);
    const response = await api.get(`/finance/reports/cash-flow?${q.toString()}`);
    return response.data;
  },

  async cashPosition(params: { from?: string; to?: string } = {}): Promise<CashPosition> {
    const q = new URLSearchParams();
    if (params.from) q.append('from', params.from);
    if (params.to) q.append('to', params.to);
    const response = await api.get(`/finance/reports/cash-position?${q.toString()}`);
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Payroll and staff advances
// ---------------------------------------------------------------------------

export interface PayrollLine {
  userId: string;
  name: string;
  role?: string;
  salary: number;
  bonus: number;
  allowance: number;
  gross: number;
  advanceRecovery: number;
  fineRecovery: number;
  net: number;
  /** What they still owe in advances — the cap on what this month can take back. */
  advanceBalance: number;
  /** What they still owe in late-start fines — the cap on what this month can take off. */
  fineBalance: number;
}

export interface PayrollPayment {
  paidOn: string;
  amount: number;
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: string;
  reference?: string;
  journalEntryId: string;
}

export interface PayrollRun {
  id: string;
  period: string;
  /** "July 2025". */
  periodLabel: string;
  status: 'draft' | 'posted' | 'cancelled';
  employeeCount: number;
  totals: {
    salary: number;
    bonus: number;
    allowance: number;
    gross: number;
    advanceRecovery: number;
    fineRecovery: number;
    net: number;
  };
  paidAmount: number;
  outstanding: number;
  accrualEntryId?: string;
  payments: PayrollPayment[];
  cancelReason?: string;
  notes?: string;
  createdAt: string;
}

export interface PayrollRunDetail extends PayrollRun {
  lines: PayrollLine[];
}

export interface PayrollLineInput {
  userId: string;
  salary?: number;
  bonus?: number;
  allowance?: number;
  advanceRecovery?: number;
  fineRecovery?: number;
}

export interface StaffAdvance {
  id: string;
  advanceNo?: number;
  reference: string;
  userId: string;
  name: string;
  advanceDate: string;
  amount: number;
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: string;
  paymentReference?: string;
  reason?: string;
  status: 'draft' | 'posted' | 'cancelled';
  journalEntryId?: string;
  cancelReason?: string;
  /** Everything this employee still owes, across every advance. */
  employeeBalance: number;
  createdAt: string;
}

export interface StaffAdvanceInput {
  userId: string;
  advanceDate: string;
  amount: number;
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: string;
  reference?: string;
  reason?: string;
}

export const payrollService = {
  async listRuns(status?: string): Promise<PayrollRun[]> {
    const q = status ? `?status=${status}` : '';
    const response = await api.get(`/finance/payroll/runs${q}`);
    return response.data;
  },

  async getRun(id: string): Promise<PayrollRunDetail> {
    const response = await api.get(`/finance/payroll/runs/${id}`);
    return response.data;
  },

  /** Starts the month, pre-filled from what each employee is paid. */
  async createRun(period: string): Promise<PayrollRunDetail> {
    const response = await api.post('/finance/payroll/runs', { period });
    return response.data;
  },

  async updateRun(
    id: string,
    body: { lines?: PayrollLineInput[]; notes?: string },
  ): Promise<PayrollRunDetail> {
    const response = await api.put(`/finance/payroll/runs/${id}`, body);
    return response.data;
  },

  async removeRun(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/payroll/runs/${id}`);
    return response.data;
  },

  async postRun(id: string): Promise<PayrollRunDetail> {
    const response = await api.patch(`/finance/payroll/runs/${id}/post`);
    return response.data;
  },

  async payRun(
    id: string,
    body: {
      paidOn: string;
      amount: number;
      method: 'cash' | 'bank_transfer';
      paidFromLedgerId: string;
      reference?: string;
    },
  ): Promise<PayrollRunDetail> {
    const response = await api.post(`/finance/payroll/runs/${id}/payments`, body);
    return response.data;
  },

  async cancelRun(id: string, reason: string): Promise<PayrollRunDetail> {
    const response = await api.patch(`/finance/payroll/runs/${id}/cancel`, { reason });
    return response.data;
  },

  /** Active employees with what each already owes — the advance form's list. */
  async employees(): Promise<{ id: string; name: string; role?: string; salary: number; owed: number }[]> {
    const response = await api.get('/finance/payroll/employees');
    return response.data;
  },

  async listAdvances(filters: { status?: string; userId?: string } = {}): Promise<StaffAdvance[]> {
    const q = new URLSearchParams();
    if (filters.status) q.append('status', filters.status);
    if (filters.userId) q.append('userId', filters.userId);
    const response = await api.get(`/finance/payroll/advances?${q.toString()}`);
    return response.data;
  },

  async advanceBalances(): Promise<{ userId: string; name: string; owed: number }[]> {
    const response = await api.get('/finance/payroll/advances/balances');
    return response.data;
  },

  async createAdvance(body: StaffAdvanceInput): Promise<StaffAdvance> {
    const response = await api.post('/finance/payroll/advances', body);
    return response.data;
  },

  async updateAdvance(id: string, body: StaffAdvanceInput): Promise<StaffAdvance> {
    const response = await api.put(`/finance/payroll/advances/${id}`, body);
    return response.data;
  },

  async removeAdvance(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/payroll/advances/${id}`);
    return response.data;
  },

  async postAdvance(id: string): Promise<StaffAdvance> {
    const response = await api.patch(`/finance/payroll/advances/${id}/post`);
    return response.data;
  },

  async cancelAdvance(id: string, reason: string): Promise<StaffAdvance> {
    const response = await api.patch(`/finance/payroll/advances/${id}/cancel`, { reason });
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

/** A cash or bank account, and how far its statements have been checked off. */
export interface ReconcilableAccount {
  ledgerId: string;
  code: string;
  name: string;
  currentBalance: number;
  lastStatementDate: string | null;
  lastReconciledAt: string | null;
  /** A reconciliation already in progress on this account, if there is one. */
  openDraftId: string | null;
}

/** One line on the account, waiting to be ticked off against the statement. */
export interface WorksheetLine {
  lineId: string;
  date: string;
  entryNo: number | null;
  entryId: string;
  referenceNo: string | null;
  narration: string;
  sourceType: string;
  debit: number;
  credit: number;
  /** Signed the way the account runs: positive puts money in, negative takes it out. */
  effect: number;
  cleared: boolean;
}

export interface BankReconciliation {
  id: string;
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  statementDate: string;
  statementClosingBalance: number;
  status: 'draft' | 'completed';
  /** What our books say the account held on the statement date. */
  bookBalance: number;
  clearedTotal: number;
  /** Recorded by us, not yet seen by the bank. */
  unclearedTotal: number;
  /** What the bank ought to be showing if every unticked item is simply still in flight. */
  expectedStatementBalance: number;
  difference: number;
  balances: boolean;
  clearedCount: number;
  unclearedCount: number;
  notes?: string;
  completedAt?: string;
  reopenReason?: string;
  createdAt: string;
}

export interface BankReconciliationDetail extends BankReconciliation {
  lines: WorksheetLine[];
  truncated: boolean;
}

export interface BankReconciliationInput {
  ledgerId: string;
  statementDate: string;
  statementClosingBalance: number;
  notes?: string;
}

export const bankReconciliationService = {
  async accounts(): Promise<ReconcilableAccount[]> {
    const response = await api.get('/finance/bank-reconciliation/accounts');
    return response.data;
  },

  async list(
    filters: { ledgerId?: string; status?: string } = {},
  ): Promise<BankReconciliation[]> {
    const q = new URLSearchParams();
    if (filters.ledgerId) q.append('ledgerId', filters.ledgerId);
    if (filters.status) q.append('status', filters.status);
    const response = await api.get(`/finance/bank-reconciliation?${q.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<BankReconciliationDetail> {
    const response = await api.get(`/finance/bank-reconciliation/${id}`);
    return response.data;
  },

  async create(body: BankReconciliationInput): Promise<BankReconciliationDetail> {
    const response = await api.post('/finance/bank-reconciliation', body);
    return response.data;
  },

  async update(
    id: string,
    body: { statementClosingBalance?: number; notes?: string },
  ): Promise<BankReconciliationDetail> {
    const response = await api.put(`/finance/bank-reconciliation/${id}`, body);
    return response.data;
  },

  /** Ticks a batch on or off — a whole statement page in one request, not one line at a time. */
  async setLines(
    id: string,
    lineIds: string[],
    cleared: boolean,
  ): Promise<BankReconciliationDetail> {
    const response = await api.patch(`/finance/bank-reconciliation/${id}/lines`, {
      lineIds,
      cleared,
    });
    return response.data;
  },

  async complete(id: string): Promise<BankReconciliationDetail> {
    const response = await api.patch(`/finance/bank-reconciliation/${id}/complete`);
    return response.data;
  },

  async reopen(id: string, reason: string): Promise<BankReconciliationDetail> {
    const response = await api.patch(`/finance/bank-reconciliation/${id}/reopen`, { reason });
    return response.data;
  },

  async remove(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/bank-reconciliation/${id}`);
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Opening balances — the changeover
// ---------------------------------------------------------------------------

export type MigrationStage = 'not-started' | 'balances-entered' | 'complete';

export interface MigrationStatus {
  stage: MigrationStage;
  booksOpenedAt: string | null;
  cutoverDate: string | null;
  openingEntryId: string | null;
  openingEntryNo: number | null;
  /** While this is not zero the changeover is unfinished. That zero is the proof. */
  openingEquityBalance: number;
  openingEquityCode: string;
  closingEntryId: string | null;
}

export interface OpeningWorksheetRow {
  ledgerId: string;
  code: string;
  name: string;
  groupName: string;
  accountType: AccountType;
  isDebitNatured: boolean;
  /** Positive means the account's own direction: an asset held, a liability owed. */
  amount: number;
  editable: boolean;
  /** Why it cannot be typed here, or where the figure comes from instead. */
  note?: string;
}

export interface OpeningWorksheet {
  status: MigrationStatus;
  rows: OpeningWorksheetRow[];
  totalDebits: number;
  totalCredits: number;
  /** What the business was worth at changeover — everything owned less everything owed. */
  openingEquity: number;
}

export interface OpeningEntryResult {
  entryId: string;
  entryNo?: number;
  totalDebit: number;
  totalCredit: number;
  openingEquity: number;
  status: MigrationStatus;
}

export const openingBalanceService = {
  async status(): Promise<MigrationStatus> {
    const response = await api.get('/finance/opening-balances/status');
    return response.data;
  },

  async worksheet(): Promise<OpeningWorksheet> {
    const response = await api.get('/finance/opening-balances/worksheet');
    return response.data;
  },

  async save(entries: { ledgerId: string; amount: number }[]): Promise<OpeningWorksheet> {
    const response = await api.put('/finance/opening-balances/worksheet', { entries });
    return response.data;
  },

  async post(cutoverDate: string, narration?: string): Promise<OpeningEntryResult> {
    const response = await api.post('/finance/opening-balances/post', {
      cutoverDate,
      narration,
    });
    return response.data;
  },

  async closeEquity(toLedgerId: string): Promise<MigrationStatus> {
    const response = await api.post('/finance/opening-balances/close-equity', { toLedgerId });
    return response.data;
  },

  async reopen(reason: string): Promise<OpeningWorksheet> {
    const response = await api.post('/finance/opening-balances/reopen', { reason });
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Tax summary
// ---------------------------------------------------------------------------

/** One supplier's purchases in the period — a line on the purchase side of a return. */
export interface TaxPartyRow {
  vendorId: string | null;
  name: string;
  taxRegistrationNo?: string;
  documentCount: number;
  /** What the goods or services cost before tax. */
  taxableAmount: number;
  taxAmount: number;
  /** False when there is no tax number, which is what stops a line being filed. */
  filable: boolean;
}

export interface TaxSummary {
  from: string;
  to: string;
  /** Tax paid on purchases, from the accounts. Claimable. */
  inputTax: number;
  /** Tax charged on sales, from the accounts. Owed onward. */
  outputTax: number;
  /** Positive is payable to the revenue office, negative is reclaimable. */
  net: number;
  inputTaxCode: string;
  outputTaxCode: string;
  purchases: TaxPartyRow[];
  purchasesTaxTotal: number;
  /** Withheld from suppliers. Reported apart and NEVER part of `net` — see the report. */
  taxWithheld: number;
  withheldTaxCode: string;
  /** Accounts less documents. Anything but nil has to be explained before filing. */
  unattributedInputTax: number;
  warnings: string[];
}

export const taxReportService = {
  async summary(params: { from?: string; to?: string } = {}): Promise<TaxSummary> {
    const q = new URLSearchParams();
    if (params.from) q.append('from', params.from);
    if (params.to) q.append('to', params.to);
    const response = await api.get(`/finance/reports/tax-summary?${q.toString()}`);
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Tax rates
// ---------------------------------------------------------------------------

/**
 * `sales` is tax charged TO a customer; `withholding` is tax deducted FROM a supplier when they
 * are paid. Opposite in almost every respect, which is why one screen never offers the other.
 */
export type TaxRateKind = 'sales' | 'withholding';

export const TAX_RATE_KIND_LABELS: Record<TaxRateKind, string> = {
  sales: 'Charged on sales',
  withholding: 'Withheld from suppliers',
};

export interface TaxRate {
  id: string;
  name: string;
  kind: TaxRateKind;
  /** A percentage, not a multiplier: 17, 4.5, 0.25. */
  percentage: number;
  notes?: string;
  isActive: boolean;
  /** Posted documents citing it. Above zero it can be retired but never deleted. */
  usageCount: number;
}

export interface TaxRateInput {
  name: string;
  kind: TaxRateKind;
  percentage: number;
  notes?: string;
}

export const taxRateService = {
  async list(
    filters: { kind?: TaxRateKind; status?: string } = {},
  ): Promise<TaxRate[]> {
    const q = new URLSearchParams();
    if (filters.kind) q.append('kind', filters.kind);
    if (filters.status) q.append('status', filters.status);
    const response = await api.get(`/finance/tax-rates?${q.toString()}`);
    return response.data;
  },

  async create(body: TaxRateInput): Promise<TaxRate> {
    const response = await api.post('/finance/tax-rates', body);
    return response.data;
  },

  async update(id: string, body: Partial<TaxRateInput>): Promise<TaxRate> {
    const response = await api.put(`/finance/tax-rates/${id}`, body);
    return response.data;
  },

  async setStatus(id: string, isActive: boolean): Promise<TaxRate> {
    const response = await api.patch(`/finance/tax-rates/${id}/status`, { isActive });
    return response.data;
  },

  async remove(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/tax-rates/${id}`);
    return response.data;
  },
};

// ---------------------------------------------------------------------------
// Vouchers — the six manual documents
// ---------------------------------------------------------------------------

export type VoucherCategory = 'CPV' | 'CRV' | 'BPV' | 'BRV' | 'CV' | 'JV';

export const VOUCHER_CATEGORIES: VoucherCategory[] = ['CPV', 'CRV', 'BPV', 'BRV', 'CV', 'JV'];

export const VOUCHER_CATEGORY_LABELS: Record<VoucherCategory, string> = {
  CPV: 'Cash Payment Voucher',
  CRV: 'Cash Receipt Voucher',
  BPV: 'Bank Payment Voucher',
  BRV: 'Bank Receipt Voucher',
  CV: 'Contra — money between our own accounts',
  JV: 'Journal Voucher',
};

/** What each one is actually for, in the words the person filling it in would use. */
export const VOUCHER_CATEGORY_HELP: Record<VoucherCategory, string> = {
  CPV: 'Cash paid out of the office cash box — a refund to a shop, money drawn by the owner, a tax bill settled in cash.',
  CRV: 'Cash taken in at the office — a shop paying at the counter, capital put in, a loan received in cash.',
  BPV: 'Money leaving a bank account by cheque or transfer.',
  BRV: 'Money arriving in a bank account.',
  CV: 'Our own money moving between our own cash and bank accounts. Nothing is earned, spent, owed or collected.',
  JV: 'A correction or a month-end adjustment. It balances, it moves no money, and it touches no control account.',
};

export type ContraSubtype = 'bank_deposit' | 'cash_withdrawal' | 'bank_to_bank' | 'cash_to_cash';

export const CONTRA_SUBTYPES: ContraSubtype[] = [
  'bank_deposit',
  'cash_withdrawal',
  'bank_to_bank',
  'cash_to_cash',
];

export const CONTRA_SUBTYPE_LABELS: Record<ContraSubtype, string> = {
  bank_deposit: 'Cash deposited into the bank',
  cash_withdrawal: 'Cash drawn from the bank',
  bank_to_bank: 'Between two bank accounts',
  cash_to_cash: 'Between two cash accounts',
};

export type VoucherStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'posted'
  | 'cancelled';

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved, not posted',
  rejected: 'Sent back',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

export interface VoucherLine {
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  debit: number;
  credit: number;
  narration?: string;
  partyName?: string;
}

export interface Voucher {
  id: string;
  voucherNo?: number;
  /** `CPV-0001` once posted, `Draft` until then — numbers are allocated at posting. */
  reference: string;
  category: VoucherCategory;
  categoryLabel: string;
  subtype?: ContraSubtype;
  voucherDate: string;
  narration: string;
  /** The cheque number, slip number or challan — not the voucher's own reference. */
  paymentReference?: string;
  attachments: string[];
  partyType?: 'dealer';
  partyId?: string;
  partyName?: string;
  amount: number;
  status: VoucherStatus;
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
  journalEntryId?: string;
  cancelReason?: string;
  createdBy?: string;
  createdAt: string;
  lines: VoucherLine[];
}

export interface VoucherInput {
  category: VoucherCategory;
  subtype?: ContraSubtype;
  voucherDate: string;
  narration: string;
  reference?: string;
  attachments?: string[];
  cashBankLedgerId?: string;
  counterLedgerId?: string;
  partyType?: 'dealer';
  partyId?: string;
  amount?: number;
  fromLedgerId?: string;
  toLedgerId?: string;
  lines?: { ledgerId: string; debit?: number; credit?: number; narration?: string }[];
}

export const voucherService = {
  async list(
    filters: {
      category?: VoucherCategory;
      status?: VoucherStatus | 'all';
      from?: string;
      to?: string;
      partyId?: string;
      search?: string;
    } = {},
  ): Promise<Voucher[]> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.append(k, String(v));
    });
    const response = await api.get(`/finance/vouchers?${params.toString()}`);
    return response.data;
  },

  /** The shop picker, behind the voucher permission rather than the Clients one. */
  async shops(search?: string): Promise<{ id: string; name: string; shopName?: string }[]> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    const response = await api.get(`/finance/vouchers/shops?${params.toString()}`);
    return response.data;
  },

  async get(id: string): Promise<Voucher> {
    const response = await api.get(`/finance/vouchers/${id}`);
    return response.data;
  },

  async create(data: VoucherInput): Promise<Voucher> {
    const response = await api.post('/finance/vouchers', data);
    return response.data;
  },

  async update(id: string, data: VoucherInput): Promise<Voucher> {
    const response = await api.put(`/finance/vouchers/${id}`, data);
    return response.data;
  },

  async remove(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/finance/vouchers/${id}`);
    return response.data;
  },

  async submit(id: string): Promise<Voucher> {
    const response = await api.patch(`/finance/vouchers/${id}/submit`);
    return response.data;
  },

  async approve(id: string): Promise<Voucher> {
    const response = await api.patch(`/finance/vouchers/${id}/approve`);
    return response.data;
  },

  async reject(id: string, reason: string): Promise<Voucher> {
    const response = await api.patch(`/finance/vouchers/${id}/reject`, { reason });
    return response.data;
  },

  /** Approval and posting are separate acts: this is the one that writes to the accounts. */
  async post(id: string): Promise<Voucher> {
    const response = await api.patch(`/finance/vouchers/${id}/post`);
    return response.data;
  },

  async cancel(id: string, reason: string): Promise<Voucher> {
    const response = await api.patch(`/finance/vouchers/${id}/cancel`, { reason });
    return response.data;
  },
};
