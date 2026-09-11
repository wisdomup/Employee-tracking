import { Types } from 'mongoose';
import { ExpenseCategoryModel, IExpenseCategory } from '../../models/expense-category.model';
import { ExpenseModel, IExpense, ExpenseStatus, EXPENSE_STATUSES } from '../../models/expense.model';
import { PaymentMethod, PAYMENT_METHODS } from '../../models/supplier-payment.model';
import { LedgerModel } from '../../models/ledger.model';
import { AccountGroupModel } from '../../models/account-group.model';
import { VendorModel } from '../../models/vendor.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { localDayKey } from '../region-sales/region-sales.rules';
import { allocateNextFinanceNo } from './finance-counters';
import { round2, MONEY_EPSILON, buildIdempotencyKey } from './finance.rules';
import { postEntry, reverseEntry, ledgerIdForRole } from './posting.service';
import { withFinanceLocks } from './finance-locks';
import { loadPaidFromAccount, assertChequeLeafUnused } from './money-out';

/**
 * Expenses, and the categories that decide how they are approved.
 *
 * ## The rule that matters
 *
 * Nothing reaches the accounts until it is either approved by a second person or its category
 * says it does not need to be. Everything below that looks like ceremony — the self-approval
 * refusal, re-checking at approval, the lock — protects that one rule. An approval process that
 * the submitter can satisfy alone is a form with an extra button.
 */

function pad(no: number): string {
  return String(no).padStart(4, '0');
}

export function expenseReference(no?: number): string {
  return no ? `E-${pad(no)}` : 'Draft';
}

const STATUS_WORDS: Record<ExpenseStatus, string> = {
  draft: 'a draft',
  pending_approval: 'waiting for approval',
  rejected: 'rejected',
  posted: 'posted',
  cancelled: 'cancelled',
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * The account a category posts to must be an ordinary expense account.
 *
 * Not a control account — those are totals of a subledger and are posted to by their own module.
 * And genuinely expense-typed: a category pointed at an asset would put spending on the balance
 * sheet, where the profit and loss statement never looks, and profit would read too high by
 * exactly what was spent.
 */
async function loadExpenseLedger(ledgerId: string) {
  if (!Types.ObjectId.isValid(ledgerId)) throw badRequest('That is not an account id.');

  const ledger = await LedgerModel.findById(ledgerId)
    .select('_id code name isActive isControl groupId')
    .lean()
    .exec();
  if (!ledger) throw badRequest('That account does not exist.');

  const group = await AccountGroupModel.findById(ledger.groupId).select('accountType').lean().exec();
  const label = `"${ledger.code} ${ledger.name}"`;

  if (!ledger.isActive) throw badRequest(`${label} is deactivated and cannot be spent against.`);
  if (ledger.isControl) {
    throw badRequest(
      `${label} is a control account and is posted to by the module it summarises. An expense `
        + 'category needs an ordinary expense account.',
    );
  }
  if (group?.accountType !== 'expense') {
    throw badRequest(
      `${label} is not an expense account. Spending posted there would never show on the profit `
        + 'and loss statement.',
    );
  }

  return ledger;
}

export interface ExpenseCategoryView {
  id: string;
  name: string;
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  requiresApproval: boolean;
  approvalAbove: number | null;
  requiresReceipt: boolean;
  isActive: boolean;
  notes?: string;
  /** Expenses recorded against it, of any status except cancelled. */
  expenseCount: number;
}

export async function listCategories(
  filters: { status?: 'active' | 'inactive' | 'all' } = {},
): Promise<ExpenseCategoryView[]> {
  const query: Record<string, unknown> = {};
  if (filters.status === 'inactive') query.isActive = false;
  else if (filters.status !== 'all') query.isActive = true;

  const categories = await ExpenseCategoryModel.find(query).sort({ name: 1 }).lean().exec();

  const [ledgers, counts] = await Promise.all([
    LedgerModel.find({ _id: { $in: categories.map((c) => c.ledgerId) } })
      .select('_id code name')
      .lean()
      .exec(),
    ExpenseModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { categoryId: { $in: categories.map((c) => c._id) }, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$categoryId', count: { $sum: 1 } } },
    ]).exec(),
  ]);
  const ledgerById = new Map(ledgers.map((l) => [String(l._id), l]));
  const countById = new Map(counts.map((c) => [String(c._id), c.count]));

  return categories.map((c) => {
    const ledger = ledgerById.get(String(c.ledgerId));
    return {
      id: String(c._id),
      name: c.name,
      ledgerId: String(c.ledgerId),
      ledgerCode: ledger?.code ?? '',
      ledgerName: ledger?.name ?? 'Unknown account',
      requiresApproval: c.requiresApproval,
      approvalAbove: c.approvalAbove ?? null,
      requiresReceipt: c.requiresReceipt,
      isActive: c.isActive,
      notes: c.notes,
      expenseCount: countById.get(String(c._id)) ?? 0,
    };
  });
}

async function assertCategoryNameFree(name: string, excludeId?: string): Promise<void> {
  const query: Record<string, unknown> = { name };
  if (excludeId) query._id = { $ne: new Types.ObjectId(excludeId) };
  const existing = await ExpenseCategoryModel.findOne(query)
    .collation({ locale: 'en', strength: 2 })
    .select('_id name')
    .lean()
    .exec();
  if (existing) throw conflict(`An expense category called "${existing.name}" already exists.`);
}

