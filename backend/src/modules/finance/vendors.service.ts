import { Types } from 'mongoose';
import { VendorModel, IVendor } from '../../models/vendor.model';
import { StockReceiptModel } from '../../models/stock-receipt.model';
import { LedgerModel } from '../../models/ledger.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { allocateNextFinanceNo } from './finance-counters';
import { round2 } from './finance.rules';

/**
 * Suppliers, and the reconciliation of the free-text names already in the system.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface VendorView {
  id: string;
  code: number;
  reference: string;
  name: string;
  phone?: string;
  email?: string;
  taxRegistrationNo?: string;
  paymentTermsDays: number;
  openingBalance: { amount: number; asOf: Date | null };
  mergedFromNames: string[];
  isPlaceholder: boolean;
  isActive: boolean;
  notes?: string;
  /** Goods receipts linked to this supplier, and what they came to. */
  receiptCount: number;
  receiptValue: number;
  /**
   * What is owed to this supplier right now, read from their share of Accounts Payable.
   *
   * From the LEDGER, not from bills minus payments, so a payment made on account — before any
   * invoice arrived, or as a round sum — already counts. Negative means they owe us: an advance
   * that has not been used up yet.
   */
  payableBalance: number;
}

interface VendorData {
  _id: Types.ObjectId;
  code: number;
  name: string;
  phone?: string;
  email?: string;
  taxRegistrationNo?: string;
  paymentTermsDays: number;
  openingBalance: { amount: number; asOf: Date | null };
  mergedFromNames: string[];
  isPlaceholder: boolean;
  isActive: boolean;
  notes?: string;
}

/** `V-0007`. A supplier reference somebody can say out loud. */
export function vendorReference(code: number): string {
  return `V-${String(code).padStart(4, '0')}`;
}

function toView(
  vendor: VendorData,
  stats?: { count: number; value: number },
  payable?: number,
): VendorView {
  return {
    id: String(vendor._id),
    code: vendor.code,
    reference: vendorReference(vendor.code),
    name: vendor.name,
    phone: vendor.phone,
    email: vendor.email,
    taxRegistrationNo: vendor.taxRegistrationNo,
    paymentTermsDays: vendor.paymentTermsDays,
    openingBalance: vendor.openingBalance,
    mergedFromNames: vendor.mergedFromNames ?? [],
    isPlaceholder: vendor.isPlaceholder,
    isActive: vendor.isActive,
    notes: vendor.notes,
    receiptCount: stats?.count ?? 0,
    receiptValue: round2(stats?.value ?? 0),
    payableBalance: round2(payable ?? 0),
  };
}

/**
 * Each supplier's share of Accounts Payable, summed from the posting lines.
 *
 * Reversed lines are counted alongside posted ones, on purpose. A reversal leaves the original
 * lines in place marked `reversed` and writes opposite lines of its own, so the pair only nets to
 * zero when both are counted — which is how the trial balance sums them too. Counting `posted`
 * alone would treat a cancelled bill's reversal as a payment nobody made.
 *
 * Returns nothing when the payables account is not mapped yet, rather than failing the list: a
 * fresh install still has to be able to show its suppliers.
 */
async function payableByVendor(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('ledgerMap')
    .lean()
    .exec();
  const map = settings?.ledgerMap as unknown as Record<string, Types.ObjectId> | undefined;
  if (!map?.apTrade) return new Map();

  const rows = await JournalLineModel.aggregate<{ _id: Types.ObjectId; owed: number }>([
    {
      $match: {
        ledgerId: new Types.ObjectId(String(map.apTrade)),
        status: { $in: ['posted', 'reversed'] },
        'subledgerRef.type': 'vendor',
        'subledgerRef.id': { $in: ids },
      },
    },
    // A payable is a credit balance, so what is owed is credits less debits.
    { $group: { _id: '$subledgerRef.id', owed: { $sum: { $subtract: ['$credit', '$debit'] } } } },
  ]).exec();

  return new Map(rows.map((r) => [String(r._id), round2(r.owed)]));
}

