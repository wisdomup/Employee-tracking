import { Schema, model, Document, Types } from 'mongoose';

export interface IReturn extends Document {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  dealerId: Types.ObjectId;
  returnType: 'return' | 'claim';
  returnReason?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const returnSchema = new Schema<IReturn>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer', required: true },
    returnType: { type: String, enum: ['return', 'claim'], required: true },
    returnReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

returnSchema.index({ productId: 1 });
returnSchema.index({ dealerId: 1 });
returnSchema.index({ createdBy: 1 });

export const ReturnModel = model<IReturn>('Return', returnSchema);
