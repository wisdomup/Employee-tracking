import { Schema, model, Document, Types } from 'mongoose';

/**
 * A single document holding everything the finance module needs configured, including the map
 * from a named engine role to an actual ledger.
 *
 * ## Why the ledger map exists
 *
 * The posting engine must never hardcode a ledger code. If it did, "the chart of accounts is
 * fully admin-customisable" would be a claim the first renamed account disproves. Instead the
 * engine asks for `arTrade` or `cogs` and this map answers, so an admin can re-code and
 * reorganise the chart freely as long as the roles stay assigned.
 *
 * A missing mapping is a boot-time failure with a named error, the same discipline
 * `requirePermission` applies to route guards — a finance module that starts and then cannot
 * post is worse than one that refuses to start.
 */

/** Every named ledger role the posting engine resolves. Adding one here is a spec change. */
export const LEDGER_ROLE_KEYS = [
  'officeCash',
  'bank',
  'chequesInHand',
  'chequesIssued',
  'riderCash',
  'onlineInTransit',
  'arTrade',
  'inventorySellable',
  'inventoryInTransit',
  'inventoryOutForDelivery',
  'inputTax',
  'staffAdvances',
  'apTrade',
  'grni',
  'outputTax',
  'salaryPayable',
  'retainedEarnings',
  'openingEquity',
  'salesGoods',
  'salesReturns',
  'salesDiscounts',
  'cogs',
  'damageWriteOff',
  'transferShrinkage',
  'countAdjustment',
  'salaryExpense',
  'badDebt',
  'cashDifference',
  'suspense',
] as const;

export type LedgerRoleKey = (typeof LEDGER_ROLE_KEYS)[number];

/**
 * Auto-posting toggles, all default OFF.
 *
 * This is what lets the integration steps be merged and deployed long before anyone turns them
 * on, and then switched on one event at a time on live data while the nightly reconciliation is
 * watched each morning. Turning all of them on at once is the single riskiest thing anyone
 * could do to this module.
 */
export const POSTING_EVENT_KEYS = [
  'orderDelivery',
  'orderCogs',
  'collection',
  'creditRecovery',
  'settlement',
  'stockReceipt',
  'customerReturn',
  'damageClaim',
  'stockTransfer',
  'stockCount',
  'expense',
  'payroll',
] as const;

export type PostingEventKey = (typeof POSTING_EVENT_KEYS)[number];

export interface IFinanceSettings extends Document {
  _id: Types.ObjectId;
  /** Single-document guard: always the string `singleton`, uniquely indexed. */
  key: string;

  /** 7 = July, the Pakistani standard and the client's answer. */
  fiscalYearStartMonth: number;
  baseCurrency: string;
  currencySymbol: string;

  /** Receivable and payable ageing buckets, in days. Upper bound of each, last is open-ended. */
  agingBuckets: number[];

  /** Named engine role to ledger id. Resolved on every auto-posting. */
  ledgerMap: Map<string, Types.ObjectId>;
  /** Per-event auto-posting switches. Absent reads as off. */
  postingEnabled: Map<string, boolean>;

  /** Set once the opening entry is posted and the books are live. */
  booksOpenedAt?: Date;
  cutoverDate?: Date;

  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const financeSettingsSchema = new Schema<IFinanceSettings>(
  {
    key: { type: String, required: true, default: 'singleton' },

    fiscalYearStartMonth: { type: Number, required: true, default: 7, min: 1, max: 12 },
    baseCurrency: { type: String, required: true, default: 'PKR', trim: true, maxlength: 3 },
    currencySymbol: { type: String, required: true, default: 'Rs.', trim: true, maxlength: 8 },

    agingBuckets: { type: [Number], default: [30, 60, 90] },

    // Maps rather than plain objects, matching `AccessPolicy.grants`: a Map keeps keys out of
    // Mongoose's dotted-path handling, which matters the moment a key contains a dot.
    ledgerMap: { type: Map, of: Schema.Types.ObjectId, default: () => new Map() },
    postingEnabled: { type: Map, of: Boolean, default: () => new Map() },

    booksOpenedAt: { type: Date },
    cutoverDate: { type: Date },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/** One settings document, enforced by the database rather than by convention. */
financeSettingsSchema.index({ key: 1 }, { unique: true });

export const FinanceSettingsModel = model<IFinanceSettings>(
  'FinanceSettings',
  financeSettingsSchema,
);
