import { Types } from 'mongoose';
import { PurchaseBillModel, IPurchaseBill } from '../../models/purchase-bill.model';
import { VendorModel } from '../../models/vendor.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { LedgerModel } from '../../models/ledger.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { allocateNextFinanceNo } from './finance-counters';
import { round2, MONEY_EPSILON, buildIdempotencyKey } from './finance.rules';
import { postEntry, reverseEntry, ledgerIdForRole } from './posting.service';
import { withFinanceLocks } from './finance-locks';
import { paidByBill, paymentsForBill, BillPaymentLine } from './payments.service';

/**
 * Supplier bills, and the matching of them to goods already received.
 *
 * ## The one thing this module exists to get right
 *
 * `2115 Goods Received Not Invoiced` fills every time stock arrives and drains every time a bill
 * is matched against it. If it drains by more than it filled, the excess sits there for good
 * with nothing on the warehouse side that could ever explain it — and unlike a wrong figure, a
 * wrong CLEARING leaves no trace of what it was supposed to be clearing.
 *
 * So every rule below that looks pedantic is guarding the same edge: a bill may never clear more
 * of a receipt than that receipt actually put into GRNI.
 */

// ---------------------------------------------------------------------------
// What a receipt still has outstanding
// ---------------------------------------------------------------------------

/**
 * How much of each receipt has already been billed.
 *
 * Derived every time rather than kept as a field on the receipt. A denormalised `billedAmount`
 * would have to be adjusted on post, on cancel, and on every edit of a draft, and the first time
 * one of those paths was missed the figure would be wrong with nothing to compare it against.
 * This aggregation cannot drift because there is nothing for it to drift from.
 *
 * Only POSTED bills count. A draft has moved no money, so the receipt it names is still open for
 * anyone else to bill — and two drafts against one receipt is a normal thing to have while
 * somebody works out which supplier's paperwork is right.
 */
async function billedByReceipt(
  receiptIds: Types.ObjectId[],
  options: { excludeBillId?: string } = {},
): Promise<Map<string, number>> {
  if (receiptIds.length === 0) return new Map();

  const match: Record<string, unknown> = {
    status: 'posted',
    'matchedReceipts.receiptId': { $in: receiptIds },
  };
  if (options.excludeBillId && Types.ObjectId.isValid(options.excludeBillId)) {
    match._id = { $ne: new Types.ObjectId(options.excludeBillId) };
  }

  const rows = await PurchaseBillModel.aggregate<{ _id: Types.ObjectId; billed: number }>([
    { $match: match },
    { $unwind: '$matchedReceipts' },
    { $match: { 'matchedReceipts.receiptId': { $in: receiptIds } } },
    { $group: { _id: '$matchedReceipts.receiptId', billed: { $sum: '$matchedReceipts.amount' } } },
  ]).exec();

  return new Map(rows.map((r) => [String(r._id), round2(r.billed)]));
}

/** Which receipts actually reached the accounts — see the rule in `prepareMatches`. */
async function receiptsWithLivePosting(receiptIds: Types.ObjectId[]): Promise<Set<string>> {
  if (receiptIds.length === 0) return new Set();

  const entries = await JournalEntryModel.find({
    sourceType: 'stock_receipt',
    sourceId: { $in: receiptIds },
    status: 'posted',
  })
    .select('sourceId')
    .lean()
    .exec();

  return new Set(entries.map((e) => String(e.sourceId)));
}

export interface OpenReceipt {
  id: string;
  documentNo?: number;
  receiptDate: Date;
  typedName?: string;
  totalAmount: number;
  billedAmount: number;
  outstanding: number;
}

/**
 * The goods receipts a bill for this supplier could be matched against.
 *
 * Restricted to the supplier's own receipts, which is only answerable at all because the
 * typed-name clean-up attached them. A receipt still carrying nothing but free text does not
 * appear here — there is no honest way to know whose it is.
 */
