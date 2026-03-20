import { Schema, model, Document, Types } from 'mongoose';

export interface IProduct extends Document {
  _id: Types.ObjectId;
  barcode: string;
  name: string;
  description?: string;
  image?: string;
  salePrice?: number;
  purchasePrice?: number;
  onlinePrice?: number;
  quantity?: number;
  categoryId: Types.ObjectId;
  createdBy: Types.ObjectId;
  extras?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    barcode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    image: { type: String },
    salePrice: { type: Number, min: 0 },
    purchasePrice: { type: Number, min: 0 },
    onlinePrice: { type: Number, min: 0 },
    quantity: { type: Number, min: 0 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    extras: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

productSchema.index({ name: 1 });
productSchema.index({ categoryId: 1 });
productSchema.index({ createdBy: 1 });

export const ProductModel = model<IProduct>('Product', productSchema);
