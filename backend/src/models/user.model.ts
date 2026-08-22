import { Schema, model, Document, Types } from 'mongoose';
import { ROLES } from '../constants/global';

export interface IUser extends Document {
  _id: Types.ObjectId;
  userID: string;
  username: string;
  /** Display name for invoices and UI; optional — fall back to username when empty. */
  fullName?: string;
  phone: string;
  email?: string;
  password: string;
  /**
   * The user's PRIMARY role, and the one every pre-existing query still reads.
   *
   * Kept authoritative rather than deprecated: ~305 references across the backend filter on
   * it, the freeze cron sweeps by it, and analytics scoping groups by it. It is always
   * `roles[0]`, enforced by the pre-validate hook below.
   */
  role: string;
  /**
   * Every role assigned to this user, primary first.
   *
   * Added alongside `role` rather than replacing it so multi-role assignment could ship
   * without rewriting every existing query in one change. A user with a single role has a
   * one-element array, which is the state every account is migrated into.
   *
   * When this holds two or more roles the resolver looks for a `PermissionProfile` covering
   * that exact combination — the roles are never unioned automatically.
   */
  roles: string[];
  /**
   * The sales_manager this field-staff user reports to.
   * Drives analytics scoping: a manager sees only the users pointing at them.
   */
  managerId?: Types.ObjectId;
  /**
   * The warehouse this person works at. Required in practice for `warehouse_staff` — a staff
   * account without one is locked out of the warehouse module rather than handed every
   * warehouse. For `warehouse_manager` it narrows an otherwise company-wide scope.
   */
  warehouseId?: Types.ObjectId;
  /**
   * Whether the nightly cron generates route visits for this person.
   * Defaults to true; missing means enabled, so existing users keep their behaviour.
   * Turn off for someone on leave, in training, or working ad-hoc — they can still be
   * given visits manually and can still start their own from the client list.
   */
  autoAssignVisits?: boolean;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  profileImage?: string;
  designation?: string;
  perks?:{
    salary?: number;
    bonus?: number;
    allowance?: number;
  },
  extraNotes?: string;
  profilePicture?: string;
  lastExperience?: string;
  target?: string;
  achivedTarget?: string;
  isActive: boolean;
  /**
   * Discipline lock raised when a rider fails to reach their first shop by the daily
   * deadline — see `modules/account-freeze`. A frozen rider can still sign in and read
   * their day (so they can see *why*), but every write in the field modules is refused
   * until an admin clears it.
   *
   * Deliberately separate from `isActive`: that is the admin's permanent on/off switch
   * for an account, this is an automatic, admin-clearable lock. Conflating them would
   * make "did an admin disable this person, or were they just late?" unanswerable.
   * Missing means not frozen, so every pre-existing user is unaffected.
   */
  isFrozen?: boolean;
  frozenAt?: Date;
  /** Human-readable explanation, shown verbatim to the rider and the admin. */
  frozenReason?: string;
  /** Absent when the system froze them automatically; set when an admin did it by hand. */
  frozenBy?: Types.ObjectId;
  unfrozenAt?: Date;
  unfrozenBy?: Types.ObjectId;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  resetToken?: string;
  resetTokenExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    userID: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    fullName: { type: String, trim: true, maxlength: 200 },
    phone: { type: String, required: true, unique: true },
    email: { type: String },
    password: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: Object.values(ROLES),
    },
    roles: {
      type: [String],
      default: undefined,
      enum: Object.values(ROLES),
    },
    managerId: { type: Schema.Types.ObjectId, ref: 'User' },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    autoAssignVisits: { type: Boolean, default: true },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
    },
    profileImage: { type: String },
    designation: { type: String },
    perks: {
      salary: Number,
      bonus: Number,
      allowance: Number,
    },
    extraNotes: { type: String },
    profilePicture: { type: String },
    lastExperience: { type: String },
    target: { type: String },
    achivedTarget: { type: String },
    isActive: { type: Boolean, default: true },
    isFrozen: { type: Boolean, default: false },
    frozenAt: { type: Date },
    frozenReason: { type: String, trim: true, maxlength: 500 },
    frozenBy: { type: Schema.Types.ObjectId, ref: 'User' },
    unfrozenAt: { type: Date },
    unfrozenBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resetToken: { type: String },
    resetTokenExpiry: { type: Date },
  },
  { timestamps: true },
);

/**
 * Keep `role` and `roles` in lockstep from whichever side the caller wrote.
 *
 * Two directions, because both write paths exist in the codebase: older code (and the public
 * register endpoint) sets `role` alone, while the new employee form sets `roles`. Reconciling
 * here rather than at every call site is what lets the two coexist during the migration —
 * a user document is never left with a `role` that is absent from its own `roles`.
 */
userSchema.pre('validate', function (next) {
  const hasRoles = Array.isArray(this.roles) && this.roles.length > 0;

  // Which side was just written decides which side wins. Always trusting `roles` looks
  // simpler and is wrong: `updateUser` assigns `role` from the employee form without
  // touching `roles`, so `this.role = this.roles[0]` would quietly revert the change and the
  // admin would watch the dropdown snap back with no error.
  if (this.isModified('roles') && hasRoles) {
    // De-duplicate without reordering, so an admin who put the roles in a deliberate order
    // keeps it. First entry is the primary.
    this.roles = [...new Set(this.roles)];
    this.role = this.roles[0];
  } else if (this.isModified('role') && this.role) {
    /*
     * Primary changed on its own — `updateUser` writing the employee form's Role dropdown.
     *
     * The whole assignment is replaced rather than the first entry swapped. Keeping the other
     * entries would mean an admin who changed someone's role still left them holding
     * permissions from the old one, with nothing on screen saying so; and the hook cannot
     * tell a deliberately-added second role from the primary it is replacing.
     *
     * Nothing is lost in the normal flow: the employee form calls `setUserRoles` straight
     * after, which writes the full array and takes the branch above.
     */
    this.roles = [this.role];
  } else if (!hasRoles && this.role) {
    // Neither was touched and the array is missing — a document written before multi-role.
    this.roles = [this.role];
  } else if (hasRoles) {
    this.role = this.roles[0];
  }

  next();
});

userSchema.index({ role: 1 });
// Multi-role lookups: "who holds warehouse_staff at all", not just as their primary.
userSchema.index({ roles: 1, isTrashed: 1 });
// Resolving a sales manager's team for analytics scoping
userSchema.index({ managerId: 1, isTrashed: 1 });
// Grouping salesmen into regions for the region-wise sale dashboard
userSchema.index({ 'address.city': 1, isTrashed: 1 });
// Listing the staff attached to a warehouse
userSchema.index({ warehouseId: 1, isTrashed: 1 });
// The admin "who is frozen today" queue, and the cron's sweep over freezable roles.
userSchema.index({ isFrozen: 1, role: 1, isTrashed: 1 });
userSchema.index({ isTrashed: 1, createdAt: -1 });
userSchema.index({ isTrashed: 1, trashedAt: -1 });

export const UserModel = model<IUser>('User', userSchema);
