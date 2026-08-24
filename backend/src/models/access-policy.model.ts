import { Schema, model, Document, Types } from 'mongoose';

/**
 * One editable permission set — the saved state of a matrix screen.
 *
 * A policy belongs to a single role, a named multi-role profile, or ONE INDIVIDUAL USER. All
 * three are stored in the same collection because they are the same shape and the resolver
 * treats them interchangeably; splitting them would mean three near-identical schemas and
 * three code paths that must never drift.
 *
 * A `user` policy is a per-person override. It wins outright over that person's role and over
 * any profile — it is not layered on top of them and nothing is merged. Once set, the user's
 * roles stop deciding what they can do, which is why the editor shows a clear banner and a
 * one-click way to remove the override and fall back to normal role behaviour.
 *
 * `admin` deliberately has NO policy document. `resolveAccess()` short-circuits on it before
 * ever reaching this collection, so the super-admin cannot be edited into a lockout.
 */
export type PolicySubjectType = 'role' | 'profile' | 'user';

/** The five actions, as stored. Absent field reads as `false`. */
export interface IModuleGrant {
  view?: boolean;
  add?: boolean;
  edit?: boolean;
  delete?: boolean;
  change?: boolean;
}

export interface IAccessPolicy extends Document {
  _id: Types.ObjectId;
  subjectType: PolicySubjectType;
  /**
   * For `role`: the role identifier (`order_taker`, `delivery_man`, …).
   * For `profile`: the string form of the `PermissionProfile` `_id`.
   * For `user`: the string form of the `User` `_id`.
   */
  subjectKey: string;
  /**
   * moduleId to its five action booleans. A `Map` rather than a nested object so module ids
   * containing a dot (none today, but report-style ids are one refactor away) cannot collide
   * with Mongoose's dotted-path handling.
   */
  grants: Map<string, IModuleGrant>;
  /**
   * Report ids this subject may view. Reports are an allow-list, not a grant object — there
   * is only one verb, so a boolean per report would be noise.
   */
  reports: string[];
  /**
   * True for the policies written by the seed. Blocks deletion of the six role policies;
   * their contents stay fully editable. Without this an Admin could delete the
   * `warehouse_staff` policy and leave every warehouse account with no resolvable access.
   */
  isSystem: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const moduleGrantSchema = new Schema<IModuleGrant>(
  {
    view: { type: Boolean, default: false },
    add: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    change: { type: Boolean, default: false },
    // `delete` is a reserved word in enough contexts to be worth naming explicitly here.
    delete: { type: Boolean, default: false },
  },
  { _id: false },
);

const accessPolicySchema = new Schema<IAccessPolicy>(
  {
    subjectType: { type: String, required: true, enum: ['role', 'profile', 'user'] },
    subjectKey: { type: String, required: true, trim: true },
    grants: {
      type: Map,
      of: moduleGrantSchema,
      default: () => new Map<string, IModuleGrant>(),
    },
    reports: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One policy per subject. The unique index is the guard against a double-save racing itself
// into two policies for the same role, which would resolve non-deterministically.
accessPolicySchema.index({ subjectType: 1, subjectKey: 1 }, { unique: true });

export const AccessPolicyModel = model<IAccessPolicy>('AccessPolicy', accessPolicySchema);
