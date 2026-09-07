import { Schema, model, Document, Types } from 'mongoose';

/**
 * The header of a double-entry transaction. Its lines live in their own collection — see
 * `journal-line.model.ts` for why they are not embedded.
 *
 * ## Posted is immutable
 *
 * There is no update path and no delete path for a posted entry, and no endpoint offers one.
 * That is stronger than the v1.0 spec's `is_editable` flag, which relies on every future caller
 * remembering to check it. A mistake is corrected by a reversing entry, which leaves both
 * documents readable and linked in both directions.
 */

/** Where the entry came from. `manual` is the only one a person types; the rest are posted. */
export type JournalSourceType =
  | 'manual'
  | 'opening_balance'
  | 'order_delivery'
  | 'order_cogs'
  | 'collection'
  | 'collection_correction'
  | 'collection_void'
  | 'credit_recovery'
  | 'credit_recovery_correction'
  | 'settlement_received'
  | 'settlement_variance'
  | 'stock_receipt'
  | 'stock_receipt_reversal'
  | 'customer_return'
  | 'damage_claim'
  | 'transfer_out'
  | 'transfer_in'
  | 'transfer_shrinkage'
  | 'stock_count_adjustment'
  | 'invoice'
  | 'bill'
  | 'payment_received'
  | 'payment_made'
  | 'expense'
  | 'payroll_accrual'
  | 'bad_debt_writeoff'
  | 'year_end_close';

export const JOURNAL_SOURCE_TYPES: JournalSourceType[] = [
  'manual', 'opening_balance', 'order_delivery', 'order_cogs', 'collection',
  'collection_correction', 'collection_void', 'credit_recovery', 'credit_recovery_correction',
  'settlement_received', 'settlement_variance', 'stock_receipt', 'stock_receipt_reversal',
  'customer_return', 'damage_claim', 'transfer_out', 'transfer_in', 'transfer_shrinkage',
  'stock_count_adjustment', 'invoice', 'bill', 'payment_received', 'payment_made', 'expense',
  'payroll_accrual', 'bad_debt_writeoff', 'year_end_close',
];

export type JournalStatus = 'draft' | 'posted' | 'reversed' | 'void';

export interface IJournalEntry extends Document {
  _id: Types.ObjectId;
  /** Allocated from the atomic counter at POST, never at draft — see `finance-counters.ts`. */
  entryNo?: number;
  /** Business date. Deliberately separate from `createdAt`, which is when it was typed. */
  date: Date;
  /** `YYYY-MM`, derived from `date` in the report timezone. Indexed equality for every period query. */
  postingPeriod: string;
  referenceNo?: string;
  narration?: string;

  sourceType: JournalSourceType;
  sourceId?: Types.ObjectId;
  /** Model name, so "open the source document" needs no switch statement per type. */
  sourceModel?: string;

  status: JournalStatus;
  /** A fact, not a rule. Editability is derived: a draft is editable, a posted entry never is. */
  isSystemGenerated: boolean;

  totalDebit: number;
  totalCredit: number;

  postedAt?: Date;
  postedBy?: Types.ObjectId;

  /** Set on the REVERSING entry, pointing at the original. */
  reversalOf?: Types.ObjectId;
  /** Set on the ORIGINAL, pointing at its reversal. Both directions, so neither has to be scanned for. */
  reversedByEntryId?: Types.ObjectId;
  reversedAt?: Date;
  reversedBy?: Types.ObjectId;
  reversalReason?: string;

  idempotencyKey?: string;

  /**
   * The lines of a DRAFT, while it is still being written.
   *
   * A draft is a working document: freely editable, carrying no number, moving no balance. Its
   * lines live here because there is nothing to query them by yet and embedding keeps an edit
   * to a single atomic write.
   *
   * Posting materialises them into the `JournalLine` collection and clears this field, so a
   * posted entry has exactly ONE representation of its lines. Two would eventually disagree,
   * and the disagreement would surface as a balance nobody could explain.
   */
  draftLines?: {
    ledgerId: Types.ObjectId;
    debit: number;
    credit: number;
    lineNarration?: string;
    subledgerRef?: { type: string; id: Types.ObjectId } | null;
  }[];

  /** Cost-centre dimension, stamped from the source document. */
  warehouseId?: Types.ObjectId;
  cityKey?: string;

  attachments: string[];

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const draftSubledgerRefSchema = new Schema(
  {
    type: { type: String, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const draftLineSchema = new Schema(
  {
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    lineNarration: { type: String, trim: true, maxlength: 300 },
    subledgerRef: { type: draftSubledgerRefSchema, default: null },
  },
  { _id: false },
);

const journalEntrySchema = new Schema<IJournalEntry>(
  {
    entryNo: { type: Number, min: 1 },
    date: { type: Date, required: true },
    postingPeriod: { type: String, required: true },
    referenceNo: { type: String, trim: true, maxlength: 50 },
    narration: { type: String, trim: true, maxlength: 1000 },

    sourceType: { type: String, required: true, enum: JOURNAL_SOURCE_TYPES, default: 'manual' },
    sourceId: { type: Schema.Types.ObjectId },
    sourceModel: { type: String, trim: true, maxlength: 50 },

    status: {
      type: String,
      required: true,
      enum: ['draft', 'posted', 'reversed', 'void'],
      default: 'draft',
    },
    isSystemGenerated: { type: Boolean, default: false },

    totalDebit: { type: Number, required: true, default: 0 },
    totalCredit: { type: Number, required: true, default: 0 },

    postedAt: { type: Date },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    reversalOf: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reversedByEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reversedAt: { type: Date },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reversalReason: { type: String, trim: true, maxlength: 500 },

    idempotencyKey: { type: String },

    draftLines: { type: [draftLineSchema], default: undefined },

    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    cityKey: { type: String, trim: true },

    attachments: { type: [String], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// No `isTrashed`. Finance documents are never trashed or purged — see the spec's §3.6.

journalEntrySchema.index({ entryNo: 1 }, { unique: true, sparse: true });
/** The unique index that makes a replayed post a no-op instead of a second entry. */
journalEntrySchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
journalEntrySchema.index({ postingPeriod: 1, status: 1 });
journalEntrySchema.index({ date: -1, status: 1 });
// "Show me every entry this delivery produced", and the guard against posting one twice.
journalEntrySchema.index({ sourceType: 1, sourceId: 1 });
journalEntrySchema.index({ status: 1, createdAt: -1 });
journalEntrySchema.index({ reversalOf: 1 }, { sparse: true });
journalEntrySchema.index({ cityKey: 1, postingPeriod: 1 });

export const JournalEntryModel = model<IJournalEntry>('JournalEntry', journalEntrySchema);
