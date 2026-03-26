import { Schema, model, Document, Types } from 'mongoose';

export interface IRoute extends Document {
  _id: Types.ObjectId;
  name: string;
  startingPoint: string;
  endingPoint: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const routeSchema = new Schema<IRoute>(
  {
    name: { type: String, required: true },
    startingPoint: { type: String, required: true },
    endingPoint: { type: String, required: true },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    zipCode: { type: String },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

routeSchema.index({ name: 1 });
routeSchema.index({ isTrashed: 1, createdAt: -1 });
routeSchema.index({ isTrashed: 1, trashedAt: -1 });

export const RouteModel = model<IRoute>('Route', routeSchema);
