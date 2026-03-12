import { Schema, model, Document, Types } from 'mongoose';

export interface IOrderProduct {
  productId: Types.ObjectId;
  quantity: number;
  price: number;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  products: IOrderProduct[];
  totalPrice?: number;
  discount?: number;
  grandTotal?: number;
  paidAmount?: number;
  description?: string;
  status: 'pending' | 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  paymentType?: 'online' | 'adjustment' | 'cash' | 'credit';
  orderDate?: Date;
  deliveryDate?: Date;
  dealerId: Types.ObjectId;
  routeId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const orderProductSchema = new Schema<IOrderProduct>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    products: { type: [orderProductSchema], required: true },
    totalPrice: { type: Number },
    discount: { type: Number },
    grandTotal: { type: Number },
    paidAmount: { type: Number },
    description: { type: String },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'],
      default: 'pending',
    },
    paymentType: { type: String, enum: ['online', 'adjustment', 'cash', 'credit'] },
    orderDate: { type: Date },
    deliveryDate: { type: Date },
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer', required: true },
    routeId: { type: Schema.Types.ObjectId, ref: 'Route' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

orderSchema.index({ dealerId: 1 });
orderSchema.index({ routeId: 1 });
orderSchema.index({ createdBy: 1 });
orderSchema.index({ status: 1 });

export const OrderModel = model<IOrder>('Order', orderSchema);
