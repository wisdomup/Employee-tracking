import { Schema, model, Document, Types } from 'mongoose';

export interface ICategory extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  image?: string;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true },
    description: { type: String },
    image: { type: String },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

categorySchema.index({ name: 1 });
categorySchema.index({ createdBy: 1 });
categorySchema.index({ isTrashed: 1, createdAt: -1 });
categorySchema.index({ isTrashed: 1, trashedAt: -1 });

export const CategoryModel = model<ICategory>('Category', categorySchema);
