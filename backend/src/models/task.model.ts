import { Schema, model, Document, Types } from 'mongoose';

export interface ICompletionImage {
  type: 'shop' | 'selfie';
  url: string;
}

export interface ITask extends Document {
  _id: Types.ObjectId;
  taskName: string;
  description?: string;
  referenceImage?: string;
  document?: string;
  employeeNotes?: string;
  quantity?: number;
  dealerId?: Types.ObjectId;
  routeId?: Types.ObjectId;
  assignedTo?: Types.ObjectId;
  assignedBy?: Types.ObjectId;
  status: 'pending' | 'in_progress' | 'completed';
  startedAt?: Date;
  completedAt?: Date;
  completionImages: ICompletionImage[];
  latitude?: number;
  longitude?: number;
  timestamp?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const completionImageSchema = new Schema<ICompletionImage>(
  {
    type: { type: String, enum: ['shop', 'selfie'], required: true },
    url: { type: String, required: true },
  },
  { _id: false },
);

const taskSchema = new Schema<ITask>(
  {
    taskName: { type: String, required: true },
    description: { type: String },
    referenceImage: { type: String },
    document: { type: String },
    employeeNotes: { type: String },
    quantity: { type: Number },
    dealerId: { type: Schema.Types.ObjectId, ref: 'Dealer' },
    routeId: { type: Schema.Types.ObjectId, ref: 'Route' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed'],
      default: 'pending',
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
    completionImages: { type: [completionImageSchema], default: [] },
    latitude: { type: Number },
    longitude: { type: Number },
    timestamp: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

taskSchema.index({ dealerId: 1 });
taskSchema.index({ routeId: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ status: 1 });

export const TaskModel = model<ITask>('Task', taskSchema);
