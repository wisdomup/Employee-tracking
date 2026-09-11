import { Schema, model, Document, Types } from 'mongoose';

/**
 * Money paid to a supplier.
 *
 * ## What it settles, and what it does not
 *
 * A payment reduces what is owed to the supplier — that is its accounting, and it is complete on
 * its own: Accounts Payable goes down by the amount, cash or bank goes down by the same.
 *
 * `allocations` then say WHICH bills it paid. That is bookkeeping about the payable, not a second
 * posting, and it deliberately does not have to add up to the whole payment. A payment made
 * before the invoice arrives, or a round figure against a running account, leaves part of it
 * unallocated — "on account" — and the supplier's balance is still exactly right, because it is
 * read from the ledger rather than from the allocations.
 *
 * ## Why a cheque does not touch the bank
 *
 * A cheque is not money leaving until it clears. Crediting the bank the day it is written is how
 * a system's bank balance stops matching the bank statement for the whole float period. So a
 * cheque credits `1125 Cheques Issued, Uncleared` instead, and `paidFromLedgerId` records which
 * bank account it is drawn on. When it shows on the statement, `chequeClearedAt` is set and a
 * second entry moves it out of uncleared and into that bank account.
 */

export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque';

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'cheque'];

export interface IBillAllocation {
  billId: Types.ObjectId;
  /** Capped at what is still unpaid on that bill — see the service. */
  amount: number;
}

export interface ISupplierPayment extends Document {
  _id: Types.ObjectId;
  /** From `Counter('financePaymentOutNo')`, allocated at POST. Displayed as P-0001. */
  paymentNo?: number;

  vendorId: Types.ObjectId;
  paymentDate: Date;
  method: PaymentMethod;

  /**
   * The cash or bank account the money comes out of.
   *
   * For a cheque, the bank account it is drawn on. The posting credits cheques-issued instead;
   * this is where the money finally leaves from when the cheque clears.
   */
  paidFromLedgerId: Types.ObjectId;

  chequeNo?: string;
  chequeDate?: Date;
  /** The day the cheque showed on the bank statement. Unset until then. */
  chequeClearedAt?: Date;
  chequeClearedBy?: Types.ObjectId;
  /** The entry that moved the cheque out of uncleared and into the bank. */
  clearingEntryId?: Types.ObjectId;
  /** A bank transfer's reference, so it can be found on the statement. */
  transferReference?: string;

  amount: number;
  allocations: IBillAllocation[];

  status: 'draft' | 'posted' | 'cancelled';

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

const allocationSchema = new Schema<IBillAllocation>(
  {
    billId: { type: Schema.Types.ObjectId, ref: 'PurchaseBill', required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const supplierPaymentSchema = new Schema<ISupplierPayment>(
  {
    paymentNo: { type: Number, min: 1 },

    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    paymentDate: { type: Date, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    paidFromLedgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },

    chequeNo: { type: String, trim: true, maxlength: 40 },
    chequeDate: Date,
    chequeClearedAt: Date,
    chequeClearedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    clearingEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    transferReference: { type: String, trim: true, maxlength: 100 },

    amount: { type: Number, required: true, min: 0 },
    allocations: { type: [allocationSchema], default: [] },

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

// No `isTrashed`, for the same reason as bills: a draft is deleted, a posted payment is cancelled.

supplierPaymentSchema.index({ paymentNo: 1 }, { unique: true, sparse: true });
supplierPaymentSchema.index({ vendorId: 1, paymentDate: -1 });
supplierPaymentSchema.index({ status: 1, paymentDate: -1 });
/** "How much of this bill has been paid?" — asked by every bill view and every payment form. */
supplierPaymentSchema.index({ 'allocations.billId': 1, status: 1 });
/** The uncleared-cheque list, which bank reconciliation works through. */
supplierPaymentSchema.index({ method: 1, status: 1, chequeClearedAt: 1 });

/**
 * One cheque leaf, one payment.
 *
 * A cheque number is printed on a physical leaf from one chequebook, so the same number from the
 * same bank account twice is either a typing slip or a cheque being paid out twice. Cancelled
 * payments still hold their number: the leaf they were written on is spent either way, and a
 * "new" payment reusing it is exactly the mistake worth catching.
 */
supplierPaymentSchema.index(
  { paidFromLedgerId: 1, chequeNo: 1 },
  { unique: true, partialFilterExpression: { chequeNo: { $type: 'string' } } },
);

export const SupplierPaymentModel = model<ISupplierPayment>(
  'SupplierPayment',
  supplierPaymentSchema,
);
