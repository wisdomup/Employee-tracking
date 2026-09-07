import { Schema, model, Document, Types } from 'mongoose';
import { SUBLEDGER_TYPES } from '../modules/finance/finance.rules';

/**
 * The append-only posting ledger. One document per debit or credit.
 *
 * ## Why lines are not embedded in the entry
 *
 * The instinct in MongoDB is to embed. Rejected for one reason: the Ledger Statement and the
 * Trial Balance both query ACROSS entries filtered by `ledgerId`, and on an embedded array that
 * means `$unwind` over the whole collection on every report load.
 *
 * This is the direct analogue of `StockMovement`, with `Ledger.cachedBalance` playing the part
 * of `WarehouseStock`: an append-only truth, a materialised balance over it, and a reconciler
 * proving one against the other. That pairing is already proven in this codebase and its
 * failure modes are understood.
 *
 * Rows are never updated and never deleted. A mistake is corrected by a compensating row whose
 * `reversalOf` points at the original.
 */
export interface IJournalLine extends Document {
  _id: Types.ObjectId;
  journalEntryId: Types.ObjectId;
  ledgerId: Types.ObjectId;

  debit: number;
  credit: number;
  /** `debit − credit`. Stored so every aggregation sums one field instead of subtracting two. */
  signedAmount: number;
  /** The ledger's balance immediately after this line applied — history readable without replay. */
  balanceAfter?: number;

  /** Required when the ledger is a control account, refused when it is not. */
  subledgerRef?: { type: string; id: Types.ObjectId } | null;

  /**
   * Denormalised from the header and written once, at post.
   *
   * Every report filters on date, period and status. Carrying them here is what lets the
   * Trial Balance and the Ledger Statement run as a single indexed aggregation with no join.
   */
  date: Date;
  postingPeriod: string;
  status: 'posted' | 'reversed';

  warehouseId?: Types.ObjectId;
  cityKey?: string;

  lineNarration?: string;
  idempotencyKey?: string;
  reversalOf?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const subledgerRefSchema = new Schema(
  {
    type: { type: String, required: true, enum: SUBLEDGER_TYPES as unknown as string[] },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const journalLineSchema = new Schema<IJournalLine>(
  {
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },

    debit: { type: Number, required: true, default: 0, min: 0 },
    credit: { type: Number, required: true, default: 0, min: 0 },
    signedAmount: { type: Number, required: true },
    balanceAfter: { type: Number },

    subledgerRef: { type: subledgerRefSchema, default: null },

    date: { type: Date, required: true },
    postingPeriod: { type: String, required: true },
    status: { type: String, required: true, enum: ['posted', 'reversed'], default: 'posted' },

    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    cityKey: { type: String, trim: true },

    lineNarration: { type: String, trim: true, maxlength: 300 },
    idempotencyKey: { type: String },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'JournalLine' },
  },
  { timestamps: true },
);

/**
 * The unique index that stands in for a transaction.
 *
 * The posting service inserts each line by this key and moves the ledger balance ONLY when the
 * insert was genuinely new. A replayed request collides here, the insert is skipped, and the
 * balance is therefore never incremented twice.
 */
journalLineSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
/** The Ledger Statement: one account, in date order, with a running balance. */
journalLineSchema.index({ ledgerId: 1, date: -1 });
/** The Trial Balance: everything posted up to a period. */
journalLineSchema.index({ ledgerId: 1, postingPeriod: 1, status: 1 });
journalLineSchema.index({ journalEntryId: 1 });
/** Party statements and the ageing reports. */
journalLineSchema.index({ 'subledgerRef.type': 1, 'subledgerRef.id': 1, date: -1 });
journalLineSchema.index({ cityKey: 1, postingPeriod: 1 });
journalLineSchema.index({ date: -1 });

export const JournalLineModel = model<IJournalLine>('JournalLine', journalLineSchema);