export interface CategoryInput {
  name?: string;
  ledgerId?: string;
  requiresApproval?: boolean;
  approvalAbove?: number | null;
  requiresReceipt?: boolean;
  isActive?: boolean;
  notes?: string;
}

async function categoryView(id: string): Promise<ExpenseCategoryView> {
  const all = await listCategories({ status: 'all' });
  const found = all.find((c) => c.id === id);
  if (!found) throw notFound('Expense category not found');
  return found;
}

export async function createCategory(
  input: CategoryInput,
  actorId?: string,
): Promise<ExpenseCategoryView> {
  const name = input.name?.trim();
  if (!name || name.length < 2) throw badRequest('Give the category a name.');
  if (!input.ledgerId) throw badRequest('Choose the expense account this category posts to.');

  await assertCategoryNameFree(name);
  const ledger = await loadExpenseLedger(input.ledgerId);

  const category = await ExpenseCategoryModel.create({
    name,
    ledgerId: ledger._id,
    requiresApproval: Boolean(input.requiresApproval),
    approvalAbove: input.approvalAbove ?? null,
    requiresReceipt: Boolean(input.requiresReceipt),
    notes: input.notes?.trim() || undefined,
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'expense',
    entityId: String(category._id),
    action: 'created',
    meta: { kind: 'category', name },
  });

  return categoryView(String(category._id));
}

export async function updateCategory(
  id: string,
  input: CategoryInput,
  actorId?: string,
): Promise<ExpenseCategoryView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense category not found');
  const category = await ExpenseCategoryModel.findById(id).exec();
  if (!category) throw notFound('Expense category not found');

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw badRequest('Give the category a name.');
    await assertCategoryNameFree(name, id);
    category.name = name;
  }
  if (input.ledgerId !== undefined) {
    // Re-pointing a category moves only what is posted from now on. Expenses already posted keep
    // the account they posted to — see the category model.
    const ledger = await loadExpenseLedger(input.ledgerId);
    category.ledgerId = ledger._id;
  }
  if (input.requiresApproval !== undefined) category.requiresApproval = input.requiresApproval;
  if (input.approvalAbove !== undefined) category.approvalAbove = input.approvalAbove;
  if (input.requiresReceipt !== undefined) category.requiresReceipt = input.requiresReceipt;
  if (input.isActive !== undefined) category.isActive = input.isActive;
  if (input.notes !== undefined) category.notes = input.notes.trim() || undefined;
  category.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await category.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'expense',
    entityId: id,
    action: 'updated',
    meta: { kind: 'category', name: category.name },
  });

  return categoryView(id);
}

/**
 * The categories a new install starts with.
 *
 * A starting point for the accountant to rename, re-point and re-limit — not a policy. The limits
 * are deliberately conservative: it is easier to raise a limit that is getting in the way than to
 * notice a limit that was never there.
 */
const DEFAULT_CATEGORIES: {
  name: string;
  code: string;
  requiresApproval: boolean;
  approvalAbove: number | null;
  requiresReceipt: boolean;
  notes: string;
}[] = [
  {
    name: 'Petty cash',
    code: '6900',
    requiresApproval: false,
    approvalAbove: 2000,
    requiresReceipt: false,
    notes: 'Small everyday purchases. Straight through up to the limit; anything larger waits.',
  },
  {
    name: 'Fuel & vehicle running',
    code: '6120',
    requiresApproval: false,
    approvalAbove: 10000,
    requiresReceipt: false,
    notes: 'Petrol, tolls, parking.',
  },
  {
    name: 'Vehicle repairs',
    code: '6125',
    requiresApproval: true,
    approvalAbove: null,
    requiresReceipt: true,
    notes: 'Always approved: repair bills are easy to inflate and hard to check afterwards.',
  },
  {
    name: 'Rent',
    code: '6130',
    requiresApproval: true,
    approvalAbove: null,
    requiresReceipt: true,
    notes: 'Always approved, always with the landlord’s receipt.',
  },
  {
    name: 'Utilities',
    code: '6140',
    requiresApproval: false,
    approvalAbove: 25000,
    requiresReceipt: true,
    notes: 'Electricity, gas, water. The bill is the receipt.',
  },
  {
    name: 'Warehouse & handling',
    code: '6150',
    requiresApproval: false,
    approvalAbove: 10000,
    requiresReceipt: false,
    notes: 'Loading, labour, packing material.',
  },
  {
    name: 'Staff allowances',
    code: '6115',
    requiresApproval: true,
    approvalAbove: null,
    requiresReceipt: false,
    notes: 'One-off allowances paid in cash. Monthly salaries are not recorded here.',
  },
  {
    name: 'Bank charges',
    code: '6170',
    requiresApproval: false,
    approvalAbove: null,
    requiresReceipt: false,
    notes: 'Charges the bank deducts. The statement is the record.',
  },
  {
    name: 'Communication & internet',
    code: '6180',
    requiresApproval: false,
    approvalAbove: 10000,
    requiresReceipt: true,
    notes: 'Mobile packages, internet, phone bills.',
  },
  {
    name: 'Other expenses',
    code: '6900',
    requiresApproval: true,
    approvalAbove: null,
    requiresReceipt: true,
    notes: 'Anything that fits nowhere else. Always approved, because "other" is where things hide.',
  },
];

