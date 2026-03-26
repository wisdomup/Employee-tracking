import { Schema, model, Document, Types } from 'mongoose';

export interface IVisitCompletionImage {
  type: 'shop' | 'selfie';
  url: string;
}

export interface IVisit extends Document {
  _id: Types.ObjectId;
  dealerId: Types.ObjectId;
  employeeId: Types.ObjectId;
  routeId?: Types.ObjectId;
  visitDate?: Date;
  status: 'todo' | 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  completedAt?: Date;
  latitude?: number;
  longitude?: number;
  completionImages?: IVisitCompletionImage[];
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const visitCompletionImageSchema = new Schema<IVisitCompletionImage>(
  {
    type: { type: String, enum: ['shop', 'selfie'], required: true },
    url: { type: String, required: true },
  },
  { _id: false },
);

const visitSchema = new Schema<IVisit>(
  {
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    routeId: { type: Schema.Types.ObjectId, ref: 'Route' },
    visitDate: { type: Date },
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'completed', 'incomplete', 'cancelled'],
      default: 'todo',
    },
    completedAt: { type: Date },
    latitude: { type: Number },
    longitude: { type: Number },
    completionImages: { type: [visitCompletionImageSchema], default: [] },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

visitSchema.index({ dealerId: 1 });
visitSchema.index({ employeeId: 1 });
visitSchema.index({ routeId: 1 });
visitSchema.index({ status: 1 });
visitSchema.index({ isTrashed: 1, createdAt: -1 });
visitSchema.index({ isTrashed: 1, trashedAt: -1 });

export const VisitModel = model<IVisit>('Visit', visitSchema);