export async function openReceiptsForVendor(
  vendorId: string,
  options: { includeBillId?: string } = {},
): Promise<OpenReceipt[]> {
  if (!Types.ObjectId.isValid(vendorId)) throw badRequest('That is not a supplier id.');

  const receipts = await StockReceiptModel.find({
    vendorId: new Types.ObjectId(vendorId),
    status: 'posted',
    isTrashed: { $ne: true },
  })
    .select('_id documentNo receiptDate supplierName totalAmount')
    .sort({ receiptDate: -1 })
    .lean()
    .exec();

  const ids = receipts.map((r) => r._id);
  const [billed, posted] = await Promise.all([
    // A bill being edited must see its own receipts as still open, or re-saving it unchanged
    // would report every line as over-billed by exactly what that same bill already claims.
    billedByReceipt(ids, { excludeBillId: options.includeBillId }),
    receiptsWithLivePosting(ids),
  ]);

  return receipts
    .filter((r) => posted.has(String(r._id)))
    .map((r) => {
      const billedAmount = billed.get(String(r._id)) ?? 0;
      return {
        id: String(r._id),
        documentNo: r.documentNo,
        receiptDate: r.receiptDate,
        typedName: r.supplierName,
        totalAmount: round2(r.totalAmount),
        billedAmount,
        outstanding: round2(r.totalAmount - billedAmount),
      };
    })
    .filter((r) => r.outstanding > MONEY_EPSILON);
}

// ---------------------------------------------------------------------------
// Building and checking a bill
// ---------------------------------------------------------------------------

export interface BillInput {
  vendorId: string;
  supplierBillNo?: string;
  billDate: Date | string;
  dueDate?: Date | string;
  matchedReceipts?: { receiptId: string; amount?: number }[];
  lines?: { description: string; ledgerId: string; amount: number }[];
  taxAmount?: number;
  notes?: string;
}

interface PreparedBill {
  vendorId: Types.ObjectId;
  vendorName: string;
  supplierBillNo?: string;
  billDate: Date;
  dueDate: Date;
  matchedReceipts: { receiptId: Types.ObjectId; amount: number }[];
  lines: { description: string; ledgerId: Types.ObjectId; amount: number }[];
  taxAmount: number;
  totalAmount: number;
  notes?: string;
}

/**
 * Everything that has to be true before a bill is worth writing down.
 *
 * Run on create, on every edit, and AGAIN at post — deliberately. A draft can sit for a week,
 * and in that week its receipts can be cancelled, another bill can claim them, or an account can
 * be deactivated. Validating only when the draft was typed would let all of that through.
 */
async function prepare(input: BillInput, options: { billId?: string } = {}): Promise<PreparedBill> {
  if (!Types.ObjectId.isValid(input.vendorId)) throw badRequest('That is not a supplier id.');

  const vendor = await VendorModel.findById(input.vendorId).lean().exec();
  if (!vendor) throw notFound('Supplier not found');

  /*
   * The holding record is not a supplier. It is the bucket receipts land in when nobody could
   * say whose they were, and billing it would attach a real debt to a name that means "we do not
   * know" — after which no supplier statement anywhere would be right.
   *
   * A RETIRED supplier is allowed through. Retiring means "we have stopped buying from them",
   * and a final invoice arriving after that is ordinary; refusing it would only teach people to
   * reactivate, bill, and retire again.
   */
  if (vendor.isPlaceholder) {
    throw badRequest(
      `"${vendor.name}" is the holding record for receipts whose supplier was never identified, `
        + 'not a real supplier. Match those receipts to the supplier first, then bill them.',
    );
  }

  const billDate = new Date(input.billDate);
  if (Number.isNaN(billDate.getTime())) throw badRequest('The bill date is not a date.');

  // Terms are read now and frozen onto the bill. Changing a supplier's terms later should not
  // silently move the due date of an invoice that was already agreed.
  const dueDate = input.dueDate
    ? new Date(input.dueDate)
    : new Date(billDate.getTime() + (vendor.paymentTermsDays ?? 0) * 86_400_000);
  if (Number.isNaN(dueDate.getTime())) throw badRequest('The due date is not a date.');
  if (dueDate.getTime() < billDate.getTime()) {
    throw badRequest('The due date cannot be before the bill date.');
  }

  const matchedReceipts = await prepareMatches(input, vendor._id, options.billId);
  const lines = await prepareLines(input);
  const taxAmount = round2(input.taxAmount ?? 0);

  const goodsTotal = round2(matchedReceipts.reduce((sum, m) => sum + m.amount, 0));
  const chargesTotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const totalAmount = round2(goodsTotal + chargesTotal + taxAmount);

  if (totalAmount <= MONEY_EPSILON) {
    throw badRequest('A bill has to be for something. Every line on this one is zero.');
  }

  return {
    vendorId: vendor._id,
    vendorName: vendor.name,
    supplierBillNo: input.supplierBillNo?.trim() || undefined,
    billDate,
    dueDate,
    matchedReceipts,
    lines,
    taxAmount,
    totalAmount,
    notes: input.notes?.trim() || undefined,
  };
}