/**
 * Seed the default categories — once, on a database with none.
 *
 * "None" rather than "any missing", so a category an accountant renamed or retired is never
 * recreated behind them on the next deploy. A category whose account is missing from the chart
 * is skipped rather than pointed somewhere else.
 */
export async function seedDefaultExpenseCategories(): Promise<{ created: string[] }> {
  if ((await ExpenseCategoryModel.countDocuments().exec()) > 0) return { created: [] };

  const ledgers = await LedgerModel.find({ code: { $in: DEFAULT_CATEGORIES.map((c) => c.code) } })
    .select('_id code isActive isControl')
    .lean()
    .exec();
  const byCode = new Map(ledgers.map((l) => [l.code, l]));

  const created: string[] = [];
  for (const c of DEFAULT_CATEGORIES) {
    const ledger = byCode.get(c.code);
    if (!ledger || !ledger.isActive || ledger.isControl) continue;
    try {
      await ExpenseCategoryModel.create({
        name: c.name,
        ledgerId: ledger._id,
        requiresApproval: c.requiresApproval,
        approvalAbove: c.approvalAbove,
        requiresReceipt: c.requiresReceipt,
        notes: c.notes,
      });
      created.push(c.name);
    } catch (err) {
      // Two instances booting at once: the unique name index lets exactly one of them in.
      if ((err as { code?: number })?.code !== 11000) throw err;
    }
  }
  return { created };
}

// ---------------------------------------------------------------------------
// When an expense has to wait
// ---------------------------------------------------------------------------

type CategoryPolicy = Pick<IExpenseCategory, 'name' | 'requiresApproval' | 'approvalAbove'>;

