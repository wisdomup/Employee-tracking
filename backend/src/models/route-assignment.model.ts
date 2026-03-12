import { Schema, model, Document, Types } from 'mongoose';

export interface IRouteAssignment extends Document {
  _id: Types.ObjectId;
  routeId: Types.ObjectId;
  employeeId: Types.ObjectId;
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const routeAssignmentSchema = new Schema<IRouteAssignment>(
  {
    routeId: { type: Schema.Types.ObjectId, ref: 'Route', required: true, unique: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

routeAssignmentSchema.index({ employeeId: 1 });

export const RouteAssignmentModel = model<IRouteAssignment>('RouteAssignment', routeAssignmentSchema);