async function prepareMatches(
  input: BillInput,
  vendorId: Types.ObjectId,
  billId?: string,
): Promise<{ receiptId: Types.ObjectId; amount: number }[]> {
  const requested = input.matchedReceipts ?? [];
  if (requested.length === 0) return [];

  const ids = requested.map((m) => {
    if (!Types.ObjectId.isValid(m.receiptId)) throw badRequest('That is not a goods receipt id.');
    return new Types.ObjectId(m.receiptId);
  });

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(String(id))) throw badRequest('The same goods receipt is on this bill twice.');
    seen.add(String(id));
  }

  const receipts = await StockReceiptModel.find({ _id: { $in: ids } })
    .select('_id documentNo status isTrashed vendorId totalAmount supplierName')
    .lean()
    .exec();
  const byId = new Map(receipts.map((r) => [String(r._id), r]));

  const [billed, posted] = await Promise.all([
    billedByReceipt(ids, { excludeBillId: billId }),
    receiptsWithLivePosting(ids),
  ]);

  return requested.map((m) => {
    const receipt = byId.get(m.receiptId);
    if (!receipt) throw badRequest('One of the goods receipts on this bill no longer exists.');

    const label = receipt.documentNo
      ? `Receipt ${receipt.documentNo}`
      : 'One of the goods receipts';

    if (receipt.status !== 'posted' || receipt.isTrashed) {
      throw badRequest(`${label} was cancelled, so there is nothing on it to bill.`);
    }

    if (!receipt.vendorId) {
      throw badRequest(
        `${label} is not attached to a supplier — it still carries only the name somebody typed`
          + `${receipt.supplierName ? ` ("${receipt.supplierName}")` : ''}. Match the typed names `
          + 'to suppliers first.',
      );
    }

    if (String(receipt.vendorId) !== String(vendorId)) {
      throw badRequest(`${label} belongs to a different supplier and cannot go on this bill.`);
    }

    /*
     * The receipt has to have reached the ACCOUNTS, not merely have happened.
     *
     * Receipts entered while "Record stock arriving from suppliers" was switched off put nothing
     * into GRNI. Clearing them anyway would debit a clearing account that was never credited and
     * leave 2115 permanently negative by the amount — a balance no report could account for and
     * no stocktake could contradict.
     */
    if (!posted.has(m.receiptId)) {
      throw badRequest(
        `${label} was never written to the accounts, so there is nothing on it to clear. It was `
          + 'recorded while "Record stock arriving from suppliers" was switched off — turn that '
          + 'on before billing goods received after it.',
      );
    }

    const outstanding = round2(receipt.totalAmount - (billed.get(m.receiptId) ?? 0));
    if (outstanding <= MONEY_EPSILON) {
      throw badRequest(`${label} has already been billed in full.`);
    }

    // Defaulted, because the whole receipt is what is being billed in nearly every case.
    const amount = round2(m.amount ?? outstanding);
    if (amount <= MONEY_EPSILON) {
      throw badRequest(`${label} is on this bill for nothing. Remove it, or give an amount.`);
    }
    if (amount - outstanding > MONEY_EPSILON) {
      throw badRequest(
        `${label} only has ${outstanding.toFixed(2)} left unbilled, and this bill claims `
          + `${amount.toFixed(2)}. If the supplier is charging more than the goods were booked `
          + 'at, put the difference on a separate charge line rather than against the receipt.',
      );
    }

    return { receiptId: new Types.ObjectId(m.receiptId), amount };
  });
}

