import { Schema, model, Document, Types } from 'mongoose';

export interface IAttendance extends Document {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  date: Date;
  checkInTime: Date;
  checkInLatitude: number;
  checkInLongitude: number;
  checkOutTime?: Date;
  checkOutLatitude?: number;
  checkOutLongitude?: number;
  note?: string;
  isTrashed?: boolean;
  trashedAt?: Date;
  trashedBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Stored as midnight UTC of the attendance day for uniqueness enforcement. */
    date: { type: Date, required: true },
    checkInTime: { type: Date, required: true },
    checkInLatitude: { type: Number, required: true },
    checkInLongitude: { type: Number, required: true },
    checkOutTime: { type: Date },
    checkOutLatitude: { type: Number },
    checkOutLongitude: { type: Number },
    note: { type: String },
    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },
    trashedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

attendanceSchema.index({ employeeId: 1 });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ isTrashed: 1, createdAt: -1 });
attendanceSchema.index({ isTrashed: 1, trashedAt: -1 });
/** One record per employee per calendar day. */
attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });

export const AttendanceModel = model<IAttendance>('Attendance', attendanceSchema);
