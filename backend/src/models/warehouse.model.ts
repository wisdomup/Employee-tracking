import { Schema, model, Document, Types } from 'mongoose';

export interface IWarehouse extends Document {
  _id: Types.ObjectId;
  name: string;
  city: string;
  /** Normalised `city` (trimmed + lowercased). Lets sales routing match on equality. */
  cityKey: string;
  address?: string;
  managerId?: Types.ObjectId;
  /** All Stock In lands in the Main warehouse. At most one warehouse may hold this flag. */
  isMain: boolean;
  isActive: boolean;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const warehouseSchema = new Schema<IWarehouse>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true },
    cityKey: { type: String, required: true, index: true },
    address: { type: String, trim: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User' },
    isMain: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

warehouseSchema.index({ cityKey: 1, isTrashed: 1 });
warehouseSchema.index({ isTrashed: 1, createdAt: -1 });
warehouseSchema.index({ isTrashed: 1, trashedAt: -1 });

/**
 * "Exactly one Main warehouse" enforced by the database rather than by convention. A trashed
 * Main still occupies the slot, which is why `trashWarehouse` refuses to trash the Main one.
 */
warehouseSchema.index(
  { isMain: 1 },
  { unique: true, partialFilterExpression: { isMain: true } },
);

export const WarehouseModel = model<IWarehouse>('Warehouse', warehouseSchema);
