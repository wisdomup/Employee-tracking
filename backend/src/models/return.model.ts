import { Schema, model, Document, Types } from 'mongoose';

export interface IReturnProduct {
  productId: Types.ObjectId;
  quantity: number;
  price: number;
}

export interface IReturn extends Document {
  _id: Types.ObjectId;
  dealerId: Types.ObjectId;
  returnType: 'return' | 'damage';
  products: IReturnProduct[];
  invoiceImage?: string;
  amount?: number;
  status: 'pending' | 'approved' | 'picked' | 'completed';
  returnReason?: string;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const returnProductSchema = new Schema<IReturnProduct>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const returnSchema = new Schema<IReturn>(
  {
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer', required: true },
    returnType: { type: String, enum: ['return', 'damage'], required: true },
    products: { type: [returnProductSchema], required: true, default: [] },
    invoiceImage: { type: String },
    amount: { type: Number, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'picked', 'completed'],
      default: 'pending',
    },
    returnReason: { type: String },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

returnSchema.index({ dealerId: 1 });
returnSchema.index({ createdBy: 1 });
returnSchema.index({ status: 1 });
returnSchema.index({ isTrashed: 1, createdAt: -1 });
returnSchema.index({ isTrashed: 1, trashedAt: -1 });

export const ReturnModel = model<IReturn>('Return', returnSchema);