export async function listVendors(
  filters: { search?: string; status?: 'active' | 'inactive' | 'all' } = {},
): Promise<VendorView[]> {
  const query: Record<string, unknown> = {};

  if (filters.status === 'inactive') query.isActive = false;
  else if (filters.status !== 'all') query.isActive = true;

  if (filters.search) {
    // Escaped: a supplier called "A.B. Traders" must not become a wildcard.
    const safe = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { name: new RegExp(safe, 'i') },
      { mergedFromNames: new RegExp(safe, 'i') },
      { phone: new RegExp(safe, 'i') },
    ];
  }

  const vendors = await VendorModel.find(query).sort({ name: 1 }).lean().exec();
  const ids = vendors.map((v) => v._id);
  const [stats, payables] = await Promise.all([receiptStatsByVendor(ids), payableByVendor(ids)]);

  return vendors.map((v) =>
    toView(v as VendorData, stats.get(String(v._id)), payables.get(String(v._id))),
  );
}

export async function getVendor(id: string): Promise<VendorView> {
  const vendor = await VendorModel.findById(id).lean().exec();
  if (!vendor) throw notFound('Supplier not found');
  const [stats, payables] = await Promise.all([
    receiptStatsByVendor([vendor._id]),
    payableByVendor([vendor._id]),
  ]);
  return toView(
    vendor as VendorData,
    stats.get(String(vendor._id)),
    payables.get(String(vendor._id)),
  );
}

/** How much has been received from each supplier. One aggregation, not one query per vendor. */
async function receiptStatsByVendor(
  ids: Types.ObjectId[],
): Promise<Map<string, { count: number; value: number }>> {
  if (ids.length === 0) return new Map();

  const rows = await StockReceiptModel.aggregate<{
    _id: Types.ObjectId;
    count: number;
    value: number;
  }>([
    {
      $match: {
        vendorId: { $in: ids },
        status: 'posted',
        isTrashed: { $ne: true },
      },
    },
    { $group: { _id: '$vendorId', count: { $sum: 1 }, value: { $sum: '$totalAmount' } } },
  ]).exec();

  return new Map(rows.map((r) => [String(r._id), { count: r.count, value: r.value }]));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface VendorInput {
  name: string;
  phone?: string;
  email?: string;
  address?: Record<string, string>;
  taxRegistrationNo?: string;
  paymentTermsDays?: number;
  defaultExpenseLedgerId?: string | null;
  openingBalance?: { amount: number; asOf: string | Date | null };
  notes?: string;
}

/** Refuse a name that already exists in any casing — that is the problem this master solves. */
async function assertNameIsFree(name: string, exceptId?: string): Promise<void> {
  const existing = await VendorModel.findOne({ name })
    .collation({ locale: 'en', strength: 2 })
    .select('_id name')
    .lean()
    .exec();

  if (existing && String(existing._id) !== exceptId) {
    throw conflict(`"${existing.name}" already exists. Use it, or choose a different name.`);
  }
}

async function assertExpenseLedger(ledgerId?: string | null): Promise<void> {
  if (!ledgerId) return;
  const ledger = await LedgerModel.findById(ledgerId).select('isActive isControl').lean().exec();
  if (!ledger) throw notFound('That account does not exist');
  if (!ledger.isActive) throw badRequest('That account is deactivated');
  // A control account is posted to by the module that owns it, never chosen as a default here.
  if (ledger.isControl) {
    throw badRequest('A control account cannot be a supplier default — it is posted to by its own module.');
  }
}

export async function createVendor(input: VendorInput, actorId?: string): Promise<VendorView> {
  const name = input.name.trim();
  if (name.length < 2) throw badRequest('Give the supplier a name.');

  await assertNameIsFree(name);
  await assertExpenseLedger(input.defaultExpenseLedgerId);

  const vendor = await VendorModel.create({
    name,
    code: await allocateNextFinanceNo('financeVendorNo'),
    phone: input.phone,
    email: input.email,
    address: input.address,
    taxRegistrationNo: input.taxRegistrationNo,
    paymentTermsDays: input.paymentTermsDays ?? 0,
    defaultExpenseLedgerId: input.defaultExpenseLedgerId
      ? new Types.ObjectId(input.defaultExpenseLedgerId)
      : undefined,
    openingBalance: {
      amount: input.openingBalance?.amount ?? 0,
      asOf: input.openingBalance?.asOf ? new Date(input.openingBalance.asOf) : null,
    },
    notes: input.notes,
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'vendor',
    entityId: String(vendor._id),
    action: 'created',
    meta: { name: vendor.name, code: vendor.code },
  });

  return toView(vendor as unknown as VendorData);
}

export async function updateVendor(
  id: string,
  input: Partial<VendorInput> & { isActive?: boolean },
  actorId?: string,
): Promise<VendorView> {
  const vendor = await VendorModel.findById(id).exec();
  if (!vendor) throw notFound('Supplier not found');

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw badRequest('Give the supplier a name.');
    if (name !== vendor.name) {
      await assertNameIsFree(name, id);
      vendor.name = name;
    }
  }

  if (input.defaultExpenseLedgerId !== undefined) {
    await assertExpenseLedger(input.defaultExpenseLedgerId);
    vendor.defaultExpenseLedgerId = input.defaultExpenseLedgerId
      ? new Types.ObjectId(input.defaultExpenseLedgerId)
      : undefined;
  }

  if (input.phone !== undefined) vendor.phone = input.phone;
  if (input.email !== undefined) vendor.email = input.email;
  if (input.address !== undefined) vendor.address = input.address;
  if (input.taxRegistrationNo !== undefined) vendor.taxRegistrationNo = input.taxRegistrationNo;
  if (input.paymentTermsDays !== undefined) vendor.paymentTermsDays = input.paymentTermsDays;
  if (input.notes !== undefined) vendor.notes = input.notes;

  if (input.openingBalance !== undefined) {
    vendor.openingBalance = {
      amount: input.openingBalance.amount ?? 0,
      asOf: input.openingBalance.asOf ? new Date(input.openingBalance.asOf) : null,
    };
  }

  if (input.isActive !== undefined) vendor.isActive = input.isActive;

  vendor.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await vendor.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'vendor',
    entityId: String(vendor._id),
    action: input.isActive !== undefined ? 'status_changed' : 'updated',
    meta: { name: vendor.name },
  });

  return getVendor(id);
}

