import { Request, Response, NextFunction } from 'express';
import * as flagsService from './performance-flags.service';
import { resolveVisibleEmployeeIds } from '../users/users.service';

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { employeeId, type, resolved, startDate, endDate } = req.query as Record<string, string>;
    const visibleEmployeeIds = await resolveVisibleEmployeeIds(
      req.user!.userId,
      req.user!.role,
    );
    const flags = await flagsService.findFlags({
      employeeId,
      type,
      // Absent = both; explicit 'true'/'false' filters.
      resolved: resolved === undefined ? undefined : resolved === 'true',
      startDate,
      endDate,
      visibleEmployeeIds,
    });
    res.json(flags);
  } catch (err) {
    next(err);
  }
}

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    const visibleEmployeeIds = await resolveVisibleEmployeeIds(
      req.user!.userId,
      req.user!.role,
    );
    res.json(await flagsService.countOpenFlags(visibleEmployeeIds));
  } catch (err) {
    next(err);
  }
}

export async function resolve(req: Request, res: Response, next: NextFunction) {
  try {
    const flag = await flagsService.resolveFlag(req.params.id, req.user!.userId);
    res.json(flag);
  } catch (err) {
    next(err);
  }
}
