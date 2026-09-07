import { Schema, model, Document, Types } from 'mongoose';

/**
 * A supplier the business buys from.
 *
 * ## Why this did not exist before
 *
 * `StockReceipt.supplierName` is free text, and deliberately so — the original warehouse spec
 * asked only for "pick the product, enter quantity and rate", and the client tracked suppliers on
 * paper. That was fine while nothing needed to total anything by supplier. It stops being fine
 * the moment there are purchase bills to match against goods receipts, because "which of these
 * receipts has Acme already billed us for" cannot be answered against a free-text field that the
 * same supplier has been typed into four different ways.
 *
 * So this is a new master plus a one-off reconciliation of what is already there — see
 * `extractSuppliersFromReceipts` in the service.
 *
 * ## The typed name is never overwritten
 *
 * `StockReceipt.supplierName` stays exactly as it was entered, and this record is linked
 * alongside it. The typed name is what somebody actually wrote on the day; replacing it with a
 * tidied version would quietly rewrite the historical document, and the first time the mapping
 * turns out to be wrong there would be nothing left to check it against.
 */
export interface IVendor extends Document {
  _id: Types.ObjectId;
  name: string;
  /** From `Counter('financeVendorNo')`, e.g. 1, 2, 3. Displayed as V-0001. */
  code: number;

  phone?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };

  /** NTN / STRN. Needed on the purchase side of any tax return. */
  taxRegistrationNo?: string;

  /**
   * Days from a bill's date until it is due. Drives due dates and, later, the overdue report.
   * Zero means payable on receipt, which is what most cash purchases are.
   */
  paymentTermsDays: number;

  /** Pre-fills bill lines for a supplier who always sells the same kind of thing. */
  defaultExpenseLedgerId?: Types.ObjectId;

  /**
   * What was owed to this supplier when the books were opened.
   *
   * Recorded here so the master is complete before the cutover entry is raised. It posts
   * nothing on its own — the opening journal entry does that, exactly as it does for ledgers.
   */
  openingBalance: { amount: number; asOf: Date | null };

  /**
   * The names this supplier was typed as on goods receipts before the master existed.
   *
   * Kept so a merge is auditable and reversible in principle: if "Acme" and "ACME Traders" were
   * merged in error, this says what was combined and the receipts still carry their own text.
   */
  mergedFromNames: string[];

  /**
   * True for the placeholder the migration parks unresolvable receipts on.
   *
   * Skipping those receipts instead would leave the goods-received total unprovable, which is
   * worse than a named bucket somebody can work through.
   */
  isPlaceholder: boolean;

  notes?: string;
  isActive: boolean;

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const vendorSchema = new Schema<IVendor>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    code: { type: Number, required: true },

    phone: { type: String, trim: true, maxlength: 40 },
    email: { type: String, trim: true, maxlength: 200 },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
    },

    taxRegistrationNo: { type: String, trim: true, maxlength: 50 },
    paymentTermsDays: { type: Number, default: 0, min: 0, max: 365 },
    defaultExpenseLedgerId: { type: Schema.Types.ObjectId, ref: 'Ledger' },

    openingBalance: {
      amount: { type: Number, default: 0 },
      asOf: { type: Date, default: null },
    },

    mergedFromNames: { type: [String], default: [] },
    isPlaceholder: { type: Boolean, default: false },

    notes: { type: String, trim: true, maxlength: 1000 },
    isActive: { type: Boolean, default: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// No `isTrashed`. A supplier that has been bought from is retired with `isActive`, never
// deleted — the same rule every finance master follows.

vendorSchema.index({ code: 1 }, { unique: true });
/**
 * Case-insensitive uniqueness on the name.
 *
 * The whole problem this master solves is one supplier existing under several spellings. Letting
 * "Acme" and "acme" both be created would recreate it on day one.
 */
vendorSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
vendorSchema.index({ isActive: 1, name: 1 });
/** The migration's lookup: which supplier did this typed name resolve to? */
vendorSchema.index({ mergedFromNames: 1 });

export const VendorModel = model<IVendor>('Vendor', vendorSchema);
