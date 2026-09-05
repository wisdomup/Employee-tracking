import { Schema, model, Document, Types } from 'mongoose';

/**
 * One accounting month, and whether anything may still be posted into it.
 *
 * v1.0 locks individual entries but nothing stops a back-dated entry landing in a month already
 * reported to the owner. This is what stops it.
 *
 * ## A missing period is CLOSED, not open
 *
 * `period.service.ts` treats "no document for this month" as closed rather than open. Failing
 * shut means a date typo of `2019-03` is refused; failing open means it is quietly accepted and
 * lands in a year nobody looks at again.
 */
export type PeriodStatus = 'open' | 'closed' | 'locked';

export interface IFinancialPeriod extends Document {
  _id: Types.ObjectId;
  /** `YYYY-MM`. */
  period: string;
  /** e.g. `2026-27` for a July start. */
  fiscalYear: string;

  /**
   * `open`   — accepts postings.
   * `closed` — refuses new postings; a Finance Manager may still post a reversal into it.
   * `locked` — refuses everything, reversals included. Used for periods before the cutover.
   */
  status: PeriodStatus;

  closedAt?: Date;
  closedBy?: Types.ObjectId;
  reopenedAt?: Date;
  reopenedBy?: Types.ObjectId;
  reopenReason?: string;

  /**
   * Taken at close, so "the January figures changed" becomes provable rather than arguable.
   *
   * `ledgerBalances` is what makes an as-at-date trial balance cheap: once a period is closed,
   * a later query aggregates lines since the last close instead of since inception.
   */
  snapshot?: {
    totalDebit: number;
    totalCredit: number;
    entryCount: number;
    ledgerBalances: { ledgerId: Types.ObjectId; debit: number; credit: number }[];
  };

  createdAt: Date;
  updatedAt: Date;
}

const snapshotBalanceSchema = new Schema(
  {
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger', required: true },
    debit: { type: Number, required: true, default: 0 },
    credit: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const financialPeriodSchema = new Schema<IFinancialPeriod>(
  {
    period: { type: String, required: true, trim: true },
    fiscalYear: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: ['open', 'closed', 'locked'],
      default: 'open',
    },

    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reopenedAt: { type: Date },
    reopenedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reopenReason: { type: String, trim: true, maxlength: 500 },

    snapshot: {
      type: {
        totalDebit: { type: Number, default: 0 },
        totalCredit: { type: Number, default: 0 },
        entryCount: { type: Number, default: 0 },
        ledgerBalances: { type: [snapshotBalanceSchema], default: [] },
      },
      default: undefined,
    },
  },
  { timestamps: true },
);

/** One document per month. Two would resolve non-deterministically on every posting. */
financialPeriodSchema.index({ period: 1 }, { unique: true });
financialPeriodSchema.index({ fiscalYear: 1, period: 1 });
financialPeriodSchema.index({ status: 1, period: -1 });

export const FinancialPeriodModel = model<IFinancialPeriod>(
  'FinancialPeriod',
  financialPeriodSchema,
);