/** Why this expense has to wait for a second person, in words — or null if it does not. */
export function approvalReason(category: CategoryPolicy, total: number): string | null {
  if (category.requiresApproval) {
    return `Every "${category.name}" expense is approved by a second person.`;
  }
  if (
    category.approvalAbove !== null
    && category.approvalAbove !== undefined
    && total - category.approvalAbove > MONEY_EPSILON
  ) {
    return `"${category.name}" goes straight through up to ${category.approvalAbove.toFixed(2)}; `
      + `this one is ${total.toFixed(2)}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Building and checking an expense
// ---------------------------------------------------------------------------

export interface ExpenseInput {
  categoryId: string;
  expenseDate: Date | string;
  description: string;
  amount: number;
  taxAmount?: number;
  method: PaymentMethod;
  paidFromLedgerId: string;
  chequeNo?: string;
  chequeDate?: Date | string | null;
  transferReference?: string;
  vendorId?: string | null;
  payeeName?: string;
  warehouseId?: string | null;
  attachments?: string[];
  notes?: string;
}

interface PreparedExpense {
  category: CategoryPolicy & { requiresReceipt: boolean };
  /** The fields that are written to the document. Nothing else in here is. */
  fields: {
    categoryId: Types.ObjectId;
    ledgerId: Types.ObjectId;
    expenseDate: Date;
    description: string;
    payeeName?: string;
    vendorId?: Types.ObjectId;
    warehouseId?: Types.ObjectId;
    cityKey?: string;
    amount: number;
    taxAmount: number;
    totalAmount: number;
    method: PaymentMethod;
    paidFromLedgerId: Types.ObjectId;
    chequeNo?: string;
    chequeDate?: Date;
    transferReference?: string;
    attachments: string[];
    notes?: string;
  };
  vendorName?: string;
}

/**
 * Everything that has to be true before an expense is worth writing down.
 *
 * Run on every save, and again inside the lock at submission and at approval. A category can be
 * retired, an account deactivated or a period closed while an expense waits, and only the check
 * at the moment of posting sees that.
 */
async function prepare(
  input: ExpenseInput,
  options: { allowRetiredCategory?: boolean } = {},
): Promise<PreparedExpense> {
  if (!Types.ObjectId.isValid(input.categoryId)) {
    throw badRequest('Choose what kind of spending this is.');
  }
  const category = await ExpenseCategoryModel.findById(input.categoryId).lean().exec();
  if (!category) throw notFound('Expense category not found');

  // Retired categories stay usable for an expense that was already waiting when they were retired
  // — the spending happened under the old policy, and refusing it would strand real money.
  if (!category.isActive && !options.allowRetiredCategory) {
    throw badRequest(
      `"${category.name}" has been retired and cannot be used for new spending. Choose another `
        + 'category.',
    );
  }

  const ledger = await loadExpenseLedger(String(category.ledgerId));

  const expenseDate = new Date(input.expenseDate);
  if (Number.isNaN(expenseDate.getTime())) throw badRequest('The expense date is not a date.');

  const description = input.description?.trim();
  if (!description || description.length < 3) throw badRequest('Say what the money was spent on.');

  const amount = round2(input.amount);
  if (!(amount > MONEY_EPSILON)) throw badRequest('An expense has to be for something.');
  const taxAmount = round2(input.taxAmount ?? 0);
  if (taxAmount < 0) throw badRequest('Tax cannot be negative.');

  if (!PAYMENT_METHODS.includes(input.method)) {
    throw badRequest('Say whether this was paid in cash, by bank transfer, or by cheque.');
  }
  const paidFrom = await loadPaidFromAccount(input.paidFromLedgerId);

  let chequeNo: string | undefined;
  let chequeDate: Date | undefined;
  if (input.method === 'cheque') {
    chequeNo = input.chequeNo?.trim() || undefined;
    if (!chequeNo) throw badRequest('A cheque needs its cheque number.');
    chequeDate = input.chequeDate ? new Date(input.chequeDate) : expenseDate;
    if (Number.isNaN(chequeDate.getTime())) throw badRequest('The cheque date is not a date.');
  }

  let vendorId: Types.ObjectId | undefined;
  let vendorName: string | undefined;
  if (input.vendorId) {
    if (!Types.ObjectId.isValid(input.vendorId)) throw badRequest('That is not a supplier id.');
    const vendor = await VendorModel.findById(input.vendorId).select('_id name isPlaceholder').lean().exec();
    if (!vendor) throw badRequest('That supplier does not exist.');
    if (vendor.isPlaceholder) {
      throw badRequest('The holding record for unidentified receipts is not somebody money can be paid to.');
    }
    vendorId = vendor._id;
    vendorName = vendor.name;
  }

  let warehouseId: Types.ObjectId | undefined;
  let cityKey: string | undefined;
  if (input.warehouseId) {
    if (!Types.ObjectId.isValid(input.warehouseId)) throw badRequest('That is not a warehouse id.');
    const warehouse = await WarehouseModel.findById(input.warehouseId).select('_id cityKey').lean().exec();
    if (!warehouse) throw badRequest('That warehouse does not exist.');
    warehouseId = warehouse._id;
    cityKey = warehouse.cityKey;
  }

  const attachments = (input.attachments ?? []).map((a) => a.trim()).filter(Boolean);
  if (attachments.length > 10) throw badRequest('Attach at most ten receipts to one expense.');

  return {
    category: {
      name: category.name,
      requiresApproval: category.requiresApproval,
      approvalAbove: category.approvalAbove ?? null,
      requiresReceipt: category.requiresReceipt,
    },
    vendorName,
    fields: {
      categoryId: category._id,
      ledgerId: ledger._id,
      expenseDate,
      description,
      payeeName: input.payeeName?.trim() || undefined,
      vendorId,
      warehouseId,
      cityKey,
      amount,
      taxAmount,
      totalAmount: round2(amount + taxAmount),
      method: input.method,
      paidFromLedgerId: paidFrom._id,
      chequeNo,
      chequeDate,
      transferReference: input.method === 'cheque'
        ? undefined
        : input.transferReference?.trim() || undefined,
      attachments,
      notes: input.notes?.trim() || undefined,
    },
  };
}

function inputFromDocument(expense: IExpense): ExpenseInput {
  return {
    categoryId: String(expense.categoryId),
    expenseDate: expense.expenseDate,
    description: expense.description,
    amount: expense.amount,
    taxAmount: expense.taxAmount,
    method: expense.method,
    paidFromLedgerId: String(expense.paidFromLedgerId),
    chequeNo: expense.chequeNo,
    chequeDate: expense.chequeDate,
    transferReference: expense.transferReference,
    vendorId: expense.vendorId ? String(expense.vendorId) : undefined,
    payeeName: expense.payeeName,
    warehouseId: expense.warehouseId ? String(expense.warehouseId) : undefined,
    attachments: expense.attachments,
    notes: expense.notes,
  };
}

/** Writes the prepared fields, clearing optional ones the new version leaves out. */
function applyFields(expense: IExpense, fields: PreparedExpense['fields']): void {
  Object.assign(expense, fields);
  expense.payeeName = fields.payeeName;
  expense.vendorId = fields.vendorId;
  expense.warehouseId = fields.warehouseId;
  expense.cityKey = fields.cityKey;
  expense.chequeNo = fields.chequeNo;
  expense.chequeDate = fields.chequeDate;
  expense.transferReference = fields.transferReference;
  expense.notes = fields.notes;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ExpenseView {
  id: string;
  expenseNo?: number;
  reference: string;
  categoryId: string;
  categoryName: string;
  ledgerId: string;
  ledgerCode: string;
  ledgerName: string;
  expenseDate: Date;
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
  chequeDate?: Date;
  chequeClearedAt?: Date;
  isChequeUncleared: boolean;
  transferReference?: string;
  attachments: string[];
  status: ExpenseStatus;
  /**
   * Why it has to wait for approval, in words, or null. For an expense not yet posted this is
   * judged against the category as it is NOW, so the screen says what submitting will do.
   */
  approvalNeeded: string | null;
  /** Whether the category wants a receipt attached before submission. */
  receiptRequired: boolean;
  submittedAt?: Date;
  submittedBy?: string;
  approvedAt?: Date;
  approvedBy?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
  journalEntryId?: string;
  cancelReason?: string;
  notes?: string;
  createdBy?: string;
  createdAt: Date;
}

async function toViews(expenses: IExpense[]): Promise<ExpenseView[]> {
  if (expenses.length === 0) return [];

  const ids = <T>(pick: (e: IExpense) => T | undefined) =>
    [...new Set(expenses.map(pick).filter(Boolean).map(String))].map((id) => new Types.ObjectId(id));

  const [categories, ledgers, vendors, warehouses] = await Promise.all([
    ExpenseCategoryModel.find({ _id: { $in: ids((e) => e.categoryId) } }).lean().exec(),
    LedgerModel.find({
      _id: { $in: [...ids((e) => e.ledgerId), ...ids((e) => e.paidFromLedgerId)] },
    })
      .select('_id code name')
      .lean()
      .exec(),
    VendorModel.find({ _id: { $in: ids((e) => e.vendorId) } }).select('_id name').lean().exec(),
    WarehouseModel.find({ _id: { $in: ids((e) => e.warehouseId) } }).select('_id name').lean().exec(),
  ]);

  const categoryById = new Map(categories.map((c) => [String(c._id), c]));
  const ledgerById = new Map(ledgers.map((l) => [String(l._id), l]));
  const vendorById = new Map(vendors.map((v) => [String(v._id), v.name]));
  const warehouseById = new Map(warehouses.map((w) => [String(w._id), w.name]));

  return expenses.map((e) => {
    const category = categoryById.get(String(e.categoryId));
    const ledger = ledgerById.get(String(e.ledgerId));
    const paidFrom = ledgerById.get(String(e.paidFromLedgerId));
    const unposted = e.status === 'draft' || e.status === 'rejected' || e.status === 'pending_approval';

    return {
      id: String(e._id),
      expenseNo: e.expenseNo,
      reference: expenseReference(e.expenseNo),
      categoryId: String(e.categoryId),
      categoryName: category?.name ?? 'Unknown category',
      ledgerId: String(e.ledgerId),
      ledgerCode: ledger?.code ?? '',
      ledgerName: ledger?.name ?? 'Unknown account',
      expenseDate: e.expenseDate,
      description: e.description,
      payeeName: e.payeeName,
      vendorId: e.vendorId ? String(e.vendorId) : undefined,
      vendorName: e.vendorId ? vendorById.get(String(e.vendorId)) : undefined,
      warehouseId: e.warehouseId ? String(e.warehouseId) : undefined,
      warehouseName: e.warehouseId ? warehouseById.get(String(e.warehouseId)) : undefined,
      cityKey: e.cityKey,
      amount: round2(e.amount),
      taxAmount: round2(e.taxAmount),
      totalAmount: round2(e.totalAmount),
      method: e.method,
      paidFromLedgerId: String(e.paidFromLedgerId),
      paidFromName: paidFrom ? `${paidFrom.code} ${paidFrom.name}` : 'Unknown account',
      chequeNo: e.chequeNo,
      chequeDate: e.chequeDate,
      chequeClearedAt: e.chequeClearedAt,
      isChequeUncleared: e.method === 'cheque' && e.status === 'posted' && !e.chequeClearedAt,
      transferReference: e.transferReference,
      attachments: e.attachments ?? [],
      status: e.status,
      approvalNeeded: unposted && category ? approvalReason(category, e.totalAmount) : null,
      receiptRequired: Boolean(category?.requiresReceipt),
      submittedAt: e.submittedAt,
      submittedBy: e.submittedBy ? String(e.submittedBy) : undefined,
      approvedAt: e.approvedAt,
      approvedBy: e.approvedBy ? String(e.approvedBy) : undefined,
      rejectedAt: e.rejectedAt,
      rejectionReason: e.rejectionReason,
      journalEntryId: e.journalEntryId ? String(e.journalEntryId) : undefined,
      cancelReason: e.cancelReason,
      notes: e.notes,
      createdBy: e.createdBy ? String(e.createdBy) : undefined,
      createdAt: e.createdAt,
    };
  });
}

export async function getExpense(id: string): Promise<ExpenseView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');
  const expense = await ExpenseModel.findById(id).exec();
  if (!expense) throw notFound('Expense not found');
  return (await toViews([expense]))[0];
}

export interface ExpenseFilters {
  status?: ExpenseStatus | 'all';
  categoryId?: string;
  method?: PaymentMethod;
  from?: string;
  to?: string;
  search?: string;
  unclearedCheques?: boolean;
}

export async function listExpenses(filters: ExpenseFilters = {}): Promise<ExpenseView[]> {
  const query: Record<string, unknown> = {};

  if (filters.status && filters.status !== 'all' && EXPENSE_STATUSES.includes(filters.status)) {
    query.status = filters.status;
  }
  if (filters.categoryId && Types.ObjectId.isValid(filters.categoryId)) {
    query.categoryId = new Types.ObjectId(filters.categoryId);
  }
  if (filters.method && PAYMENT_METHODS.includes(filters.method)) query.method = filters.method;

  if (filters.unclearedCheques) {
    query.method = 'cheque';
    query.status = 'posted';
    query.chequeClearedAt = null;
  }

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) range.$lte = new Date(filters.to);
    query.expenseDate = range;
  }

  if (filters.search?.trim()) {
    const safe = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(safe, 'i');
    query.$or = [
      { description: pattern },
      { payeeName: pattern },
      { chequeNo: pattern },
      { transferReference: pattern },
    ];
  }

  const expenses = await ExpenseModel.find(query)
    .sort({ expenseDate: -1, createdAt: -1 })
    .limit(500)
    .exec();

  return toViews(expenses);
}

export interface ExpenseSummaryRow {
  categoryId: string;
  categoryName: string;
  count: number;
  amount: number;
  taxAmount: number;
}

/** Posted spending by category for a date range — the figure a budget conversation starts from. */
export async function expenseSummary(
  filters: { from?: string; to?: string } = {},
): Promise<{ rows: ExpenseSummaryRow[]; amount: number; taxAmount: number; count: number }> {
  const match: Record<string, unknown> = { status: 'posted' };
  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) range.$lte = new Date(filters.to);
    match.expenseDate = range;
  }

  const grouped = await ExpenseModel.aggregate<{
    _id: Types.ObjectId;
    count: number;
    amount: number;
    taxAmount: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: '$categoryId',
        count: { $sum: 1 },
        amount: { $sum: '$amount' },
        taxAmount: { $sum: '$taxAmount' },
      },
    },
  ]).exec();

  const categories = await ExpenseCategoryModel.find({ _id: { $in: grouped.map((g) => g._id) } })
    .select('_id name')
    .lean()
    .exec();
  const nameById = new Map(categories.map((c) => [String(c._id), c.name]));

  const rows = grouped
    .map((g) => ({
      categoryId: String(g._id),
      categoryName: nameById.get(String(g._id)) ?? 'Unknown category',
      count: g.count,
      amount: round2(g.amount),
      taxAmount: round2(g.taxAmount),
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    rows,
    amount: round2(rows.reduce((s, r) => s + r.amount, 0)),
    taxAmount: round2(rows.reduce((s, r) => s + r.taxAmount, 0)),
    count: rows.reduce((s, r) => s + r.count, 0),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createExpense(input: ExpenseInput, actorId?: string): Promise<ExpenseView> {
  const prepared = await prepare(input);
  await assertChequeLeafUnused(prepared.fields.paidFromLedgerId, prepared.fields.chequeNo);

  // No number yet. The series is allocated at posting, so an abandoned draft leaves no gap.
  const expense = await ExpenseModel.create({
    ...prepared.fields,
    status: 'draft',
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'expense',
    entityId: String(expense._id),
    action: 'created',
    meta: { category: prepared.category.name, total: prepared.fields.totalAmount },
  });

  return getExpense(String(expense._id));
}

export async function updateExpense(
  id: string,
  input: ExpenseInput,
  actorId?: string,
): Promise<ExpenseView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');
  const expense = await ExpenseModel.findById(id).exec();
  if (!expense) throw notFound('Expense not found');

  if (expense.status === 'pending_approval') {
    throw badRequest(
      'This expense is waiting for approval and cannot be changed under the approver. Ask them to '
        + 'reject it, then correct it and submit it again.',
    );
  }
  if (expense.status === 'posted' || expense.status === 'cancelled') {
    throw badRequest(
      `This expense is ${STATUS_WORDS[expense.status]} and cannot be edited. Cancel it and record `
        + 'a corrected one, so both stay on the record.',
    );
  }

  const prepared = await prepare(input);
  await assertChequeLeafUnused(prepared.fields.paidFromLedgerId, prepared.fields.chequeNo, {
    expenseId: id,
  });

  applyFields(expense, prepared.fields);
  // Correcting a rejected expense returns it to draft. The rejection reason stays, as the record
  // of why it came back.
  expense.status = 'draft';
  expense.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await expense.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'expense',
    entityId: id,
    action: 'updated',
    meta: { total: prepared.fields.totalAmount },
  });

  return getExpense(id);
}

export async function deleteExpense(id: string, actorId?: string): Promise<{ message: string }> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');
  const expense = await ExpenseModel.findById(id).lean().exec();
  if (!expense) throw notFound('Expense not found');

  if (expense.status !== 'draft' && expense.status !== 'rejected') {
    throw badRequest(
      `This expense is ${STATUS_WORDS[expense.status]} and cannot be deleted. `
        + (expense.status === 'pending_approval'
          ? 'Ask the approver to reject it first.'
          : 'A posted expense is cancelled, never deleted.'),
    );
  }

  await ExpenseModel.deleteOne({ _id: expense._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'expense',
    entityId: id,
    action: 'deleted',
    meta: { total: expense.totalAmount },
  });

  return { message: 'Expense deleted' };
}

/**
 * Write the entry and stamp the expense. Called only while holding `expense:<id>`.
 *
 *     Dr  the category's expense account     the spending, before tax
 *     Dr  Input Tax                          claimable separately
 *         Cr  Cash / Bank                    what left the account
 *         Cr  Cheques Issued, Uncleared      — instead, for a cheque, until it clears
 *
 * Entry first, document second, as every finance document does: an interruption leaves the
 * expense unposted, and the retry finds the entry by its idempotency key instead of writing it
 * twice.
 */
async function postHoldingLock(
  expense: IExpense,
  prepared: PreparedExpense,
  actorId: string | undefined,
  stamp: { approvedBy?: string; submittedBy?: string },
): Promise<ExpenseView> {
  const id = String(expense._id);
  const f = prepared.fields;

  const [inputTax, creditLedger] = await Promise.all([
    f.taxAmount > 0 ? ledgerIdForRole('inputTax') : Promise.resolve(''),
    f.method === 'cheque'
      ? ledgerIdForRole('chequesIssued')
      : Promise.resolve(String(f.paidFromLedgerId)),
  ]);

  const lines: { ledgerId: string; debit?: number; credit?: number; lineNarration?: string }[] = [
    { ledgerId: String(f.ledgerId), debit: f.amount, lineNarration: f.description },
  ];
  if (f.taxAmount > 0) {
    lines.push({ ledgerId: inputTax, debit: f.taxAmount, lineNarration: 'Input tax' });
  }
  lines.push({
    ledgerId: creditLedger,
    credit: f.totalAmount,
    lineNarration: f.method === 'cheque' ? `Cheque ${f.chequeNo}, not yet cleared` : undefined,
  });

  const paidTo = prepared.vendorName ?? f.payeeName;

  const entry = await postEntry(
    {
      date: f.expenseDate,
      narration: `${prepared.category.name}: ${f.description}${paidTo ? ` — ${paidTo}` : ''}`,
      referenceNo: f.chequeNo ?? f.transferReference,
      sourceType: 'expense',
      sourceId: id,
      sourceModel: 'Expense',
      // Stable: a posted expense is never edited and re-posted, and a moving key would let a
      // double-click spend the money twice.
      idempotencyKey: buildIdempotencyKey('expense', id, 'paid'),
      warehouseId: f.warehouseId ? String(f.warehouseId) : undefined,
      cityKey: f.cityKey,
      attachments: f.attachments,
      lines,
    },
    actorId,
  );

  // Everything is stamped only once the entry is down, so a posting refused by a closed month
  // leaves the expense exactly as it was — still waiting, not "approved but not posted".
  applyFields(expense, f);
  if (!expense.expenseNo) expense.expenseNo = await allocateNextFinanceNo('financeExpenseNo');
  const now = new Date();
  if (stamp.submittedBy) {
    expense.submittedAt = now;
    expense.submittedBy = new Types.ObjectId(stamp.submittedBy);
  }
  if (stamp.approvedBy) {
    expense.approvedAt = now;
    expense.approvedBy = new Types.ObjectId(stamp.approvedBy);
  }
  expense.status = 'posted';
  expense.journalEntryId = entry._id;
  expense.postedAt = now;
  expense.postedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await expense.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'expense',
    entityId: id,
    action: 'posted',
    meta: {
      expenseNo: expense.expenseNo,
      category: prepared.category.name,
      total: f.totalAmount,
      approved: Boolean(stamp.approvedBy),
    },
  });

  return getExpense(id);
}

/**
 * Submit an expense: post it now if its category lets it through, or queue it for approval.
 *
 * Which of the two happens is decided here and only here, against the category as it is at this
 * moment. The person submitting does not choose.
 */
export async function submitExpense(id: string, actorId?: string): Promise<ExpenseView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');

  return withFinanceLocks([`expense:${id}`], async () => {
    const expense = await ExpenseModel.findById(id).exec();
    if (!expense) throw notFound('Expense not found');
    if (expense.status === 'posted') return getExpense(id);
    if (expense.status === 'pending_approval') {
      throw conflict('This expense has already been submitted and is waiting for approval.');
    }
    if (expense.status !== 'draft' && expense.status !== 'rejected') {
      throw badRequest(`This expense is ${STATUS_WORDS[expense.status]} and cannot be submitted.`);
    }

    const prepared = await prepare(inputFromDocument(expense));

    if (prepared.category.requiresReceipt && prepared.fields.attachments.length === 0) {
      throw badRequest(
        `"${prepared.category.name}" expenses need their receipt attached before they are `
          + 'submitted.',
      );
    }

    await assertChequeLeafUnused(prepared.fields.paidFromLedgerId, prepared.fields.chequeNo, {
      expenseId: id,
    });

    const reason = approvalReason(prepared.category, prepared.fields.totalAmount);
    if (reason) {
      applyFields(expense, prepared.fields);
      expense.status = 'pending_approval';
      expense.submittedAt = new Date();
      expense.submittedBy = actorId ? new Types.ObjectId(actorId) : undefined;
      await expense.save();

      logActivityAsync({
        employeeId: actorId,
        module: 'expense',
        entityId: id,
        action: 'submitted',
        meta: { category: prepared.category.name, total: prepared.fields.totalAmount, reason },
      });

      return getExpense(id);
    }

    return postHoldingLock(expense, prepared, actorId, { submittedBy: actorId });
  });
}

/**
 * Approve a waiting expense, which posts it.
 *
 * Refused to whoever submitted it. An approval the submitter can give themselves is not a second
 * pair of eyes; it is the same pair looking twice.
 */
export async function approveExpense(id: string, actorId: string): Promise<ExpenseView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');

  return withFinanceLocks([`expense:${id}`], async () => {
    const expense = await ExpenseModel.findById(id).exec();
    if (!expense) throw notFound('Expense not found');
    // A second approver arriving just after the first finds it done, and is told so by the result
    // rather than by an error — nothing went wrong.
    if (expense.status === 'posted') return getExpense(id);
    if (expense.status !== 'pending_approval') {
      throw badRequest(
        `This expense is ${STATUS_WORDS[expense.status]}. Only an expense waiting for approval can `
          + 'be approved.',
      );
    }
    if (expense.submittedBy && String(expense.submittedBy) === actorId) {
      throw badRequest(
        'You submitted this expense, so somebody else has to approve it. A second person looking '
          + 'at it is the whole point of it waiting.',
      );
    }

    const prepared = await prepare(inputFromDocument(expense), { allowRetiredCategory: true });
    return postHoldingLock(expense, prepared, actorId, { approvedBy: actorId });
  });
}

export async function rejectExpense(
  id: string,
  reason: string,
  actorId?: string,
): Promise<ExpenseView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');
  const why = reason?.trim() ?? '';
  if (why.length < 3) {
    throw badRequest('Say why it is being rejected — whoever submitted it needs to know what to fix.');
  }

  return withFinanceLocks([`expense:${id}`], async () => {
    const expense = await ExpenseModel.findById(id).exec();
    if (!expense) throw notFound('Expense not found');
    if (expense.status !== 'pending_approval') {
      throw badRequest(
        `This expense is ${STATUS_WORDS[expense.status]}. Only an expense waiting for approval can `
          + 'be rejected.',
      );
    }

    expense.status = 'rejected';
    expense.rejectedAt = new Date();
    expense.rejectedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    expense.rejectionReason = why;
    await expense.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'expense',
      entityId: id,
      action: 'rejected',
      meta: { reason: why },
    });

    return getExpense(id);
  });
}

export async function cancelExpense(
  id: string,
  reason: string,
  actorId?: string,
): Promise<ExpenseView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');

  return withFinanceLocks([`expense:${id}`], async () => {
    const expense = await ExpenseModel.findById(id).exec();
    if (!expense) throw notFound('Expense not found');
    if (expense.status === 'cancelled') throw conflict('This expense has already been cancelled.');
    if (expense.status === 'pending_approval') {
      throw badRequest('This expense is still waiting for approval and has posted nothing. Reject it instead.');
    }
    if (expense.status !== 'posted') {
      throw badRequest('This expense was never posted. Delete it instead of cancelling it.');
    }
    if (expense.chequeClearedAt) {
      throw badRequest(
        `Cheque ${expense.chequeNo} has cleared — the money has left the bank, so this expense can `
          + 'no longer be cancelled.',
      );
    }

    if (expense.journalEntryId) {
      const entry = await JournalEntryModel.findById(expense.journalEntryId)
        .select('status')
        .lean()
        .exec();
      if (entry && entry.status === 'posted') {
        await reverseEntry(String(expense.journalEntryId), { reason }, actorId);
      }
    }

    expense.status = 'cancelled';
    expense.cancelledAt = new Date();
    expense.cancelledBy = actorId ? new Types.ObjectId(actorId) : undefined;
    expense.cancelReason = reason.trim();
    await expense.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'expense',
      entityId: id,
      action: 'cancelled',
      meta: { expenseNo: expense.expenseNo, total: expense.totalAmount, reason: reason.trim() },
    });

    return getExpense(id);
  });
}

/**
 * A cheque paid for an expense showed on the bank statement: move it into the bank, dated the day
 * it cleared. Mirrors clearing a supplier payment's cheque.
 */
export async function clearExpenseCheque(
  id: string,
  clearedOn: Date | string,
  actorId?: string,
): Promise<ExpenseView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Expense not found');

  return withFinanceLocks([`expense:${id}`], async () => {
    const expense = await ExpenseModel.findById(id).exec();
    if (!expense) throw notFound('Expense not found');

    if (expense.method !== 'cheque') {
      throw badRequest('Only a cheque clears. This expense left the account the day it was posted.');
    }
    if (expense.status !== 'posted') {
      throw badRequest(`This expense is ${STATUS_WORDS[expense.status]}. Only a posted cheque can clear.`);
    }
    if (expense.chequeClearedAt) {
      throw conflict(
        `Cheque ${expense.chequeNo} was already marked cleared on ${localDayKey(expense.chequeClearedAt)}.`,
      );
    }

    const date = new Date(clearedOn);
    if (Number.isNaN(date.getTime())) {
      throw badRequest('Say which day the cheque cleared on the bank statement.');
    }
    if (localDayKey(date) < localDayKey(expense.chequeDate ?? expense.expenseDate)) {
      throw badRequest('A cheque cannot clear before it was written.');
    }

    const chequesIssued = await ledgerIdForRole('chequesIssued');
    const entry = await postEntry(
      {
        date,
        narration: `Cheque ${expense.chequeNo} for ${expense.description} cleared`,
        referenceNo: expense.chequeNo,
        sourceType: 'expense',
        sourceId: id,
        sourceModel: 'Expense',
        idempotencyKey: buildIdempotencyKey('expense', id, 'cheque_cleared'),
        lines: [
          { ledgerId: chequesIssued, debit: expense.totalAmount },
          { ledgerId: String(expense.paidFromLedgerId), credit: expense.totalAmount },
        ],
      },
      actorId,
    );

    expense.chequeClearedAt = date;
    expense.chequeClearedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    expense.clearingEntryId = entry._id;
    await expense.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'expense',
      entityId: id,
      action: 'updated',
      meta: { chequeNo: expense.chequeNo, chequeClearedOn: localDayKey(date) },
    });

    return getExpense(id);
  });
}
