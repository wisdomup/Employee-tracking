import { Schema, model, Document, Types } from 'mongoose';

/**
 * The manual voucher: the six categories a finance person can raise by hand.
 *
 *   CPV  Cash Payment      money out of the cash box
 *   CRV  Cash Receipt      money into the cash box
 *   BPV  Bank Payment      money out of a bank account
 *   BRV  Bank Receipt      money into a bank account
 *   CV   Contra            money moved between the business's own cash and bank accounts
 *   JV   Journal           an adjustment that moves no money at all
 *
 * ## What a voucher is NOT for
 *
 * Every specialised module already writes its own accounting: a supplier payment allocates to
 * bills, an expense carries its category's approval limit, payroll clears what is owed to staff,
 * a delivery moves stock and raises a shop's credit. A voucher that could do those things again
 * would be a second way into the same balance, and the two would disagree the first time somebody
 * used the wrong one. So the service refuses those accounts by name and points at the screen that
 * owns them.
 *
 * What is left is genuinely the voucher menu's own work: moving money between the business's own
 * accounts, taking money from a shop at the office rather than from a rider, loans and capital,
 * drawings, paying a tax bill, and correcting the books.
 *
 * ## Lines are composed when the voucher is saved, not when it posts
 *
 * Whatever the category, the voucher stores the exact debits and credits it will write. An
 * approver can therefore see the entry before approving it, and posting has no arithmetic left to
 * get wrong — it writes what is already on the document.
 */

export type VoucherCategory = 'CPV' | 'CRV' | 'BPV' | 'BRV' | 'CV' | 'JV';

export const VOUCHER_CATEGORIES: VoucherCategory[] = ['CPV', 'CRV', 'BPV', 'BRV', 'CV', 'JV'];

/** Which way money moves, in plain terms. */
export const VOUCHER_CATEGORY_LABELS: Record<VoucherCategory, string> = {
  CPV: 'Cash Payment Voucher',
  CRV: 'Cash Receipt Voucher',
  BPV: 'Bank Payment Voucher',
  BRV: 'Bank Receipt Voucher',
  CV: 'Contra — money between our own accounts',
  JV: 'Journal Voucher',
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

/**
 * Draft → Submitted → Approved → Posted, with Rejected sending it back.
 *
 * Only `posted` touches the ledger. Approval is a separate state from posting on purpose: an
 * approver can agree to a voucher before the month it belongs to is open, and posting is the act
 * that actually writes it.
 */
export type VoucherStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'posted'
  | 'cancelled';

export const VOUCHER_STATUSES: VoucherStatus[] = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'posted',
  'cancelled',
];

export interface IVoucherLine {
  ledgerId: Types.ObjectId;
  debit: number;
  credit: number;
  narration?: string;
  /** Only ever `dealer` — the one control account a voucher may reach. See the service. */
  subledgerType?: string;
  subledgerId?: Types.ObjectId;
}

export interface IVoucher extends Document {
  _id: Types.ObjectId;
  /** Allocated at POST from that category's own series, so CPV-0007 is the seventh cash payment. */
  voucherNo?: number;
  category: VoucherCategory;
  subtype?: ContraSubtype;

  voucherDate: Date;
  narration: string;
  /** Cheque number, transfer reference, deposit slip — whatever proves it happened. */
  reference?: string;
  attachments: string[];

  /** The shop this is with, when there is one. Vendors are refused — see the service. */
  partyType?: 'dealer';
  partyId?: Types.ObjectId;
  partyName?: string;

  /** What the voucher will write, composed from the category's own fields when it is saved. */
  lines: IVoucherLine[];
  /** The headline figure: total debits. */
  amount: number;

  status: VoucherStatus;

  submittedAt?: Date;
  submittedBy?: Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectedBy?: Types.ObjectId;
  /** Kept after a correction and resubmission, as the record of why it came back. */
  rejectionReason?: string;

  journalEntryId?: Types.ObjectId;
  postedAt?: Date;
  postedBy?: Types.ObjectId;

  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancelReason?: string;

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const voucherLineSchema = new Schema<IVoucherLine>(
  {
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    narration: { type: String, trim: true, maxlength: 300 },
    subledgerType: { type: String, trim: true },
    subledgerId: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

const voucherSchema = new Schema<IVoucher>(
  {
    voucherNo: { type: Number, min: 1 },
    category: { type: String, enum: VOUCHER_CATEGORIES, required: true },
    subtype: { type: String, enum: [...CONTRA_SUBTYPES, null] },

    voucherDate: { type: Date, required: true },
    narration: { type: String, required: true, trim: true, maxlength: 500 },
    reference: { type: String, trim: true, maxlength: 100 },
    attachments: { type: [String], default: [] },

    partyType: { type: String, enum: ['dealer', null] },
    partyId: { type: Schema.Types.ObjectId },
    partyName: { type: String, trim: true, maxlength: 200 },

    lines: { type: [voucherLineSchema], default: [] },
    amount: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: VOUCHER_STATUSES, default: 'draft' },

    submittedAt: Date,
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, trim: true, maxlength: 500 },

    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    postedAt: Date,
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true, maxlength: 500 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// No `isTrashed`. An unposted voucher is deleted outright; a posted one is cancelled, which
// reverses it and leaves both documents standing — the rule every finance document follows.

/**
 * One number per category, so CPV-0007 and BPV-0007 can both exist.
 *
 * Partial, not sparse. A sparse COMPOUND index still indexes any document that has one of its
 * fields, and every voucher has a category — so two unnumbered drafts of the same kind collided
 * on `voucherNo: null` and the second could not be raised.
 */
voucherSchema.index(
  { category: 1, voucherNo: 1 },
  { unique: true, partialFilterExpression: { voucherNo: { $type: 'number' } } },
);
voucherSchema.index({ status: 1, voucherDate: -1 });
voucherSchema.index({ category: 1, voucherDate: -1 });
/** The approver's queue. */
voucherSchema.index({ status: 1, submittedAt: 1 });
/** The receivables check: what vouchers have taken from, or given back to, shops. */
voucherSchema.index({ 'lines.subledgerType': 1, status: 1 });

export const VoucherModel = model<IVoucher>('Voucher', voucherSchema);
