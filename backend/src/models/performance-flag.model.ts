import { Schema, model, Document, Types } from 'mongoose';

/**
 * Why a rider was flagged.
 * - `low_visit_completion` — they skipped a visit and finished the day below the
 *   required completion rate.
 * - `overstay` — they stayed at a shop longer than the allowed window.
 */
export type PerformanceFlagType = 'low_visit_completion' | 'overstay';

/**
 * An admin-facing flag raised against a rider.
 *
 * The individual Visit also carries its own boolean (`overstayFlagged`) for badge
 * rendering, but that is per-visit and not listable. This collection is the queryable
 * "who needs attention" feed for the admin panel, and can be acknowledged/resolved.
 */
export interface IPerformanceFlag extends Document {
  _id: Types.ObjectId;
  employeeId: Types.ObjectId;
  type: PerformanceFlagType;
  /** UTC midnight of the day the flag relates to — one flag per employee/type/day. */
  flagDate: Date;
  /** Human-readable explanation shown in the admin list. */
  message: string;
  /** The measured value that tripped the flag (e.g. 60 for a 60% completion rate). */
  value?: number;
  /** The limit that was breached (e.g. 75). */
  threshold?: number;
  visitId?: Types.ObjectId;
  routeId?: Types.ObjectId;
  meta?: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const performanceFlagSchema = new Schema<IPerformanceFlag>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['low_visit_completion', 'overstay'],
      required: true,
    },
    flagDate: { type: Date, required: true },
    message: { type: String, required: true },
    value: { type: Number },
    threshold: { type: Number },
    visitId: { type: Schema.Types.ObjectId, ref: 'Visit' },
    routeId: { type: Schema.Types.ObjectId, ref: 'Route' },
    meta: { type: Schema.Types.Mixed },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One flag per employee per type per day — repeated skips on the same bad day update
// the existing row instead of spamming the admin with duplicates.
performanceFlagSchema.index({ employeeId: 1, type: 1, flagDate: 1 }, { unique: true });
// The admin "open flags" feed.
performanceFlagSchema.index({ resolved: 1, flagDate: -1 });

export const PerformanceFlagModel = model<IPerformanceFlag>(
  'PerformanceFlag',
  performanceFlagSchema,
);
