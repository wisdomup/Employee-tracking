import { Request, Response, NextFunction } from 'express';
import * as attendanceService from './attendance.service';
import { forbidden } from '../../utils/app-error';

function resolveEmployeeId(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'object' && '_id' in (raw as object)) {
    return String((raw as { _id: unknown })._id);
  }
  return String(raw);
}

export async function checkIn(req: Request, res: Response, next: NextFunction) {
  try {
    const { latitude, longitude, note, localDate } = req.body;
    const record = await attendanceService.checkIn(
      req.user!.userId,
      latitude,
      longitude,
      note,
      localDate,
    );
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function checkOut(req: Request, res: Response, next: NextFunction) {
  try {
    const { latitude, longitude, note, localDate } = req.body;
    const record = await attendanceService.checkOut(
      req.user!.userId,
      latitude,
      longitude,
      note,
      localDate,
    );
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function getToday(req: Request, res: Response, next: NextFunction) {
  try {
    const localDate = (req.query as Record<string, string>).date;
    const record = await attendanceService.getTodayRecord(req.user!.userId, localDate);
    res.json(record ?? null);
  } catch (err) {
    next(err);
  }
}

export async function adminCreate(req: Request, res: Response, next: NextFunction) {
  try {
    const record = await attendanceService.adminCreate(req.body, req.user!.userId);
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { employeeId, startDate, endDate } = req.query as Record<string, string>;
    const isAdmin = req.user!.role === 'admin';
    const effectiveEmployeeId = isAdmin ? employeeId : req.user!.userId;

    const records = await attendanceService.findAll({
      employeeId: effectiveEmployeeId,
      startDate,
      endDate,
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const record = await attendanceService.findById(req.params.id);
    if (req.user!.role !== 'admin') {
      const ownerId = resolveEmployeeId(record.employeeId);
      if (ownerId !== req.user!.userId) {
        return next(forbidden('You can only view your own attendance records'));
      }
    }
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const isAdmin = req.user!.role === 'admin';
    const data = isAdmin ? req.body : { note: req.body.note };
    const record = await attendanceService.update(
      req.params.id,
      data,
      req.user!.userId,
      req.user!.role,
    );
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await attendanceService.remove(req.params.id, req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restoreRecord(req: Request, res: Response, next: NextFunction) {
  try {
    const record = await attendanceService.restore(req.params.id, req.user!.userId);
    res.json(record);
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await attendanceService.permanentDelete(req.params.id, req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