async function prepareLines(
  input: BillInput,
): Promise<{ description: string; ledgerId: Types.ObjectId; amount: number }[]> {
  const lines = input.lines ?? [];
  if (lines.length === 0) return [];

  const ids = lines.map((l) => {
    if (!Types.ObjectId.isValid(l.ledgerId)) throw badRequest('That is not an account id.');
    return new Types.ObjectId(l.ledgerId);
  });

  const ledgers = await LedgerModel.find({ _id: { $in: ids } })
    .select('_id code name isActive isControl')
    .lean()
    .exec();
  const byId = new Map(ledgers.map((l) => [String(l._id), l]));

  return lines.map((l) => {
    const ledger = byId.get(l.ledgerId);
    if (!ledger) throw badRequest('One of the charges names an account that does not exist.');
    if (!ledger.isActive) {
      throw badRequest(`"${ledger.code} ${ledger.name}" is deactivated and cannot be billed to.`);
    }

    /*
     * A charge line may not point at a control account.
     *
     * Control accounts are totals of a subledger — receivables by shop, inventory by warehouse —
     * and a posting to one has to say which member of that subledger it belongs to. A freight
     * line on an invoice has no warehouse and no shop to name. Goods reach inventory through the
     * matched receipts instead, which is the path that carries a warehouse with it.
     */
    if (ledger.isControl) {
      throw badRequest(
        `"${ledger.code} ${ledger.name}" is a control account and is posted to by the module it `
          + 'summarises. Goods belong on this bill as matched goods receipts, not as a charge.',
      );
    }

    const amount = round2(l.amount);
    if (amount <= MONEY_EPSILON) {
      throw badRequest(`"${l.description}" is on this bill for nothing.`);
    }

    return { description: l.description.trim(), ledgerId: ledger._id, amount };
  });
}

/**
 * The duplicate-invoice check.
 *
 * Run before the write so the message is a sentence rather than an index violation. The unique
 * index behind it is what actually holds under a race — this only makes the ordinary case
 * readable.
 */
