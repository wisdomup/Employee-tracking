import { Schema, model, Document, Types } from 'mongoose';

export interface ICatalog extends Document {
  _id: Types.ObjectId;
  name: string;
  fileUrl: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const catalogSchema = new Schema<ICatalog>(
  {
    name: { type: String, required: true },
    fileUrl: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

catalogSchema.index({ name: 1 });

export const CatalogModel = model<ICatalog>('Catalog', catalogSchema);
