import { Types } from 'mongoose';
import {
  SupplierPaymentModel,
  ISupplierPayment,
  PaymentMethod,
  PAYMENT_METHODS,
} from '../../models/supplier-payment.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { VendorModel } from '../../models/vendor.model';
import { LedgerModel } from '../../models/ledger.model';
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
 * Paying suppliers.
 *
 * ## Two questions, answered from two different places on purpose
 *
 * "How much do we owe Acme?" is answered by the LEDGER — the supplier's share of Accounts Payable.
 * "Which of Acme's invoices are still unpaid?" is answered by the ALLOCATIONS on payments.
 *
 * Keeping them apart is what lets a payment be made on account, before an invoice exists or as a
 * round figure against several, without the supplier's balance being wrong for a single moment.
 * The allocations can be incomplete; the balance never is.
 *
 * ## The one rule that is enforced hard
 *
 * A bill may never be settled beyond what it is for. Over-settling it would not unbalance the
 * books — the ledger entry is right either way — but it would show an invoice as paid that was
 * not, and the next payment run would skip a supplier who is still owed money.
 */

export function paymentReference(no?: number): string {
  return no ? `P-${String(no).padStart(4, '0')}` : 'Draft';
}

function billReference(no?: number): string {
  return no ? `B-${String(no).padStart(4, '0')}` : 'Draft';
}

const METHOD_WORDS: Record<PaymentMethod, string> = {
  cash: 'in cash',
  bank_transfer: 'by bank transfer',
  cheque: 'by cheque',
};

// ---------------------------------------------------------------------------
// What a bill still has unpaid
// ---------------------------------------------------------------------------

/**
 * How much of each bill has been paid.
 *
 * Derived from posted payments every time, for the same reason `billedByReceipt` is: a stored
 * `paidAmount` on the bill would need adjusting on every post, cancel and draft edit, and the
 * first missed path would leave it wrong with nothing to compare it against. Cancelling a payment
 * releases its bills with no second write because they simply stop being counted.
 */
export async function paidByBill(
  billIds: Types.ObjectId[],
  options: { excludePaymentId?: string } = {},
): Promise<Map<string, number>> {
  if (billIds.length === 0) return new Map();

  const match: Record<string, unknown> = {
    status: 'posted',
    'allocations.billId': { $in: billIds },
  };
  if (options.excludePaymentId && Types.ObjectId.isValid(options.excludePaymentId)) {
    match._id = { $ne: new Types.ObjectId(options.excludePaymentId) };
  }

  const rows = await SupplierPaymentModel.aggregate<{ _id: Types.ObjectId; paid: number }>([
    { $match: match },
    { $unwind: '$allocations' },
    { $match: { 'allocations.billId': { $in: billIds } } },
    { $group: { _id: '$allocations.billId', paid: { $sum: '$allocations.amount' } } },
  ]).exec();

  return new Map(rows.map((r) => [String(r._id), round2(r.paid)]));
}

export interface BillPaymentLine {
  paymentId: string;
  reference: string;
  paymentDate: Date;
  method: PaymentMethod;
  amount: number;
}

/** The posted payments that settled part of one bill — shown on the bill itself. */
export async function paymentsForBill(billId: string): Promise<BillPaymentLine[]> {
  if (!Types.ObjectId.isValid(billId)) return [];
  const id = new Types.ObjectId(billId);

  const payments = await SupplierPaymentModel.find({ status: 'posted', 'allocations.billId': id })
    .select('_id paymentNo paymentDate method allocations')
    .sort({ paymentDate: 1, createdAt: 1 })
    .lean()
    .exec();

  return payments.map((p) => ({
    paymentId: String(p._id),
    reference: paymentReference(p.paymentNo),
    paymentDate: p.paymentDate,
    method: p.method,
    amount: round2(
      p.allocations
        .filter((a) => String(a.billId) === billId)
        .reduce((sum, a) => sum + a.amount, 0),
    ),
  }));
}

export interface OpenBill {
  id: string;
  reference: string;
  supplierBillNo?: string;
  billDate: Date;
  dueDate: Date;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  isOverdue: boolean;
}

/**
 * A supplier's posted bills with something still unpaid, oldest due date first.
 *
 * Oldest first because that is the order suppliers expect to be paid in, and the order in which
 * a late payment starts costing goodwill. The form offers them in this order; it does not tick
 * any of them.
 */
