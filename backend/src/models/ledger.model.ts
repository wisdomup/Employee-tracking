import { Schema, model, Document, Types } from 'mongoose';
import { SUBLEDGER_TYPES, SubledgerType } from '../modules/finance/finance.rules';

/**
 * One account in the chart. Called a Ledger rather than an Account to match the vocabulary the
 * client already uses and the Tally-style terminology familiar in this market.
 *
 * ## The cached balance is derived, never authoritative
 *
 * `cachedBalance` here is the direct analogue of `WarehouseStock` in the stock module, and the
 * `JournalLine` collection added in the next step is the analogue of `StockMovement`. That
 * pairing — a materialised balance over an append-only ledger, with a reconciler proving one
 * against the other — is already proven in this codebase and its failure modes are understood.
 *
 * Only the posting service may write these three cached fields. Nothing else, ever.
 */
export interface ILedger extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;
  groupId: Types.ObjectId;
  description?: string;

  /**
   * Balance at the moment the books were opened, and the date that figure is true as of.
   *
   * A pair rather than v1.0's bare number. Without `asOf`, a balance-as-at-date query cannot
   * tell whether a posting predates the opening figure, and every such report silently includes
   * or excludes it depending on how the query happened to be written.
   */
  openingBalance: { amount: number; asOf: Date | null };

  /** Running balance, signed by the group's normal balance. Maintained by the posting service. */
  cachedBalance: number;
  /**
   * Gross movement totals. The Trial Balance needs a debit column AND a credit column, and
   * neither can be recovered from a net balance once the two have been subtracted.
   */
  cachedDebitTotal: number;
  cachedCreditTotal: number;

  /** Holds the total of a subledger. A manual journal entry may never post to it. */
  isControl: boolean;
  subledgerType?: SubledgerType | null;
  /** Counted as cash in the Cash Flow statement's opening and closing balances. */
  isCashEquivalent: boolean;
  /**
   * Referenced by the posting engine through `FinanceSettings`. Cannot be deleted and cannot
   * have its group changed to one of a different type; renaming and re-coding stay open, which
   * is what keeps the chart genuinely admin-customisable rather than nominally so.
   */
  isSystem: boolean;

  /** Reserved for future auto-integration, e.g. 'Inventory'. Carried over from the v1.0 spec. */
  linkedModule?: string | null;

  lastReconciledAt?: Date;
  /** Signed difference at the last check. Shown on the ledger page, not merely logged. */
  lastReconcileDrift?: number;

  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ledgerSchema = new Schema<ILedger>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    code: { type: String, required: true, trim: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'AccountGroup', required: true },
    description: { type: String, trim: true, maxlength: 500 },

    openingBalance: {
      amount: { type: Number, default: 0 },
      asOf: { type: Date, default: null },
    },

    // No `min: 0` on any of the three: a cached balance is signed, and Mongoose validators do
    // not run on the `$inc` the posting service uses anyway, so a `min` would give false
    // confidence while enforcing nothing.
    cachedBalance: { type: Number, required: true, default: 0 },
    cachedDebitTotal: { type: Number, required: true, default: 0 },
    cachedCreditTotal: { type: Number, required: true, default: 0 },

    isControl: { type: Boolean, default: false },
    subledgerType: {
      type: String,
      enum: [...(SUBLEDGER_TYPES as readonly string[]), null],
      default: null,
    },
    isCashEquivalent: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },

    linkedModule: { type: String, trim: true, maxlength: 50, default: null },

    lastReconciledAt: { type: Date },
    lastReconcileDrift: { type: Number },

    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

ledgerSchema.index({ code: 1 }, { unique: true });
ledgerSchema.index({ groupId: 1, isActive: 1 });
// "Which ledger does the engine post rider cash to" — resolved on nearly every auto-posting.
ledgerSchema.index({ isControl: 1, subledgerType: 1 });
// The Cash Flow statement's account set.
ledgerSchema.index({ isCashEquivalent: 1, isActive: 1 });
// The reconciler's worklist, drifted ledgers first.
ledgerSchema.index({ lastReconciledAt: 1 });

export const LedgerModel = model<ILedger>('Ledger', ledgerSchema);
