import { Schema, model, Document, Types } from 'mongoose';

/**
 * Money handed to an employee against pay they have not earned yet.
 *
 * ## It is a debt, not a cost
 *
 * An advance buys the business nothing — the employee owes it back, and it comes off their pay. So
 * it sits in `1180 Advances to Staff`, a control account with one subledger per employee, and the
 * expense is recorded later when the month's payroll is accrued. Treating an advance as a salary
 * expense on the day it is paid would charge the same wages twice: once as the advance and again
 * when that month's payroll runs.
 *
 * ## Why there is no per-advance "outstanding"
 *
 * Recovery happens on a payroll run, as one figure per employee, because that is how it actually
 * works: a month's pay is reduced, not a particular slip of paper settled. What an employee owes is
 * therefore their balance on the control account — the ledger — and never a field on this document.
 * The same reasoning as bills, where what has been billed is derived from posted bills.
 */

export interface IStaffAdvance extends Document {
  _id: Types.ObjectId;
  /** From `Counter('financeAdvanceNo')`, allocated at POST. Displayed as A-0001. */
  advanceNo?: number;

  userId: Types.ObjectId;
  /** Copied at the time, so an old advance still reads correctly if the employee record changes. */
  name: string;

  advanceDate: Date;
  amount: number;

  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: Types.ObjectId;
  reference?: string;
  reason?: string;

  status: 'draft' | 'posted' | 'cancelled';

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

const staffAdvanceSchema = new Schema<IStaffAdvance>(
  {
    advanceNo: { type: Number, min: 1 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    advanceDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'bank_transfer'], required: true },
    paidFromLedgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    reference: { type: String, trim: true, maxlength: 100 },
    reason: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ['draft', 'posted', 'cancelled'], default: 'draft' },
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

staffAdvanceSchema.index({ advanceNo: 1 }, { unique: true, sparse: true });
staffAdvanceSchema.index({ userId: 1, advanceDate: -1 });
staffAdvanceSchema.index({ status: 1, advanceDate: -1 });

export const StaffAdvanceModel = model<IStaffAdvance>('StaffAdvance', staffAdvanceSchema);
