import { Schema, model, Document, Types } from 'mongoose';

/**
 * One month's payroll: what each person earned, what was taken back off them, and what is left to
 * pay.
 *
 * ## Why it is a document and not a calculation
 *
 * The figures start from what is recorded against each employee — salary, bonus, allowance — but
 * they are copied onto the run and then edited. Somebody worked half a month, somebody earned a
 * one-off bonus, somebody is repaying an advance faster this month. A payroll that recomputed
 * itself from the employee record would quietly rewrite what was actually paid last March.
 *
 * So the run is a snapshot: pre-filled, corrected by a person, and frozen when it posts.
 *
 * ## Accruing and paying are separate
 *
 * Posting the run records what is OWED to staff — it does not pay anybody. Payments are recorded
 * against the run afterwards, in whatever instalments the money actually went out in, because a
 * business that pays half the wages on the 1st and the rest on the 7th should not have to lie
 * about either date.
 */

export interface IPayrollLine {
  userId: Types.ObjectId;
  /** Copied at the time, so a renamed or deleted employee still reads correctly on an old run. */
  name: string;
  role?: string;
  salary: number;
  bonus: number;
  allowance: number;
  /** salary + bonus + allowance. */
  gross: number;
  /** Taken off this month's pay against what they already owe the business. */
  advanceRecovery: number;
  /**
   * Late-start fines taken off this month’s pay.
   *
   * A plain amount, like `advanceRecovery`, and for the same reason: which individual fines it
   * settles is not recorded. What a rider still owes is DERIVED — fines raised and not waived,
   * less what posted runs have already recovered — so cancelling a run releases its recovery
   * with no second write, and no stored "recovered" flag can drift from the books.
   */
  fineRecovery: number;
  /** gross − advanceRecovery − fineRecovery — what they actually receive. */
  net: number;
}

export interface IPayrollPayment {
  paidOn: Date;
  amount: number;
  /** Cash or bank only. A cheque to staff would need its own leaf tracking; salaries are not paid that way here. */
  method: 'cash' | 'bank_transfer';
  paidFromLedgerId: Types.ObjectId;
  reference?: string;
  journalEntryId: Types.ObjectId;
  recordedAt: Date;
  recordedBy?: Types.ObjectId;
}

export interface IPayrollRun extends Document {
  _id: Types.ObjectId;
  /** `YYYY-MM`. One run per month — the service holds a lock while it checks. */
  period: string;

  lines: IPayrollLine[];
  totals: {
    salary: number;
    bonus: number;
    allowance: number;
    gross: number;
    advanceRecovery: number;
    fineRecovery: number;
    net: number;
  };

  status: 'draft' | 'posted' | 'cancelled';

  /** The entry that recorded what is owed to staff. */
  accrualEntryId?: Types.ObjectId;
  postedAt?: Date;
  postedBy?: Types.ObjectId;

  /** What has actually been handed over since, in instalments. */
  payments: IPayrollPayment[];

  cancelledAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancelReason?: string;

  notes?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const payrollLineSchema = new Schema<IPayrollLine>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    role: { type: String, trim: true },
    salary: { type: Number, default: 0, min: 0 },
    bonus: { type: Number, default: 0, min: 0 },
    allowance: { type: Number, default: 0, min: 0 },
    gross: { type: Number, default: 0, min: 0 },
    advanceRecovery: { type: Number, default: 0, min: 0 },
    // Defaulted, not required: runs posted before fines existed read as zero rather than
    // invalidating every historical payroll document the moment this field arrived.
    fineRecovery: { type: Number, default: 0, min: 0 },
    net: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const payrollPaymentSchema = new Schema<IPayrollPayment>(
  {
    paidOn: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'bank_transfer'], required: true },
    paidFromLedgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    reference: { type: String, trim: true, maxlength: 100 },
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
    recordedAt: { type: Date, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const payrollRunSchema = new Schema<IPayrollRun>(
  {
    period: { type: String, required: true, trim: true },
    lines: { type: [payrollLineSchema], default: [] },
    totals: {
      salary: { type: Number, default: 0 },
      bonus: { type: Number, default: 0 },
      allowance: { type: Number, default: 0 },
      gross: { type: Number, default: 0 },
      advanceRecovery: { type: Number, default: 0 },
      fineRecovery: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
    },
    status: { type: String, enum: ['draft', 'posted', 'cancelled'], default: 'draft' },
    accrualEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    postedAt: Date,
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    payments: { type: [payrollPaymentSchema], default: [] },
    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/*
 * Not a unique index on `period`.
 *
 * A run cancelled in error has to be replaceable, and a unique index would block the replacement
 * for good. The service refuses a second live run for a month while holding `payroll:<period>`,
 * which is the same guard every other race in this module uses.
 */
payrollRunSchema.index({ period: 1, status: 1 });
payrollRunSchema.index({ status: 1, period: -1 });

export const PayrollRunModel = model<IPayrollRun>('PayrollRun', payrollRunSchema);