export async function openBillsForVendor(
  vendorId: string,
  options: { includePaymentId?: string } = {},
): Promise<OpenBill[]> {
  if (!Types.ObjectId.isValid(vendorId)) throw badRequest('That is not a supplier id.');

  const bills = await PurchaseBillModel.find({
    vendorId: new Types.ObjectId(vendorId),
    status: 'posted',
  })
    .select('_id billNo supplierBillNo billDate dueDate totalAmount')
    .sort({ dueDate: 1, billDate: 1 })
    .lean()
    .exec();

  // A payment being edited must see its own bills as still open, or reopening it would report
  // every allocation as over-paid by exactly what that same payment already puts against them.
  const paid = await paidByBill(
    bills.map((b) => b._id),
    { excludePaymentId: options.includePaymentId },
  );
  const now = Date.now();

  return bills
    .map((b) => {
      const paidAmount = paid.get(String(b._id)) ?? 0;
      const outstanding = round2(b.totalAmount - paidAmount);
      return {
        id: String(b._id),
        reference: billReference(b.billNo),
        supplierBillNo: b.supplierBillNo,
        billDate: b.billDate,
        dueDate: b.dueDate,
        totalAmount: round2(b.totalAmount),
        paidAmount,
        outstanding,
        isOverdue: b.dueDate.getTime() < now,
      };
    })
    .filter((b) => b.outstanding > MONEY_EPSILON);
}

// ---------------------------------------------------------------------------
// Building and checking a payment
// ---------------------------------------------------------------------------

export interface PaymentInput {
  vendorId: string;
  paymentDate: Date | string;
  method: PaymentMethod;
  paidFromLedgerId: string;
  chequeNo?: string;
  chequeDate?: Date | string | null;
  transferReference?: string;
  amount: number;
  allocations?: { billId: string; amount?: number }[];
  notes?: string;
}

interface PreparedPayment {
  vendorId: Types.ObjectId;
  vendorName: string;
  paymentDate: Date;
  method: PaymentMethod;
  paidFromLedgerId: Types.ObjectId;
  chequeNo?: string;
  chequeDate?: Date;
  transferReference?: string;
  amount: number;
  allocations: { billId: Types.ObjectId; amount: number }[];
  notes?: string;
}

/**
 * Everything that has to be true before a payment is worth writing down.
 *
 * Run on create, on edit, and again inside the lock at post. A draft can sit while its bills
 * are paid by somebody else or cancelled, and only the check at post sees the world as it is.
 */
async function prepare(
  input: PaymentInput,
  options: { paymentId?: string } = {},
): Promise<PreparedPayment> {
  if (!Types.ObjectId.isValid(input.vendorId)) throw badRequest('That is not a supplier id.');

  const vendor = await VendorModel.findById(input.vendorId).lean().exec();
  if (!vendor) throw notFound('Supplier not found');

  if (vendor.isPlaceholder) {
    throw badRequest(
      `"${vendor.name}" is the holding record for receipts whose supplier was never identified. `
        + 'Money cannot be paid to "not identified" — find out who the supplier is first.',
    );
  }

  const paymentDate = new Date(input.paymentDate);
  if (Number.isNaN(paymentDate.getTime())) throw badRequest('The payment date is not a date.');

  if (!PAYMENT_METHODS.includes(input.method)) {
    throw badRequest('Say whether this was paid in cash, by bank transfer, or by cheque.');
  }

  const amount = round2(input.amount);
  if (!(amount > MONEY_EPSILON)) throw badRequest('A payment has to be for something.');

  const paidFrom = await loadPaidFromAccount(input.paidFromLedgerId);

  let chequeNo: string | undefined;
  let chequeDate: Date | undefined;
  if (input.method === 'cheque') {
    chequeNo = input.chequeNo?.trim() || undefined;
    if (!chequeNo) throw badRequest('A cheque needs its cheque number.');
    chequeDate = input.chequeDate ? new Date(input.chequeDate) : paymentDate;
    if (Number.isNaN(chequeDate.getTime())) throw badRequest('The cheque date is not a date.');
  }

  const allocations = await prepareAllocations(
    input.allocations ?? [],
    vendor._id,
    amount,
    options.paymentId,
  );

  return {
    vendorId: vendor._id,
    vendorName: vendor.name,
    paymentDate,
    method: input.method,
    paidFromLedgerId: paidFrom._id,
    chequeNo,
    chequeDate,
    // A cheque is found by its number; a reference beside it would be a second identifier that
    // could disagree with the first.
    transferReference: input.method === 'cheque'
      ? undefined
      : input.transferReference?.trim() || undefined,
    amount,
    allocations,
    notes: input.notes?.trim() || undefined,
  };
}