async function assertNotDuplicate(
  vendorId: Types.ObjectId,
  supplierBillNo: string | undefined,
  excludeBillId?: string,
): Promise<void> {
  if (!supplierBillNo) return;

  const query: Record<string, unknown> = { vendorId, supplierBillNo };
  if (excludeBillId) query._id = { $ne: new Types.ObjectId(excludeBillId) };

  const existing = await PurchaseBillModel.findOne(query)
    .collation({ locale: 'en', strength: 2 })
    .select('_id billNo status')
    .lean()
    .exec();

  if (!existing) return;

  const which = existing.billNo
    ? `bill B-${String(existing.billNo).padStart(4, '0')}`
    : 'a draft';
  const cancelled = existing.status === 'cancelled'
    ? ', which was cancelled — reopen that one rather than entering it again'
    : '';

  throw conflict(
    `Invoice "${supplierBillNo}" from this supplier is already recorded as ${which}${cancelled}.`,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type BillPaymentStatus = 'unpaid' | 'part_paid' | 'paid';

export interface BillView {
  id: string;
  billNo?: number;
  reference: string;
  vendorId: string;
  vendorName: string;
  supplierBillNo?: string;
  billDate: Date;
  dueDate: Date;
  goodsAmount: number;
  chargesAmount: number;
  taxAmount: number;
  totalAmount: number;
  status: 'draft' | 'posted' | 'cancelled';
  receiptCount: number;
  /** Settled by posted payments. Zero on a draft or a cancelled bill, which owe nothing. */
  paidAmount: number;
  outstanding: number;
  /** Null unless posted — a draft or a cancelled bill is not owed, so it is not "unpaid" either. */
  paymentStatus: BillPaymentStatus | null;
  isOverdue: boolean;
  journalEntryId?: string;
  notes?: string;
  createdAt: Date;
}

function toView(bill: IPurchaseBill, vendorName: string, paid = 0): BillView {
  const isPosted = bill.status === 'posted';
  const paidAmount = isPosted ? round2(paid) : 0;
  // Deliberately not clamped at zero. A negative figure here would mean a bill was settled
  // beyond its total, which the locks exist to prevent — and hiding it would hide that they failed.
  const outstanding = isPosted ? round2(bill.totalAmount - paidAmount) : 0;

  let paymentStatus: BillPaymentStatus | null = null;
  if (isPosted) {
    if (outstanding <= MONEY_EPSILON) paymentStatus = 'paid';
    else if (paidAmount > MONEY_EPSILON) paymentStatus = 'part_paid';
    else paymentStatus = 'unpaid';
  }

  return {
    id: String(bill._id),
    billNo: bill.billNo,
    reference: bill.billNo ? `B-${String(bill.billNo).padStart(4, '0')}` : 'Draft',
    vendorId: String(bill.vendorId),
    vendorName,
    supplierBillNo: bill.supplierBillNo,
    billDate: bill.billDate,
    dueDate: bill.dueDate,
    goodsAmount: round2(bill.matchedReceipts.reduce((s, m) => s + m.amount, 0)),
    chargesAmount: round2(bill.lines.reduce((s, l) => s + l.amount, 0)),
    taxAmount: round2(bill.taxAmount),
    totalAmount: round2(bill.totalAmount),
    status: bill.status,
    receiptCount: bill.matchedReceipts.length,
    paidAmount,
    outstanding,
    paymentStatus,
    // Overdue means money still owed past the date it was due. A bill paid in full is not
    // overdue however old it is, and a draft owes nobody anything yet — colouring either red
    // would send somebody chasing a payment that is not owed.
    isOverdue: isPosted && outstanding > MONEY_EPSILON && bill.dueDate.getTime() < Date.now(),
    journalEntryId: bill.journalEntryId ? String(bill.journalEntryId) : undefined,
    notes: bill.notes,
    createdAt: bill.createdAt,
  };
}

export interface BillFilters {
  vendorId?: string;
  status?: 'draft' | 'posted' | 'cancelled' | 'all';
  from?: string;
  to?: string;
  overdue?: boolean;
  search?: string;
}

export async function listBills(filters: BillFilters = {}): Promise<BillView[]> {
  const query: Record<string, unknown> = {};

  if (filters.vendorId && Types.ObjectId.isValid(filters.vendorId)) {
    query.vendorId = new Types.ObjectId(filters.vendorId);
  }
  if (filters.status && filters.status !== 'all') query.status = filters.status;

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) range.$lte = new Date(filters.to);
    query.billDate = range;
  }

  if (filters.overdue) {
    query.status = 'posted';
    query.dueDate = { $lt: new Date() };
  }

  if (filters.search?.trim()) {
    // Escaped, so a supplier reference typed with a dot in it does not become a wildcard.
    const safe = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.supplierBillNo = new RegExp(safe, 'i');
  }

  const bills = await PurchaseBillModel.find(query)
    .sort({ billDate: -1, createdAt: -1 })
    .limit(500)
    .exec();

  const [vendors, paid] = await Promise.all([
    VendorModel.find({ _id: { $in: bills.map((b) => b.vendorId) } })
      .select('_id name')
      .lean()
      .exec(),
    paidByBill(bills.filter((b) => b.status === 'posted').map((b) => b._id)),
  ]);
  const nameById = new Map(vendors.map((v) => [String(v._id), v.name]));

  const views = bills.map((b) =>
    toView(
      b,
      nameById.get(String(b.vendorId)) ?? 'Unknown supplier',
      paid.get(String(b._id)) ?? 0,
    ),
  );

  // The query narrowed to posted bills past their due date. One of those paid in full is past
  // due but not overdue, and it is taken out here, where what has been paid is finally known.
  return filters.overdue ? views.filter((v) => v.isOverdue) : views;
}

export interface BillDetail extends BillView {
  matchedReceipts: {
    receiptId: string;
    documentNo?: number;
    receiptDate?: Date;
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
  /** The posted payments that settled part of this bill, oldest first. */
  payments: BillPaymentLine[];
  cancelReason?: string;
}

export async function getBill(id: string): Promise<BillDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Bill not found');

  const bill = await PurchaseBillModel.findById(id).exec();
  if (!bill) throw notFound('Bill not found');

  const [vendor, receipts, ledgers, paid, payments] = await Promise.all([
    VendorModel.findById(bill.vendorId).select('name').lean().exec(),
    StockReceiptModel.find({ _id: { $in: bill.matchedReceipts.map((m) => m.receiptId) } })
      .select('_id documentNo receiptDate supplierName totalAmount')
      .lean()
      .exec(),
    LedgerModel.find({ _id: { $in: bill.lines.map((l) => l.ledgerId) } })
      .select('_id code name')
      .lean()
      .exec(),
    paidByBill([bill._id]),
    paymentsForBill(id),
  ]);