export async function deleteVendor(id: string, actorId?: string): Promise<{ message: string }> {
  const vendor = await VendorModel.findById(id).exec();
  if (!vendor) throw notFound('Supplier not found');

  if (vendor.isPlaceholder) {
    throw badRequest(
      'This is the holding record for receipts whose supplier could not be identified. '
        + 'Reassign those receipts first; it disappears on its own when it is empty.',
    );
  }

  const linked = await StockReceiptModel.countDocuments({ vendorId: vendor._id }).exec();
  if (linked > 0) {
    throw conflict(
      `${linked} goods receipt${linked === 1 ? '' : 's'} name this supplier. `
        + 'Deactivate it instead — deleting it would leave those receipts pointing at nothing.',
    );
  }

  await vendor.deleteOne();

  logActivityAsync({
    employeeId: actorId,
    module: 'vendor',
    entityId: id,
    action: 'deleted',
    meta: { name: vendor.name },
  });

  return { message: `Supplier "${vendor.name}" deleted` };
}

// ---------------------------------------------------------------------------
// Reconciling what is already there
// ---------------------------------------------------------------------------

export interface SupplierCandidate {
  /** The name exactly as it was typed. */
  typedName: string;
  receiptCount: number;
  totalValue: number;
  firstSeen: Date;
  lastSeen: Date;
  /** The vendor this name already resolves to, if any. */
  resolvedTo?: { id: string; name: string };
  /**
   * Existing suppliers whose name looks like this one, so an admin is shown the likely merge
   * rather than being asked to spot it in a long list.
   */
  suggestions: { id: string; name: string }[];
}

