import { Schema, model, Document, Types } from 'mongoose';
import { PaymentMethod, PAYMENT_METHODS } from './supplier-payment.model';

/**
 * Day-to-day spending paid on the spot: fuel, rent, a repair, a bank charge.
 *
 * ## What an expense is not
 *
 * Spending on credit — an invoice that will be paid later — is a supplier BILL, with a charge
 * line. Bills already raise Accounts Payable, match to payments, and age. Letting an expense do
 * the same would give payables a second way in, and "what do we owe" would have to be answered
 * from two places that could disagree. So an expense is always paid at the time, from cash, a
 * bank account, or a cheque.
 *
 * ## The lifecycle
 *
 *     draft ──submit──► posted                       category needs no approval
 *     draft ──submit──► pending_approval ──approve──► posted
 *                                        └─reject──► rejected ──edit──► draft
 *     posted ──cancel──► cancelled
 *
 * Nothing reaches the accounts before `posted`. Approval is held on the expense itself rather
 * than borrowing the staff-request module, which is built around an employee and a date and has
 * no amount to approve.
 */

export type ExpenseStatus = 'draft' | 'pending_approval' | 'rejected' | 'posted' | 'cancelled';

export const EXPENSE_STATUSES: ExpenseStatus[] = [
  'draft',
  'pending_approval',
  'rejected',
  'posted',
  'cancelled',
];

export interface IExpense extends Document {
  _id: Types.ObjectId;
  /** From `Counter('financeExpenseNo')`, allocated at posting. Displayed as E-0001. */
  expenseNo?: number;

  categoryId: Types.ObjectId;
  /**
   * The account this expense posts to, copied from the category and frozen at posting. See the
   * category model for why it is copied rather than followed.
   */
  ledgerId: Types.ObjectId;

  expenseDate: Date;
  description: string;
  /** Who was paid, when they are not a supplier on the list — a petrol pump, a plumber. */
  payeeName?: string;
  vendorId?: Types.ObjectId;

  /** The warehouse the spending was for, if any. Its city is copied onto the entry for city reports. */
  warehouseId?: Types.ObjectId;
  cityKey?: string;

  /** Before tax. This is what the expense account is charged. */
  amount: number;
  /** Input tax on the receipt, claimable separately. */
  taxAmount: number;
  /** amount + taxAmount — what actually left the account. */
  totalAmount: number;

  method: PaymentMethod;
  paidFromLedgerId: Types.ObjectId;
  chequeNo?: string;
  chequeDate?: Date;
  chequeClearedAt?: Date;
  chequeClearedBy?: Types.ObjectId;
  clearingEntryId?: Types.ObjectId;
  transferReference?: string;

  /** Uploaded receipt images. */
  attachments: string[];

  status: ExpenseStatus;

  submittedAt?: Date;
  submittedBy?: Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  rejectedAt?: Date;
  rejectedBy?: Types.ObjectId;
  /** Kept after the expense is corrected and resubmitted, as the record of why it came back. */
  rejectionReason?: string;

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

const expenseSchema = new Schema<IExpense>(
  {
    expenseNo: { type: Number, min: 1 },

    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },

    expenseDate: { type: Date, required: true },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    payeeName: { type: String, trim: true, maxlength: 200 },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },

    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    cityKey: { type: String, trim: true },

    amount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },

    method: { type: String, enum: PAYMENT_METHODS, required: true },
    paidFromLedgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    chequeNo: { type: String, trim: true, maxlength: 40 },
    chequeDate: Date,
    chequeClearedAt: Date,
    chequeClearedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    clearingEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    transferReference: { type: String, trim: true, maxlength: 100 },

    attachments: { type: [String], default: [] },

    status: { type: String, enum: EXPENSE_STATUSES, default: 'draft' },

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

    notes: { type: String, trim: true, maxlength: 1000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

expenseSchema.index({ expenseNo: 1 }, { unique: true, sparse: true });
expenseSchema.index({ status: 1, expenseDate: -1 });
expenseSchema.index({ categoryId: 1, expenseDate: -1 });
expenseSchema.index({ method: 1, status: 1, chequeClearedAt: 1 });

/** One cheque leaf, one document — see `money-out.ts` for the check that spans payments too. */
expenseSchema.index(
  { paidFromLedgerId: 1, chequeNo: 1 },
  { unique: true, partialFilterExpression: { chequeNo: { $type: 'string' } } },
);

export const ExpenseModel = model<IExpense>('Expense', expenseSchema);
