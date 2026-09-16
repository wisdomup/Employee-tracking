import { Schema, model, Document, Types } from 'mongoose';

/**
 * One bank statement, checked off against the books.
 *
 * ## What this is for
 *
 * The bank's closing balance and ours almost never match on any given day, and that is normal:
 * a deposit made on Friday may not land until Monday, a direct debit the bank took may not have
 * been written down yet. Reconciling is the act of proving that every difference between the two
 * is one of those explainable items and NOT a mistake or a missing entry.
 *
 * It is the last control the module was missing. Every other check proves the books against
 * another part of our own system — the warehouse, the collections module. This one proves them
 * against somebody else's record, which is the only check no internal bug can fool.
 *
 * ## It posts nothing
 *
 * Ticking a line off means "the bank agrees this happened". It does not change the amount, the
 * date, or the account. So this writes no journal entries at all, deliberately: if the statement
 * shows a bank charge that is not in the books, the answer is to record an expense for it, not
 * to have a reconciliation screen invent an entry nobody reviewed. Same rule the nightly control
 * checks follow — they report, they never repair.
 *
 * ## Why the cleared lines are held HERE and not on the lines
 *
 * `JournalLine` is append-only: "rows are never updated and never deleted". Stamping a
 * `reconciledAt` onto posted lines would break the one property the whole posting engine rests
 * on. So the reconciliation owns the list of what it cleared, and "not yet reconciled" is
 * computed by subtracting the claims of every completed reconciliation on that account.
 *
 * That set grows over the life of a bank account, which is the honest cost of keeping the lines
 * immutable. At one statement a month against one or two bank accounts it is a few thousand ids,
 * which is nothing. If this business ever runs dozens of accounts with daily statements, the fix
 * is to carry forward only the still-uncleared ids on each completion rather than to start
 * writing to posted lines.
 */
export interface IBankReconciliation extends Document {
  _id: Types.ObjectId;

  /** The bank or cash account being proved. Must be one the chart marks as cash. */
  ledgerId: Types.ObjectId;

  /** The statement's closing date. Nothing dated after this belongs to this reconciliation. */
  statementDate: Date;

  /**
   * The closing balance exactly as the bank prints it: positive means money in the account.
   *
   * Typed in by a person from the paper or the PDF. It is the one number in this module that
   * comes from outside, which is precisely what gives the check its value.
   */
  statementClosingBalance: number;

  /**
   * The posted lines the bank agrees with.
   *
   * A line may be claimed by at most one COMPLETED reconciliation — enforced in the service
   * under a lock on the account, because two statements claiming the same deposit would each
   * balance on their own and hide a real difference between them.
   */
  clearedLineIds: Types.ObjectId[];

  status: 'draft' | 'completed';

  /**
   * The arithmetic at the moment it was completed, frozen.
   *
   * Recomputing these on read would quietly restate a signed-off reconciliation the next time
   * anything was back-dated into the period — and a reconciliation whose figures move is not
   * evidence of anything.
   */
  closedBookBalance?: number;
  closedUnclearedTotal?: number;

  completedAt?: Date;
  completedBy?: Types.ObjectId;

  /** Set when a completed reconciliation is reopened, so the trail says why. */
  reopenedAt?: Date;
  reopenedBy?: Types.ObjectId;
  reopenReason?: string;

  notes?: string;

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const bankReconciliationSchema = new Schema<IBankReconciliation>(
  {
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    statementDate: { type: Date, required: true },
    statementClosingBalance: { type: Number, required: true },

    clearedLineIds: { type: [Schema.Types.ObjectId], default: [], ref: 'JournalLine' },

    status: { type: String, enum: ['draft', 'completed'], default: 'draft' },

    closedBookBalance: { type: Number },
    closedUnclearedTotal: { type: Number },

    completedAt: Date,
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    reopenedAt: Date,
    reopenedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reopenReason: { type: String, trim: true, maxlength: 500 },

    notes: { type: String, trim: true, maxlength: 1000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/**
 * One reconciliation per account per statement date.
 *
 * Two of them would each tick off half the month's lines, both balance, and between them prove
 * nothing — the second would simply inherit whatever the first left behind.
 */
bankReconciliationSchema.index({ ledgerId: 1, statementDate: 1 }, { unique: true });

/** "What has already been claimed on this account?" — asked on every completion. */
bankReconciliationSchema.index({ ledgerId: 1, status: 1, statementDate: -1 });

export const BankReconciliationModel = model<IBankReconciliation>(
  'BankReconciliation',
  bankReconciliationSchema,
);
