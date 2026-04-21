import { Types } from 'mongoose';
import { AttendanceModel } from '../../models/attendance.model';
import { badRequest, conflict, notFound, forbidden } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

/** Return midnight UTC for the date portion of a given timestamp. */
function toMidnightUTC(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function todayMidnightUTC(): Date {
  return toMidnightUTC(new Date());
}

/**
 * Resolve the attendance calendar date.
 * Prefer the client's local date string (YYYY-MM-DD) when provided, because
 * employees in non-UTC timezones would otherwise get the wrong UTC-based date
 * (e.g. an employee in UTC+5 at midnight local sees the previous UTC day).
 */
function resolveAttendanceDate(localDate?: string): Date {
  if (localDate) {
    // Parse as UTC noon to avoid any DST/boundary edge cases when converting.
    const d = new Date(`${localDate}T12:00:00Z`);
    return toMidnightUTC(d);
  }
  return todayMidnightUTC();
}

function resolveEmployeeId(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'object' && '_id' in (raw as object)) {
    return String((raw as { _id: unknown })._id);
  }
  return String(raw);
}

export async function checkIn(
  employeeId: string,
  latitude: number,
  longitude: number,
  note?: string,
  localDate?: string,
) {
  const date = resolveAttendanceDate(localDate);

  const existing = await AttendanceModel.findOne({
    employeeId: new Types.ObjectId(employeeId),
    date,
    isTrashed: { $ne: true },
  }).exec();

  if (existing) {
    throw conflict('You have already checked in today.');
  }

  const record = await AttendanceModel.create({
    employeeId: new Types.ObjectId(employeeId),
    date,
    checkInTime: new Date(),
    checkInLatitude: latitude,
    checkInLongitude: longitude,
    note: note || undefined,
    createdBy: new Types.ObjectId(employeeId),
  });

  logActivityAsync({
    employeeId,
    module: 'attendance',
    entityId: String(record._id),
    action: 'created',
    meta: { event: 'check_in', date: date.toISOString().slice(0, 10) },
  });

  return record;
}

export async function checkOut(
  employeeId: string,
  latitude: number,
  longitude: number,
  note?: string,
  localDate?: string,
) {
  const date = resolveAttendanceDate(localDate);

  const record = await AttendanceModel.findOne({
    employeeId: new Types.ObjectId(employeeId),
    date,
    isTrashed: { $ne: true },
  }).exec();

  if (!record) {
    throw badRequest('You have not checked in today.');
  }

  if (record.checkOutTime) {
    throw conflict('You have already checked out today.');
  }

  record.checkOutTime = new Date();
  record.checkOutLatitude = latitude;
  record.checkOutLongitude = longitude;
  if (note !== undefined) record.note = note;
  await record.save();

  logActivityAsync({
    employeeId,
    module: 'attendance',
    entityId: String(record._id),
    action: 'updated',
    meta: { event: 'check_out', date: date.toISOString().slice(0, 10) },
  });

  return record;
}

export async function getTodayRecord(employeeId: string, localDate?: string) {
  const date = resolveAttendanceDate(localDate);
  const record = await AttendanceModel.findOne({
    employeeId: new Types.ObjectId(employeeId),
    date,
    isTrashed: { $ne: true },
  })
    .populate('employeeId', '-password')
    .exec();
  return record;
}

export async function findAll(filters?: {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.employeeId) {
    query.employeeId = new Types.ObjectId(filters.employeeId);
  }

  if (filters?.startDate || filters?.endDate) {
    const dateFilter: Record<string, Date> = {};
    if (filters.startDate) {
      dateFilter.$gte = toMidnightUTC(new Date(filters.startDate));
    }
    if (filters.endDate) {
      const end = toMidnightUTC(new Date(filters.endDate));
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }
    query.date = dateFilter;
  }

  return AttendanceModel.find(query)
    .populate('employeeId', '-password')
    .sort({ date: -1, createdAt: -1 })
    .exec();
}

export async function findById(id: string) {
  const record = await AttendanceModel.findOne({ _id: id, isTrashed: { $ne: true } })
    .populate('employeeId', '-password')
    .exec();

  if (!record) throw notFound('Attendance record not found');
  return record;
}