async function prepareAllocations(
  requested: { billId: string; amount?: number }[],
  vendorId: Types.ObjectId,
  paymentAmount: number,
  paymentId?: string,
): Promise<{ billId: Types.ObjectId; amount: number }[]> {
  if (requested.length === 0) return [];

  const ids = requested.map((a) => {
    if (!Types.ObjectId.isValid(a.billId)) throw badRequest('That is not a bill id.');
    return new Types.ObjectId(a.billId);
  });

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(String(id))) throw badRequest('The same bill is on this payment twice.');
    seen.add(String(id));
  }

  const [bills, paid] = await Promise.all([
    PurchaseBillModel.find({ _id: { $in: ids } })
      .select('_id billNo supplierBillNo status vendorId totalAmount')
      .lean()
      .exec(),
    paidByBill(ids, { excludePaymentId: paymentId }),
  ]);
  const byId = new Map(bills.map((b) => [String(b._id), b]));

  let remaining = paymentAmount;

  return requested.map((a) => {
    const bill = byId.get(a.billId);
    if (!bill) throw badRequest('One of the bills on this payment no longer exists.');

    const label = bill.billNo
      ? `Bill ${billReference(bill.billNo)}${bill.supplierBillNo ? ` (${bill.supplierBillNo})` : ''}`
      : 'One of the bills';

    if (bill.status === 'draft') {
      throw badRequest(
        `${label} is still a draft. Post it before paying it — until then nothing is owed on it.`,
      );
    }
    if (bill.status !== 'posted') {
      throw badRequest(`${label} was cancelled, so there is nothing on it to pay.`);
    }
    if (String(bill.vendorId) !== String(vendorId)) {
      throw badRequest(`${label} is from a different supplier and cannot go on this payment.`);
    }

    const outstanding = round2(bill.totalAmount - (paid.get(a.billId) ?? 0));
    if (outstanding <= MONEY_EPSILON) throw badRequest(`${label} has already been paid in full.`);

    if (a.amount === undefined && remaining <= MONEY_EPSILON) {
      throw badRequest(
        `This payment is already fully set against the bills above ${label}, so there is none of `
          + 'it left to put against this one.',
      );
    }

    // Defaulted to what is owed, but never more than what is left of the payment.
    const amount = round2(a.amount ?? Math.min(outstanding, remaining));
    if (amount <= MONEY_EPSILON) {
      throw badRequest(`${label} is on this payment for nothing. Remove it, or give an amount.`);
    }
    if (amount - outstanding > MONEY_EPSILON) {
      throw badRequest(
        `${label} only has ${outstanding.toFixed(2)} left to pay, and this payment puts `
          + `${amount.toFixed(2)} against it. Anything paid over what a bill is for can be left `
          + 'unallocated — it stays on account and is set against their next bill.',
      );
    }

    remaining = round2(remaining - amount);
    if (remaining < -MONEY_EPSILON) {
      throw badRequest(
        'The bills on this payment add up to more than the payment itself. Reduce one, or leave '
          + 'part of a bill unpaid for now.',
      );
    }

    return { billId: bill._id, amount };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface PaymentView {
  id: string;
  paymentNo?: number;
  reference: string;
  vendorId: string;
  vendorName: string;
  paymentDate: Date;
  method: PaymentMethod;
  paidFromLedgerId: string;
  paidFromName: string;
  chequeNo?: string;
  chequeDate?: Date;
  chequeClearedAt?: Date;
  /** A released cheque that has not shown on the bank statement yet. */
  isChequeUncleared: boolean;
  transferReference?: string;
  amount: number;
  allocatedAmount: number;
  /** Paid, but not set against any bill yet — held on account against the supplier. */
  unallocatedAmount: number;
  billCount: number;
  status: 'draft' | 'posted' | 'cancelled';
  journalEntryId?: string;
  notes?: string;
  createdAt: Date;
}

function toView(
  payment: ISupplierPayment,
  vendorName: string,
  paidFromName: string,
): PaymentView {
  const allocatedAmount = round2(payment.allocations.reduce((s, a) => s + a.amount, 0));
  return {
    id: String(payment._id),
    paymentNo: payment.paymentNo,
    reference: paymentReference(payment.paymentNo),
    vendorId: String(payment.vendorId),
    vendorName,
    paymentDate: payment.paymentDate,
    method: payment.method,
    paidFromLedgerId: String(payment.paidFromLedgerId),
    paidFromName,
    chequeNo: payment.chequeNo,
    chequeDate: payment.chequeDate,
    chequeClearedAt: payment.chequeClearedAt,
    isChequeUncleared:
      payment.method === 'cheque' && payment.status === 'posted' && !payment.chequeClearedAt,
    transferReference: payment.transferReference,
    amount: round2(payment.amount),
    allocatedAmount,
    unallocatedAmount: round2(payment.amount - allocatedAmount),
    billCount: payment.allocations.length,
    status: payment.status,
    journalEntryId: payment.journalEntryId ? String(payment.journalEntryId) : undefined,
    notes: payment.notes,
    createdAt: payment.createdAt,
  };
}

export interface PaymentFilters {
  vendorId?: string;
  status?: 'draft' | 'posted' | 'cancelled' | 'all';
  method?: PaymentMethod;
  from?: string;
  to?: string;
  search?: string;
  /** Released cheques not yet seen on the bank statement — the bank reconciliation worklist. */
  unclearedCheques?: boolean;
}

export async function listPayments(filters: PaymentFilters = {}): Promise<PaymentView[]> {
  const query: Record<string, unknown> = {};

  if (filters.vendorId && Types.ObjectId.isValid(filters.vendorId)) {
    query.vendorId = new Types.ObjectId(filters.vendorId);
  }
  if (filters.status && filters.status !== 'all') query.status = filters.status;
  if (filters.method && PAYMENT_METHODS.includes(filters.method)) query.method = filters.method;

  if (filters.unclearedCheques) {
    query.method = 'cheque';
    query.status = 'posted';
    // Matches a field that was never set as well as one set to null.
    query.chequeClearedAt = null;
  }

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = new Date(filters.from);
    if (filters.to) range.$lte = new Date(filters.to);
    query.paymentDate = range;
  }

  if (filters.search?.trim()) {
    const safe = filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(safe, 'i');
    query.$or = [{ chequeNo: pattern }, { transferReference: pattern }];
  }

  const payments = await SupplierPaymentModel.find(query)
    .sort({ paymentDate: -1, createdAt: -1 })
    .limit(500)
    .exec();

  const [vendors, ledgers] = await Promise.all([
    VendorModel.find({ _id: { $in: payments.map((p) => p.vendorId) } })
      .select('_id name')
      .lean()
      .exec(),
    LedgerModel.find({ _id: { $in: payments.map((p) => p.paidFromLedgerId) } })
      .select('_id code name')
      .lean()
      .exec(),
  ]);
  const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
  const ledgerName = new Map(ledgers.map((l) => [String(l._id), `${l.code} ${l.name}`]));

  return payments.map((p) =>
    toView(
      p,
      vendorName.get(String(p.vendorId)) ?? 'Unknown supplier',
      ledgerName.get(String(p.paidFromLedgerId)) ?? 'Unknown account',
    ),
  );
}

export interface PaymentDetail extends PaymentView {
  allocations: {
    billId: string;
    reference: string;
    supplierBillNo?: string;
    billDate?: Date;
    billTotal: number;
    amount: number;
  }[];
  cancelReason?: string;
}

export async function getPayment(id: string): Promise<PaymentDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payment not found');

  const payment = await SupplierPaymentModel.findById(id).exec();
  if (!payment) throw notFound('Payment not found');

  const [vendor, ledger, bills] = await Promise.all([
    VendorModel.findById(payment.vendorId).select('name').lean().exec(),
    LedgerModel.findById(payment.paidFromLedgerId).select('code name').lean().exec(),
    PurchaseBillModel.find({ _id: { $in: payment.allocations.map((a) => a.billId) } })
      .select('_id billNo supplierBillNo billDate totalAmount')
      .lean()
      .exec(),
  ]);
  const billById = new Map(bills.map((b) => [String(b._id), b]));

  return {
    ...toView(
      payment,
      vendor?.name ?? 'Unknown supplier',
      ledger ? `${ledger.code} ${ledger.name}` : 'Unknown account',
    ),
    cancelReason: payment.cancelReason,
    allocations: payment.allocations.map((a) => {
      const bill = billById.get(String(a.billId));
      return {
        billId: String(a.billId),
        reference: billReference(bill?.billNo),
        supplierBillNo: bill?.supplierBillNo,
        billDate: bill?.billDate,
        billTotal: round2(bill?.totalAmount ?? 0),
        amount: round2(a.amount),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createPayment(input: PaymentInput, actorId?: string): Promise<PaymentDetail> {
  const prepared = await prepare(input);
  await assertChequeLeafUnused(prepared.paidFromLedgerId, prepared.chequeNo);

  // No number yet. The series is allocated at posting, so an abandoned draft leaves no gap.
  const payment = await SupplierPaymentModel.create({
    ...prepared,
    status: 'draft',
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'payment',
    entityId: String(payment._id),
    action: 'created',
    meta: { vendor: prepared.vendorName, amount: prepared.amount, method: prepared.method },
  });

  return getPayment(String(payment._id));
}

export async function updatePayment(
  id: string,
  input: PaymentInput,
  actorId?: string,
): Promise<PaymentDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payment not found');

  const payment = await SupplierPaymentModel.findById(id).exec();
  if (!payment) throw notFound('Payment not found');

  /*
   * A posted payment is money that has already gone. Editing the record of it would change what
   * the books say was paid without anything having happened in the world, so it is cancelled
   * and re-entered instead, and both stay on the record.
   */
  if (payment.status !== 'draft') {
    throw badRequest(
      `This payment is ${payment.status} and cannot be edited. Cancel it and enter a corrected `
        + 'one, so both the original and the correction stay on the record.',
    );
  }

  const prepared = await prepare(input, { paymentId: id });
  await assertChequeLeafUnused(prepared.paidFromLedgerId, prepared.chequeNo, { paymentId: id });

  Object.assign(payment, prepared, {
    updatedBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });
  // `Object.assign` leaves a field in place when the new version omits it, and every one of these
  // is optional — switching a cheque to a bank transfer would otherwise keep the cheque number.
  payment.chequeNo = prepared.chequeNo;
  payment.chequeDate = prepared.chequeDate;
  payment.transferReference = prepared.transferReference;
  payment.notes = prepared.notes;
  await payment.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'payment',
    entityId: id,
    action: 'updated',
    meta: { vendor: prepared.vendorName, amount: prepared.amount },
  });

  return getPayment(id);
}

export async function deletePayment(id: string, actorId?: string): Promise<{ message: string }> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payment not found');

  const payment = await SupplierPaymentModel.findById(id).lean().exec();
  if (!payment) throw notFound('Payment not found');

  if (payment.status !== 'draft') {
    throw badRequest(
      `This payment is ${payment.status}. A payment that has been posted is cancelled, never `
        + 'deleted — the record of money leaving has to survive being called off.',
    );
  }

  await SupplierPaymentModel.deleteOne({ _id: payment._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'payment',
    entityId: id,
    action: 'deleted',
    meta: { amount: payment.amount },
  });

  return { message: 'Draft payment deleted' };
}

/**
 * Post a payment to the accounts.
 *
 *     Dr  Accounts Payable                  the supplier is owed less
 *         Cr  Cash / Bank                   money left that account
 *         Cr  Cheques Issued, Uncleared     — instead, for a cheque, until it clears
 *
 * ## Why it holds locks
 *
 * Two payments against the same invoice, posted at the same moment, would each see the whole
 * invoice unpaid and each settle it. Holding `bill:<id>` for every bill on the payment refuses the
 * second — pressed again, its validation sees the first payment and says the bill is settled.
 *
 * ## Order of operations
 *
 * Entry first, document second, exactly as bills do: an interruption between the two leaves a
 * draft whose retry finds the entry by its idempotency key and finishes the stamp. The reverse
 * order would leave a payment that says it posted with no money recorded as leaving.
 */
export async function postPayment(id: string, actorId?: string): Promise<PaymentDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payment not found');

  const peek = await SupplierPaymentModel.findById(id).select('allocations').lean().exec();
  if (!peek) throw notFound('Payment not found');

  const lockedBills = new Set(peek.allocations.map((a) => String(a.billId)));
  const keys = [`payment:${id}`, ...[...lockedBills].map((b) => `bill:${b}`)];

  return withFinanceLocks(
    keys,
    async () => {
      const payment = await SupplierPaymentModel.findById(id).exec();
      if (!payment) throw notFound('Payment not found');
      if (payment.status === 'posted') return getPayment(id);
      if (payment.status !== 'draft') {
        throw badRequest(`This payment is ${payment.status} and cannot be posted.`);
      }

      const prepared = await prepare(
        {
          vendorId: String(payment.vendorId),
          paymentDate: payment.paymentDate,
          method: payment.method,
          paidFromLedgerId: String(payment.paidFromLedgerId),
          chequeNo: payment.chequeNo,
          chequeDate: payment.chequeDate,
          transferReference: payment.transferReference,
          amount: payment.amount,
          allocations: payment.allocations.map((a) => ({
            billId: String(a.billId),
            amount: a.amount,
          })),
          notes: payment.notes,
        },
        { paymentId: id },
      );

      // The draft was edited between reading which bills to lock and taking the locks. Posting
      // anyway would settle a bill nobody is holding, which is the race the locks exist for.
      if (prepared.allocations.some((a) => !lockedBills.has(String(a.billId)))) {
        throw conflict('This payment changed while it was being posted. Open it again and post it.');
      }

      const [apTrade, creditLedger] = await Promise.all([
        ledgerIdForRole('apTrade'),
        prepared.method === 'cheque'
          ? ledgerIdForRole('chequesIssued')
          : Promise.resolve(String(prepared.paidFromLedgerId)),
      ]);

      const instrument = prepared.method === 'cheque'
        ? `by cheque ${prepared.chequeNo}`
        : METHOD_WORDS[prepared.method];

      const entry = await postEntry(
        {
          date: prepared.paymentDate,
          narration: `Paid ${prepared.vendorName} ${instrument}`,
          referenceNo: prepared.chequeNo ?? prepared.transferReference,
          sourceType: 'payment_made',
          sourceId: id,
          sourceModel: 'SupplierPayment',
          // Stable. A posted payment is never edited and re-posted, and a key that moved would let
          // a double-click pay the supplier twice.
          idempotencyKey: buildIdempotencyKey('supplier_payment', id, 'paid'),
          lines: [
            {
              ledgerId: apTrade,
              debit: prepared.amount,
              subledgerRef: { type: 'vendor', id: String(prepared.vendorId) },
            },
            {
              ledgerId: creditLedger,
              credit: prepared.amount,
              lineNarration: prepared.method === 'cheque'
                ? `Cheque ${prepared.chequeNo}, not yet cleared`
                : undefined,
            },
          ],
        },
        actorId,
      );

      if (!payment.paymentNo) payment.paymentNo = await allocateNextFinanceNo('financePaymentOutNo');
      // Frozen as resolved, so a defaulted amount reads the same tomorrow as it did at posting.
      payment.allocations = prepared.allocations as typeof payment.allocations;
      payment.status = 'posted';
      payment.journalEntryId = entry._id;
      payment.postedAt = new Date();
      payment.postedBy = actorId ? new Types.ObjectId(actorId) : undefined;
      await payment.save();

      logActivityAsync({
        employeeId: actorId,
        module: 'payment',
        entityId: id,
        action: 'posted',
        meta: {
          paymentNo: payment.paymentNo,
          vendor: prepared.vendorName,
          amount: prepared.amount,
          method: prepared.method,
        },
      });

      return getPayment(id);
    },
    'This payment, or one of the bills on it, is being worked on by somebody else right now. '
      + 'Try again in a moment.',
  );
}