  const receiptById = new Map(receipts.map((r) => [String(r._id), r]));
  const ledgerById = new Map(ledgers.map((l) => [String(l._id), l]));

  return {
    ...toView(bill, vendor?.name ?? 'Unknown supplier', paid.get(String(bill._id)) ?? 0),
    payments,
    cancelReason: bill.cancelReason,
    matchedReceipts: bill.matchedReceipts.map((m) => {
      const receipt = receiptById.get(String(m.receiptId));
      return {
        receiptId: String(m.receiptId),
        documentNo: receipt?.documentNo,
        receiptDate: receipt?.receiptDate,
        typedName: receipt?.supplierName,
        receiptTotal: round2(receipt?.totalAmount ?? 0),
        amount: round2(m.amount),
      };
    }),
    lines: bill.lines.map((l) => {
      const ledger = ledgerById.get(String(l.ledgerId));
      return {
        description: l.description,
        ledgerId: String(l.ledgerId),
        ledgerCode: ledger?.code ?? '',
        ledgerName: ledger?.name ?? 'Unknown account',
        amount: round2(l.amount),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createBill(input: BillInput, actorId?: string): Promise<BillDetail> {
  const prepared = await prepare(input);
  await assertNotDuplicate(prepared.vendorId, prepared.supplierBillNo);

  // No number allocated here. A draft somebody abandons must not leave a gap in the printed
  // series — the rule every finance document follows, in `finance-counters.ts`.
  const bill = await PurchaseBillModel.create({
    ...prepared,
    status: 'draft',
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'bill',
    entityId: String(bill._id),
    action: 'created',
    meta: { vendor: prepared.vendorName, total: prepared.totalAmount },
  });

  return getBill(String(bill._id));
}

export async function updateBill(
  id: string,
  input: BillInput,
  actorId?: string,
): Promise<BillDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Bill not found');

  const bill = await PurchaseBillModel.findById(id).exec();
  if (!bill) throw notFound('Bill not found');

  /*
   * Only a draft is editable, and there is no reverse-and-repost underneath.
   *
   * A goods receipt may be corrected in place because the entry it produced is DERIVED from it
   * and can be rebuilt from the same source. A bill is not derived from anything — it IS the
   * source. Quietly reversing a posted supplier invoice because somebody changed a figure on a
   * form is how a payment run pays an amount nobody approved. Cancel it and raise the corrected
   * one, so both documents exist.
   */
  if (bill.status !== 'draft') {
    throw badRequest(
      `This bill is ${bill.status} and cannot be edited. Cancel it and enter a corrected one, so `
        + 'both the original and the correction stay on the record.',
    );
  }

  const prepared = await prepare(input, { billId: id });
  await assertNotDuplicate(prepared.vendorId, prepared.supplierBillNo, id);

  Object.assign(bill, prepared, { updatedBy: actorId ? new Types.ObjectId(actorId) : undefined });
  // `Object.assign` does not clear a field the new version leaves out, and both of these are
  // optional — so a bill whose invoice number was removed would otherwise keep the old one.
  bill.supplierBillNo = prepared.supplierBillNo;
  bill.notes = prepared.notes;
  await bill.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'bill',
    entityId: id,
    action: 'updated',
    meta: { vendor: prepared.vendorName, total: prepared.totalAmount },
  });

  return getBill(id);
}

export async function deleteBill(id: string, actorId?: string): Promise<{ message: string }> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Bill not found');

  const bill = await PurchaseBillModel.findById(id).lean().exec();
  if (!bill) throw notFound('Bill not found');

  if (bill.status !== 'draft') {
    throw badRequest(
      `This bill is ${bill.status}. A bill that has been posted is cancelled, never deleted — `
        + 'the document and its entry both stay on the record.',
    );
  }

  await PurchaseBillModel.deleteOne({ _id: bill._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'bill',
    entityId: id,
    action: 'deleted',
    meta: { total: bill.totalAmount },
  });

  return { message: 'Draft bill deleted' };
}

/**
 * Post a bill to the accounts.
 *
 *     Dr  Goods Received Not Invoiced    the goods, clearing what the receipts put there
 *     Dr  each charge account            freight, service, handling
 *     Dr  Input Tax                      claimable on the return
 *         Cr  Accounts Payable           the whole invoice, tagged with the supplier
 *
 * ## Order of operations, and why it survives being interrupted
 *
 * The entry is written FIRST and the bill is stamped second. If the process dies between the
 * two, the bill is still a draft, and posting it again re-runs `postEntry` with the same
 * idempotency key — which finds the entry already there and returns it untouched rather than
 * writing a second one. Stamping first would leave the opposite: a bill that says it posted with
 * nothing in the accounts behind it, which nothing would ever detect.
 *
 * ## Why it holds locks
 *
 * Two bills posted at the same moment against the same delivery would each see it unbilled and
 * each clear it — the one failure in this module that silently drives GRNI negative. Holding
 * `receipt:<id>` for every delivery on the bill refuses the second; pressed again, it meets the
 * ordinary check that says the goods are already billed.
 */
export async function postBill(id: string, actorId?: string): Promise<BillDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Bill not found');

