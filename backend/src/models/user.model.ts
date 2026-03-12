import { Schema, model, Document, Types } from 'mongoose';
import { ROLES } from '../constants/global';

export interface IUser extends Document {
  _id: Types.ObjectId;
  userID: string;
  username: string;
  phone: string;
  email?: string;
  password: string;
  role: string;
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
  resetToken?: string;
  resetTokenExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    userID: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String },
    password: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: Object.values(ROLES),
    },
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
    resetToken: { type: String },
    resetTokenExpiry: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ role: 1 });

export const UserModel = model<IUser>('User', userSchema);
