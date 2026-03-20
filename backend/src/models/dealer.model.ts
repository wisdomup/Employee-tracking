import { Schema, model, Document, Types } from 'mongoose';
import { DEALER_CATEGORIES, DealerCategory } from '../constants/global';

export interface IDealer extends Document {
  _id: Types.ObjectId;
  name: string;
  phone: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  latitude?: number;
  longitude?: number;
  shopImage?: string;
  profilePicture?: string;
  category?: DealerCategory;
  rating?: number;
  route?: Types.ObjectId; // reference to a single route
  status: 'active' | 'inactive';
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const dealerSchema = new Schema<IDealer>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
    },
    latitude: { type: Number },
    longitude: { type: Number },
    shopImage: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    route: { type: Schema.Types.ObjectId, ref: 'Route' },
    profilePicture: { type: String },
    category: { type: String, enum: Object.values(DEALER_CATEGORIES as Record<string, string>) },
    rating: { type: Number },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

dealerSchema.index({ status: 1 });
dealerSchema.index({ latitude: 1, longitude: 1 });

export const DealerModel = model<IDealer>('Dealer', dealerSchema);