  const peek = await PurchaseBillModel.findById(id).select('matchedReceipts').lean().exec();
  if (!peek) throw notFound('Bill not found');

  const lockedReceipts = new Set(peek.matchedReceipts.map((m) => String(m.receiptId)));
  const keys = [`bill:${id}`, ...[...lockedReceipts].map((r) => `receipt:${r}`)];

  return withFinanceLocks(
    keys,
    () => postBillHoldingLocks(id, lockedReceipts, actorId),
    'This bill, or one of the deliveries on it, is being worked on by somebody else right now. '
      + 'Try again in a moment.',
  );
}

async function postBillHoldingLocks(
  id: string,
  lockedReceipts: Set<string>,
  actorId?: string,
): Promise<BillDetail> {
  const bill = await PurchaseBillModel.findById(id).exec();
  if (!bill) throw notFound('Bill not found');
  if (bill.status === 'posted') return getBill(id);
  if (bill.status !== 'draft') {
    throw badRequest(`This bill is ${bill.status} and cannot be posted.`);
  }

  // Re-checked against the world as it is NOW, not as it was when the draft was typed.
  const prepared = await prepare(
    {
      vendorId: String(bill.vendorId),
      supplierBillNo: bill.supplierBillNo,
      billDate: bill.billDate,
      dueDate: bill.dueDate,
      matchedReceipts: bill.matchedReceipts.map((m) => ({
        receiptId: String(m.receiptId),
        amount: m.amount,
      })),
      lines: bill.lines.map((l) => ({
        description: l.description,
        ledgerId: String(l.ledgerId),
        amount: l.amount,
      })),
      taxAmount: bill.taxAmount,
      notes: bill.notes,
    },
    { billId: id },
  );

  // The draft was edited between reading which deliveries to lock and taking the locks. Posting
  // anyway would clear a receipt nobody is holding — the race the locks exist to close.
  if (prepared.matchedReceipts.some((m) => !lockedReceipts.has(String(m.receiptId)))) {
    throw conflict('This bill changed while it was being posted. Open it again and post it.');
  }

  const goodsTotal = round2(prepared.matchedReceipts.reduce((s, m) => s + m.amount, 0));

  const [grni, apTrade, inputTax] = await Promise.all([
    goodsTotal > 0 ? ledgerIdForRole('grni') : Promise.resolve(''),
    ledgerIdForRole('apTrade'),
    prepared.taxAmount > 0 ? ledgerIdForRole('inputTax') : Promise.resolve(''),
  ]);

  const entryLines: {
    ledgerId: string;
    debit?: number;
    credit?: number;
    lineNarration?: string;
    subledgerRef?: { type: string; id: string } | null;
  }[] = [];

  if (goodsTotal > 0) {
    entryLines.push({ ledgerId: grni, debit: goodsTotal, lineNarration: 'Goods billed' });
  }
  for (const line of prepared.lines) {
    entryLines.push({
      ledgerId: String(line.ledgerId),
      debit: line.amount,
      lineNarration: line.description,
    });
  }
  if (prepared.taxAmount > 0) {
    entryLines.push({ ledgerId: inputTax, debit: prepared.taxAmount, lineNarration: 'Input tax' });
  }
  entryLines.push({
    ledgerId: apTrade,
    credit: prepared.totalAmount,
    subledgerRef: { type: 'vendor', id: String(prepared.vendorId) },
  });

  const entry = await postEntry(
    {
      date: prepared.billDate,
      narration: `Bill from ${prepared.vendorName}`
        + (prepared.supplierBillNo ? ` — ${prepared.supplierBillNo}` : ''),
      referenceNo: prepared.supplierBillNo,
      sourceType: 'bill',
      sourceId: id,
      sourceModel: 'PurchaseBill',
      // Stable, with no timestamp in it. A posted bill is never edited and re-posted, so there
      // is no second version of it for a stamp to tell apart — and a moving key would let a
      // double-click write the same invoice twice.
      idempotencyKey: buildIdempotencyKey('purchase_bill', id, 'bill'),
      lines: entryLines,
    },
    actorId,
  );

  // Allocated only now, once the entry is down, so a bill that failed validation never burns a
  // number somebody will later ask about the absence of.
  if (!bill.billNo) bill.billNo = await allocateNextFinanceNo('financeBillNo');
  bill.status = 'posted';
  bill.journalEntryId = entry._id;
  bill.postedAt = new Date();
  bill.postedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await bill.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'bill',
    entityId: id,
    action: 'posted',
    meta: {
      billNo: bill.billNo,
      vendor: prepared.vendorName,
      total: prepared.totalAmount,
      goods: goodsTotal,
    },
  });

  return getBill(id);
}