export async function adminCreate(
  data: {
    employeeId: string;
    date: Date;
    checkInTime: Date;
    checkInLatitude: number;
    checkInLongitude: number;
    checkOutTime?: Date;
    checkOutLatitude?: number;
    checkOutLongitude?: number;
    note?: string;
  },
  actorId: string,
) {
  const date = toMidnightUTC(new Date(data.date));

  const existing = await AttendanceModel.findOne({
    employeeId: new Types.ObjectId(data.employeeId),
    date,
    isTrashed: { $ne: true },
  }).exec();

  if (existing) {
    throw conflict('An attendance record already exists for this employee on that date.');
  }

  const record = await AttendanceModel.create({
    employeeId: new Types.ObjectId(data.employeeId),
    date,
    checkInTime: new Date(data.checkInTime),
    checkInLatitude: data.checkInLatitude,
    checkInLongitude: data.checkInLongitude,
    checkOutTime: data.checkOutTime ? new Date(data.checkOutTime) : undefined,
    checkOutLatitude: data.checkOutLatitude,
    checkOutLongitude: data.checkOutLongitude,
    note: data.note || undefined,
    createdBy: new Types.ObjectId(actorId),
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'attendance',
    entityId: String(record._id),
    action: 'created',
    meta: { createdFor: data.employeeId, date: date.toISOString().slice(0, 10) },
  });

  return record.populate('employeeId', '-password');
}

export async function update(
  id: string,
  data: Partial<{
    employeeId: string;
    date: Date;
    checkInTime: Date;
    checkInLatitude: number;
    checkInLongitude: number;
    checkOutTime: Date | null;
    checkOutLatitude: number | null;
    checkOutLongitude: number | null;
    note: string;
  }>,
  actorId: string,
  actorRole: string,
) {
  const record = await AttendanceModel.findOne({ _id: id, isTrashed: { $ne: true } }).exec();
  if (!record) throw notFound('Attendance record not found');

  if (actorRole !== 'admin') {
    const ownerId = resolveEmployeeId(record.employeeId);
    if (ownerId !== actorId) {
      throw forbidden('You can only update your own attendance record');
    }
  }

  if (data.employeeId !== undefined) {
    record.employeeId = new Types.ObjectId(data.employeeId);
  }
  if (data.date !== undefined) {
    record.date = toMidnightUTC(new Date(data.date));
  }
  if (data.checkInTime !== undefined) {
    record.checkInTime = new Date(data.checkInTime);
  }
  if (data.checkInLatitude !== undefined) {
    record.checkInLatitude = data.checkInLatitude;
  }
  if (data.checkInLongitude !== undefined) {
    record.checkInLongitude = data.checkInLongitude;
  }
  if (data.checkOutTime !== undefined) {
    record.checkOutTime = data.checkOutTime ? new Date(data.checkOutTime) : undefined;
  }
  if (data.checkOutLatitude !== undefined) {
    record.checkOutLatitude = data.checkOutLatitude ?? undefined;
  }
  if (data.checkOutLongitude !== undefined) {
    record.checkOutLongitude = data.checkOutLongitude ?? undefined;
  }
  if (data.note !== undefined) {
    record.note = data.note ?? undefined;
  }

  await record.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'attendance',
    entityId: String(record._id),
    action: 'updated',
  });

  return record.populate('employeeId', '-password');
}

export async function remove(id: string, actorId: string) {
  const record = await AttendanceModel.findOne({ _id: id, isTrashed: { $ne: true } }).exec();
  if (!record) throw notFound('Attendance record not found');

  record.isTrashed = true;
  record.trashedAt = new Date();
  record.trashedBy = new Types.ObjectId(actorId);
  await record.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'attendance',
    entityId: id,
    action: 'updated',
    changes: { isTrashed: { from: false, to: true } },
  });

  return { message: 'Attendance record moved to trash successfully' };
}

export async function restore(id: string, actorId: string) {
  let record = await AttendanceModel.findOne({ _id: id, isTrashed: true }).exec();
  if (!record) {
    record = await AttendanceModel.findById(id).exec();
  }
  if (!record) throw notFound('Attendance record not found');

  record.isTrashed = false;
  record.trashedAt = undefined;
  record.trashedBy = undefined;
  await record.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'attendance',
    entityId: id,
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
  });

  return record;
}

export async function permanentDelete(id: string, actorId: string) {
  const record = await AttendanceModel.findOne({ _id: id, isTrashed: true }).exec();
  if (!record) throw notFound('Attendance record not found in trash');

  await AttendanceModel.findByIdAndDelete(id);

  logActivityAsync({
    employeeId: actorId,
    module: 'attendance',
    entityId: id,
    action: 'deleted',
    meta: { permanent: true },
  });

  return { message: 'Attendance record permanently deleted' };
}