/**
 * Reduce a typed name to something comparable.
 *
 * Not clever, deliberately: lowercase, strip punctuation and the handful of company suffixes
 * people vary. Fuzzy matching would produce confident wrong merges, and a wrong merge silently
 * attributes one supplier's goods to another. This only proposes; a person decides.
 */
function comparisonKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|co|company|traders|trading|and|&|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Every distinct supplier name on a goods receipt, with what it is worth and what it might be.
 *
 * The input to the one-off clean-up. Ordered by value, because that is the order in which
 * getting a merge wrong costs the most.
 */
export async function extractSuppliersFromReceipts(): Promise<{
  candidates: SupplierCandidate[];
  unnamedReceipts: number;
}> {
  const rows = await StockReceiptModel.aggregate<{
    _id: string;
    count: number;
    value: number;
    firstSeen: Date;
    lastSeen: Date;
    vendorIds: (Types.ObjectId | null)[];
  }>([
    { $match: { isTrashed: { $ne: true } } },
    {
      $group: {
        _id: { $trim: { input: { $ifNull: ['$supplierName', ''] } } },
        count: { $sum: 1 },
        value: { $sum: '$totalAmount' },
        firstSeen: { $min: '$receiptDate' },
        lastSeen: { $max: '$receiptDate' },
        vendorIds: { $addToSet: '$vendorId' },
      },
    },
    { $sort: { value: -1 } },
  ]).exec();

  const vendors = await VendorModel.find().select('_id name mergedFromNames').lean().exec();
  const byId = new Map(vendors.map((v) => [String(v._id), v]));

  // One key can cover several vendors only if an admin created near-duplicates by hand; keeping
  // a list rather than a single value means the suggestion shows all of them.
  const byKey = new Map<string, { id: string; name: string }[]>();
  for (const v of vendors) {
    const key = comparisonKey(v.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push({ id: String(v._id), name: v.name });
  }

  let unnamedReceipts = 0;
  const candidates: SupplierCandidate[] = [];

  for (const row of rows) {
    const typedName = (row._id ?? '').trim();

    if (!typedName) {
      // Receipts entered with no supplier at all. They still hold value, so they are counted
      // and reported — they are the clearest case for the placeholder.
      unnamedReceipts = row.count;
      continue;
    }

    const linked = row.vendorIds.filter(Boolean).map((id) => byId.get(String(id))).filter(Boolean);

    candidates.push({
      typedName,
      receiptCount: row.count,
      totalValue: round2(row.value),
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      resolvedTo: linked[0]
        ? { id: String(linked[0]!._id), name: linked[0]!.name }
        : undefined,
      suggestions: (byKey.get(comparisonKey(typedName)) ?? []).slice(0, 5),
    });
  }

  return { candidates, unnamedReceipts };
}

/**
 * Attach a set of typed names to one supplier, creating it if it does not exist.
 *
 * Back-links every matching receipt and records the names on the vendor, so what was combined
 * stays visible. The receipts keep their own `supplierName` untouched.
 */
export async function assignSupplierNames(
  input: { vendorId?: string; newVendorName?: string; typedNames: string[] },
  actorId?: string,
): Promise<{ vendor: VendorView; receiptsLinked: number }> {
  const typedNames = [...new Set(input.typedNames.map((n) => n.trim()).filter(Boolean))];
  if (typedNames.length === 0) throw badRequest('Choose at least one typed name to assign.');

  /*
   * Exactly one of the two, refused here and not only in the request schema.
   *
   * The schema guards the HTTP route; this guards every other caller, and there will be others —
   * a migration script, a later bulk tool. Given both, the obvious implementation quietly
   * prefers one, and quietly picking one of two conflicting instructions is precisely how a body
   * of receipts ends up attributed to the wrong company with nothing downstream complaining.
   */
  if (input.vendorId && input.newVendorName) {
    throw badRequest('Choose an existing supplier or give a new name — not both.');
  }
  if (!input.vendorId && !input.newVendorName) {
    throw badRequest('Choose an existing supplier, or give a new name.');
  }

  let vendor: IVendor | null;

  if (input.vendorId) {
    vendor = await VendorModel.findById(input.vendorId).exec();
    if (!vendor) throw notFound('Supplier not found');
  } else {
    const name = (input.newVendorName ?? '').trim();
    if (name.length < 2) throw badRequest('Give the new supplier a name.');
    await assertNameIsFree(name);
    vendor = await VendorModel.create({
      name,
      code: await allocateNextFinanceNo('financeVendorNo'),
      openingBalance: { amount: 0, asOf: null },
      createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
    });
  }

  const merged = new Set([...(vendor.mergedFromNames ?? []), ...typedNames]);
  vendor.mergedFromNames = [...merged];
  await vendor.save();

  // Case-insensitive, because the whole point is that the same supplier was typed several ways.
  const result = await StockReceiptModel.updateMany(
    {
      supplierName: { $in: typedNames.map((n) => new RegExp(`^${escapeRegex(n)}$`, 'i')) },
      isTrashed: { $ne: true },
    },
    { $set: { vendorId: vendor._id } },
  ).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'vendor',
    entityId: String(vendor._id),
    action: 'updated',
    meta: { assignedNames: typedNames, receiptsLinked: result.modifiedCount, name: vendor.name },
  });

  return {
    vendor: await getVendor(String(vendor._id)),
    receiptsLinked: result.modifiedCount,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Park every still-unlinked receipt on a named placeholder.
 *
 * The alternative — leaving them unlinked — makes the goods-received total unprovable by
 * supplier, which is worse than a bucket somebody can work through later. The placeholder is
 * deliberately obvious rather than quietly plausible.
 */
export async function parkUnassignedReceipts(
  actorId?: string,
): Promise<{ vendor: VendorView; receiptsLinked: number }> {
  let placeholder = await VendorModel.findOne({ isPlaceholder: true }).exec();

  if (!placeholder) {
    placeholder = await VendorModel.create({
      name: 'Unidentified Supplier',
      code: await allocateNextFinanceNo('financeVendorNo'),
      isPlaceholder: true,
      openingBalance: { amount: 0, asOf: null },
      notes:
        'Goods receipts whose supplier could not be identified when the supplier list was '
        + 'created. Reassign them as they are recognised; this record is meant to empty.',
      createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
    });
  }

  const result = await StockReceiptModel.updateMany(
    { vendorId: { $exists: false }, isTrashed: { $ne: true } },
    { $set: { vendorId: placeholder._id } },
  ).exec();

  return {
    vendor: await getVendor(String(placeholder._id)),
    receiptsLinked: result.modifiedCount,
  };
}

/** How far through the clean-up we are. Drives the banner on the screen. */
export async function migrationProgress(): Promise<{
  totalReceipts: number;
  linkedReceipts: number;
  unlinkedReceipts: number;
  onPlaceholder: number;
  vendorCount: number;
  complete: boolean;
}> {
  const [total, linked, vendorCount, placeholder] = await Promise.all([
    StockReceiptModel.countDocuments({ isTrashed: { $ne: true } }).exec(),
    StockReceiptModel.countDocuments({
      vendorId: { $exists: true },
      isTrashed: { $ne: true },
    }).exec(),
    VendorModel.countDocuments({ isPlaceholder: { $ne: true } }).exec(),
    VendorModel.findOne({ isPlaceholder: true }).select('_id').lean().exec(),
  ]);

  const onPlaceholder = placeholder
    ? await StockReceiptModel.countDocuments({
        vendorId: placeholder._id,
        isTrashed: { $ne: true },
      }).exec()
    : 0;

  return {
    totalReceipts: total,
    linkedReceipts: linked,
    unlinkedReceipts: total - linked,
    onPlaceholder,
    vendorCount,
    // Complete means every receipt is attached to something, placeholder included: the goods
    // received total is then provable by supplier even where the supplier is "not identified".
    complete: total === linked,
  };
}