/**
 * Cancel a posted bill: reverse its entry, and release the receipts it was holding.
 *
 * The release needs no code of its own — `billedByReceipt` counts only posted bills, so the
 * moment this one stops being posted its receipts are open again. That is the whole reason the
 * billed figure is derived rather than stored.
 */
export async function cancelBill(
  id: string,
  reason: string,
  actorId?: string,
): Promise<BillDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Bill not found');

  // Held against a payment being released on this bill at the same moment, which would otherwise
  // land on a bill whose debt had just been reversed away.
  return withFinanceLocks([`bill:${id}`], () => cancelBillHoldingLock(id, reason, actorId));
}

async function cancelBillHoldingLock(
  id: string,
  reason: string,
  actorId?: string,
): Promise<BillDetail> {
  const bill = await PurchaseBillModel.findById(id).exec();
  if (!bill) throw notFound('Bill not found');
  if (bill.status === 'cancelled') throw conflict('This bill has already been cancelled.');
  if (bill.status !== 'posted') {
    throw badRequest('This bill was never posted. Delete the draft instead of cancelling it.');
  }

  /*
   * A bill with payments standing against it cannot be cancelled. Reversing it would take the
   * debt out of Accounts Payable while the payments that settled it stayed — the supplier would
   * then look paid for nothing, and appear to owe the money back.
   */
  const paid = (await paidByBill([bill._id])).get(String(bill._id)) ?? 0;
  if (paid > MONEY_EPSILON) {
    throw badRequest(
      `${paid.toFixed(2)} has been paid against this bill. Cancel those payments first — `
        + 'cancelling the bill while they stand would leave them paying for nothing.',
    );
  }

  if (bill.journalEntryId) {
    const entry = await JournalEntryModel.findById(bill.journalEntryId)
      .select('status')
      .lean()
      .exec();

    // Already reversed from the journal screen — the accounts are right, so finish the job on
    // the document rather than refusing and leaving the two out of step with each other.
    if (entry && entry.status === 'posted') {
      await reverseEntry(String(bill.journalEntryId), { reason }, actorId);
    }
  }

  bill.status = 'cancelled';
  bill.cancelledAt = new Date();
  bill.cancelledBy = actorId ? new Types.ObjectId(actorId) : undefined;
  bill.cancelReason = reason.trim();
  await bill.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'bill',
    entityId: id,
    action: 'cancelled',
    meta: { billNo: bill.billNo, total: bill.totalAmount, reason: reason.trim() },
  });

  return getBill(id);
}