/**
 * Cancel a posted payment: reverse its entry, and put its bills back to unpaid.
 *
 * The bills need no write — `paidByBill` counts only posted payments, so they are unpaid again
 * the moment this one is not.
 */
export async function cancelPayment(
  id: string,
  reason: string,
  actorId?: string,
): Promise<PaymentDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payment not found');

  return withFinanceLocks([`payment:${id}`], async () => {
    const payment = await SupplierPaymentModel.findById(id).exec();
    if (!payment) throw notFound('Payment not found');
    if (payment.status === 'cancelled') throw conflict('This payment has already been cancelled.');
    if (payment.status !== 'posted') {
      throw badRequest('This payment was never posted. Delete the draft instead of cancelling it.');
    }

    /*
     * A cleared cheque is money that has left the bank. Reversing the payment would put the money
     * back in the books while the bank statement says it is gone, and the bank would stop agreeing
     * from that day on. What reverses a cleared payment is a refund from the supplier.
     */
    if (payment.chequeClearedAt) {
      throw badRequest(
        `Cheque ${payment.chequeNo} has cleared — the money has left the bank, so this payment can `
          + 'no longer be cancelled. A refund from the supplier is not something this module '
          + 'records yet.',
      );
    }

    if (payment.journalEntryId) {
      const entry = await JournalEntryModel.findById(payment.journalEntryId)
        .select('status')
        .lean()
        .exec();
      // Already reversed from the journal screen: the accounts are right, so finish the job on
      // the document rather than leaving the two disagreeing.
      if (entry && entry.status === 'posted') {
        await reverseEntry(String(payment.journalEntryId), { reason }, actorId);
      }
    }

    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    payment.cancelledBy = actorId ? new Types.ObjectId(actorId) : undefined;
    payment.cancelReason = reason.trim();
    await payment.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'payment',
      entityId: id,
      action: 'cancelled',
      meta: { paymentNo: payment.paymentNo, amount: payment.amount, reason: reason.trim() },
    });

    return getPayment(id);
  });
}

