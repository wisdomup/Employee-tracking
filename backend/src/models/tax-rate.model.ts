import { Schema, model, Document, Types } from 'mongoose';

/**
 * A named tax rate the business is registered for.
 *
 * ## Two kinds, and they are opposites
 *
 * `sales` is tax CHARGED to a customer on an invoice. It is collected on the revenue office's
 * behalf and owed onward, and the tax paid on purchases is claimed against it.
 *
 * `withholding` is tax DEDUCTED from a supplier when they are paid. The supplier's invoice is
 * settled in full, less money leaves the bank than the invoice was for, and the difference is
 * owed to the revenue office instead. Nothing about it nets against input tax.
 *
 * They are held in one collection because they are the same shape and are administered by the
 * same person, and kept apart by `kind` because nothing else about them is alike — a screen that
 * offered a sales rate where a withholding rate belonged would silently deduct the wrong figure
 * from a supplier's payment.
 *
 * ## The rate is a default, never an authority
 *
 * Pakistani withholding runs at different rates for goods and services, and differs again for a
 * supplier who is not on the active taxpayer list. Rates also change between budgets. So a rate
 * here is a convenience that fills a field in; the figure recorded on the document is what the
 * accounts use, and a document already posted is never restated because a rate was edited
 * afterwards.
 */
export type TaxRateKind = 'sales' | 'withholding';

export const TAX_RATE_KINDS: TaxRateKind[] = ['sales', 'withholding'];

export interface ITaxRate extends Document {
  _id: Types.ObjectId;
  name: string;
  kind: TaxRateKind;
  /** Whole percent or a fraction of one: 17, 4.5, 0.25. Not a multiplier. */
  percentage: number;
  notes?: string;
  isActive: boolean;

  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const taxRateSchema = new Schema<ITaxRate>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: TAX_RATE_KINDS, required: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    notes: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/**
 * Case-insensitive uniqueness per kind.
 *
 * "Goods — filer" as both a sales rate and a withholding rate is legitimate; the same name twice
 * within one kind is somebody about to pick the wrong one from a dropdown.
 */
taxRateSchema.index(
  { kind: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
taxRateSchema.index({ kind: 1, isActive: 1, name: 1 });

export const TaxRateModel = model<ITaxRate>('TaxRate', taxRateSchema);
