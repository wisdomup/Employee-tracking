import { Schema, model, Document, Types } from 'mongoose';

/**
 * A kind of spending, and the rules it is spent under.
 *
 * ## The category is where the approval policy lives
 *
 * "Does this need approving?" is not a property of an individual expense — the person entering
 * one would always say no. It belongs to the category, set once by whoever owns the policy:
 * petrol under a small limit goes straight through, rent always waits for a second person.
 *
 * Two settings rather than one, because the policy businesses actually run is neither "always"
 * nor "never" but "small ones go through": `requiresApproval` for categories that always wait,
 * `approvalAbove` for categories that wait only past a figure.
 *
 * ## Why an expense copies the account instead of following its category
 *
 * An expense records the account it posted to at the moment it posted. If a category is later
 * pointed at a different account, last year's rent must not move with it — that would restate a
 * closed year without anybody posting anything.
 */
export interface IExpenseCategory extends Document {
  _id: Types.ObjectId;
  name: string;
  /** An expense-type ledger that is not a control account. */
  ledgerId: Types.ObjectId;
  /** Every expense in this category waits for a second person. */
  requiresApproval: boolean;
  /**
   * When set, an expense whose total is ABOVE this waits for approval even though the category
   * otherwise goes straight through. Null means no limit.
   */
  approvalAbove: number | null;
  /** Refuses submission until a receipt is attached. */
  requiresReceipt: boolean;
  isActive: boolean;
  notes?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const expenseCategorySchema = new Schema<IExpenseCategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    requiresApproval: { type: Boolean, default: false },
    approvalAbove: { type: Number, default: null, min: 0 },
    requiresReceipt: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// No delete. A category that has been spent against is retired with `isActive`; its expenses keep
// pointing at it, and a report grouping last year's spending must still find its name.

/** Case-insensitive, for the same reason supplier names are: "Fuel" and "fuel" is one category. */
expenseCategorySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
expenseCategorySchema.index({ isActive: 1, name: 1 });

export const ExpenseCategoryModel = model<IExpenseCategory>(
  'ExpenseCategory',
  expenseCategorySchema,
);
