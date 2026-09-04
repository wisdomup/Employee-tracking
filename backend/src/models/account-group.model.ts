import { Schema, model, Document, Types } from 'mongoose';
import { ACCOUNT_TYPES, AccountType } from '../modules/finance/finance.rules';

/**
 * A node in the chart of accounts tree. Ledgers hang off groups; groups hang off groups.
 *
 * ## Type is set at the root and inherited
 *
 * `accountType` is required on every document so that reports never have to walk up the tree to
 * find one, but a child may not DISAGREE with its parent — `chart.service.ts` refuses it. An
 * expense group sitting under Assets would render on no statement at all, and nothing downstream
 * could report the inconsistency in a way an admin could act on.
 */
export interface IAccountGroup extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;
  accountType: AccountType;
  parentGroupId?: Types.ObjectId | null;
  /** 1 for a root group. Stored so a tree render does not need a recursive lookup per node. */
  depth: number;
  /** Report ordering among siblings. A balance sheet is read in a conventional order. */
  sortOrder: number;
  /** Seeded groups. Deletion refused; renaming and re-coding stay open. */
  isSystem: boolean;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const accountGroupSchema = new Schema<IAccountGroup>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true },
    accountType: { type: String, required: true, enum: ACCOUNT_TYPES as unknown as string[] },
    parentGroupId: { type: Schema.Types.ObjectId, ref: 'AccountGroup', default: null },
    depth: { type: Number, required: true, default: 1, min: 1 },
    sortOrder: { type: Number, default: 0 },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// No `isTrashed` anywhere in this module — see the Trash exclusion in the spec. A finance
// master that has been posted to is retired with `isActive`, never deleted.

accountGroupSchema.index({ code: 1 }, { unique: true });
accountGroupSchema.index({ parentGroupId: 1, sortOrder: 1 });
accountGroupSchema.index({ accountType: 1, isActive: 1 });

export const AccountGroupModel = model<IAccountGroup>('AccountGroup', accountGroupSchema);
