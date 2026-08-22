import { Schema, model, Document, Types } from 'mongoose';

/**
 * A named permission set for one multi-role combination — "Rider + Warehouse", say.
 *
 * ## Why profiles rather than merged roles
 *
 * The requirement is that combining roles must NOT union their permissions; Admin sets the
 * final set by hand. Taken literally that means one saved set per combination, and six roles
 * produce 57 of them at roughly 115 cells each. Nobody fills in 6,500 checkboxes, so those
 * sets would sit empty and lock people out — the requirement would defeat itself.
 *
 * A profile is the same control expressed once instead of once per user: Admin defines the
 * combination, sets its matrix by hand, and assigns it wherever that mix occurs. Nothing is
 * merged automatically, which is the part that mattered.
 *
 * ## `roles` is a set, not a list
 *
 * Stored sorted and compared as a set, so a user holding `[warehouse_staff, delivery_man]`
 * matches a profile declared as `[delivery_man, warehouse_staff]`. Order of assignment is not
 * meaningful and treating it as meaningful would produce two profiles for one combination.
 */
export interface IPermissionProfile extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  /** The exact role combination this profile covers. Sorted on save. */
  roles: string[];
  /**
   * Cheap exact-match key: the sorted roles joined with `+`. Resolving a user's profile is a
   * single indexed equality lookup instead of an `$all` + size query on every request.
   */
  roleKey: string;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** The canonical key for a role combination. Exported so the resolver builds it the same way. */
export function buildRoleKey(roles: readonly string[]): string {
  return [...new Set(roles)].sort().join('+');
}

const permissionProfileSchema = new Schema<IPermissionProfile>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    roles: {
      type: [String],
      required: true,
      validate: {
        // A single-role "combination" is just the role, and would shadow that role's own
        // policy in a way an Admin editing the role matrix would not expect.
        validator: (v: string[]) => Array.isArray(v) && new Set(v).size >= 2,
        message: 'A profile must cover at least two distinct roles',
      },
    },
    roleKey: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Keep `roles` and `roleKey` in lockstep no matter which write path set them.
permissionProfileSchema.pre('validate', function (next) {
  if (Array.isArray(this.roles)) {
    this.roles = [...new Set(this.roles)].sort();
    this.roleKey = buildRoleKey(this.roles);
  }
  next();
});

// One active profile per combination — two would resolve non-deterministically. Partial so a
// deactivated profile can be kept for reference while a replacement takes over the same mix.
permissionProfileSchema.index(
  { roleKey: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

export const PermissionProfileModel = model<IPermissionProfile>(
  'PermissionProfile',
  permissionProfileSchema,
);
