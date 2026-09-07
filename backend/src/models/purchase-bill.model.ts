import { Schema, model, Document, Types } from 'mongoose';

/**
 * A supplier's invoice.
 *
 * ## What this is FOR
 *
 * Goods arriving and being billed for them are two separate events, often days apart. The
 * warehouse records the first; nothing recorded the second until now, so "what do we owe Acme"
 * had no answer and `2115 Goods Received Not Invoiced` filled up with no way to drain.
 *
 * A bill is the document that drains it. It names the goods receipts it covers, and posting it
 * moves that value out of GRNI and into `2110 Accounts Payable`, tagged with the supplier.
 *
 * ## Two kinds of line, deliberately in two places
 *
 * `matchedReceipts` are goods this bill is paying for — each one points at a receipt the
 * warehouse already recorded, and clears that receipt's share of GRNI.
 *
 * `lines` are everything else on the same invoice: freight, a service charge, a handling fee.
 * They post to an ordinary expense account.
 *
 * They are modelled apart rather than as one list with an optional receipt because they behave
 * differently in every direction that matters — one is capped by what was received, the other
 * is not; one drains a clearing account, the other creates an expense; one can be reconciled
 * against the warehouse, the other cannot. A single list with a nullable field would have made
 * every read of it start by asking which kind it was holding.
 *
 * ## No posting switch
 *
 * Every automatic posting is behind a switch because it fires off the back of somebody else's
 * work — a rider delivering, the warehouse receiving — and turning that on is a decision about
 * when the books go live. A bill is not that. It is a finance document, typed into the finance
 * module by a finance user who is *asking* for it to be recorded, exactly like a manual journal
 * entry, which has never had a switch either. Adding one would only create a state where the
 * screen accepts bills and silently files them nowhere.
 */

/** A charge that is not goods: freight, service, handling. */
export interface IBillLine {
  description: string;
  /** An ordinary expense or asset account. Never a control account — see the service. */
  ledgerId: Types.ObjectId;
  amount: number;
}

/** Goods this bill is paying for, and how much of that receipt it covers. */
export interface IBillReceiptMatch {
  receiptId: Types.ObjectId;
  /**
   * Capped at what is still unbilled on that receipt.
   *
   * Clearing more GRNI than was ever raised against a receipt leaves the difference stuck in
   * 2115 for good, with nothing on the warehouse side to explain it.
   */
  amount: number;
}

export interface IPurchaseBill extends Document {
  _id: Types.ObjectId;
  /** From `Counter('financeBillNo')`, allocated at POST. Displayed as B-0001. */
  billNo?: number;

  vendorId: Types.ObjectId;

  /**
   * The supplier's own invoice number, as printed on their paper.
   *
   * Optional, because handwritten bills exist. But when it is given it is unique per supplier,
   * and that index is the single most useful control in the whole module: paying the same
   * invoice twice is the most common way money leaves a business by accident.
   */
  supplierBillNo?: string;

  billDate: Date;
  /** Defaults from the supplier's payment terms at the moment the bill is raised. */
  dueDate: Date;

  matchedReceipts: IBillReceiptMatch[];
  lines: IBillLine[];

  /** Input tax, claimable on a return. Posts to `inputTax` as a debit of its own. */
  taxAmount: number;

  /** goods + other charges + tax. Held rather than derived, so a report never re-adds it. */
  totalAmount: number;

  status: 'draft' | 'posted' | 'cancelled';

  /** The entry this bill posted. Null on a draft; kept after cancelling, for the trail. */
  journalEntryId?: Types.ObjectId;
  postedAt?: Date;
  postedBy?: Types.ObjectId;

  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancelReason?: string;

  notes?: string;

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const billLineSchema = new Schema<IBillLine>(
  {
    description: { type: String, required: true, trim: true, maxlength: 300 },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const receiptMatchSchema = new Schema<IBillReceiptMatch>(
  {
    receiptId: { type: Schema.Types.ObjectId, ref: 'StockReceipt', required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseBillSchema = new Schema<IPurchaseBill>(
  {
    billNo: { type: Number, min: 1 },

    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    supplierBillNo: { type: String, trim: true, maxlength: 100 },

    billDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },

    matchedReceipts: { type: [receiptMatchSchema], default: [] },
    lines: { type: [billLineSchema], default: [] },

    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: ['draft', 'posted', 'cancelled'], default: 'draft' },

    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    postedAt: Date,
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true, maxlength: 500 },

    notes: { type: String, trim: true, maxlength: 1000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// No `isTrashed`. A draft is deleted outright because it posted nothing; a posted bill is
// cancelled, which reverses its entry and leaves both documents standing. The same rule the
// journal follows.

purchaseBillSchema.index({ billNo: 1 }, { unique: true, sparse: true });

/**
 * The duplicate-payment guard.
 *
 * Sparse, so the many bills with no printed number do not collide on `null`. Case-insensitive,
 * because "INV-2201" and "inv-2201" are the same piece of paper and catching that is the entire
 * point. Cancelled bills are still counted — re-entering a bill that was cancelled in error is
 * exactly the mistake worth stopping, and the message says to reopen the original.
 */
purchaseBillSchema.index(
  { vendorId: 1, supplierBillNo: 1 },
  {
    unique: true,
    partialFilterExpression: { supplierBillNo: { $type: 'string' } },
    collation: { locale: 'en', strength: 2 },
  },
);

purchaseBillSchema.index({ vendorId: 1, billDate: -1 });
purchaseBillSchema.index({ status: 1, dueDate: 1 });
/** "How much of this receipt has been billed?" — asked on every bill form and by the GRNI check. */
purchaseBillSchema.index({ 'matchedReceipts.receiptId': 1, status: 1 });

export const PurchaseBillModel = model<IPurchaseBill>('PurchaseBill', purchaseBillSchema);