/**
 * A cheque showed on the bank statement: move it out of uncleared and into the bank.
 *
 *     Dr  Cheques Issued, Uncleared
 *         Cr  the bank account it was drawn on
 *
 * Dated the day it CLEARED, not the day it was written. The bank balance on any date has to match
 * what the bank's own statement says for that date, and the statement moves on clearing.
 *
 * What the supplier is owed does not change here — that fell when the payment was released.
 */
export async function clearCheque(
  id: string,
  clearedOn: Date | string,
  actorId?: string,
): Promise<PaymentDetail> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Payment not found');

  return withFinanceLocks([`payment:${id}`], async () => {
    const payment = await SupplierPaymentModel.findById(id).exec();
    if (!payment) throw notFound('Payment not found');

    if (payment.method !== 'cheque') {
      throw badRequest(
        `Only a cheque clears. This payment was made ${METHOD_WORDS[payment.method]}, and left the `
          + 'account the day it was released.',
      );
    }
    if (payment.status !== 'posted') {
      throw badRequest(`This payment is ${payment.status}. Only a released cheque can clear.`);
    }
    if (payment.chequeClearedAt) {
      throw conflict(
        `Cheque ${payment.chequeNo} was already marked cleared on `
          + `${localDayKey(payment.chequeClearedAt)}.`,
      );
    }

    const date = new Date(clearedOn);
    if (Number.isNaN(date.getTime())) {
      throw badRequest('Say which day the cheque cleared on the bank statement.');
    }
    // Compared as calendar days in the business's own timezone, so a cheque written late one
    // evening and cleared the next morning is not refused because of the hours in between.
    if (localDayKey(date) < localDayKey(payment.chequeDate ?? payment.paymentDate)) {
      throw badRequest('A cheque cannot clear before it was written.');
    }

    const [vendor, chequesIssued] = await Promise.all([
      VendorModel.findById(payment.vendorId).select('name').lean().exec(),
      ledgerIdForRole('chequesIssued'),
    ]);

    const entry = await postEntry(
      {
        date,
        narration: `Cheque ${payment.chequeNo} to ${vendor?.name ?? 'supplier'} cleared`,
        referenceNo: payment.chequeNo,
        sourceType: 'payment_made',
        sourceId: id,
        sourceModel: 'SupplierPayment',
        idempotencyKey: buildIdempotencyKey('supplier_payment', id, 'cheque_cleared'),
        lines: [
          { ledgerId: chequesIssued, debit: payment.amount },
          { ledgerId: String(payment.paidFromLedgerId), credit: payment.amount },
        ],
      },
      actorId,
    );

    payment.chequeClearedAt = date;
    payment.chequeClearedBy = actorId ? new Types.ObjectId(actorId) : undefined;
    payment.clearingEntryId = entry._id;
    await payment.save();

    logActivityAsync({
      employeeId: actorId,
      module: 'payment',
      entityId: id,
      action: 'updated',
      meta: { chequeNo: payment.chequeNo, chequeClearedOn: localDayKey(date) },
    });

    return getPayment(id);
  });
}
