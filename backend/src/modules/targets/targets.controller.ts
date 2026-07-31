import { Request, Response, NextFunction } from 'express';
import * as targetsService from './targets.service';
import { resolveVisibleEmployeeIds } from '../users/users.service';

export async function upsert(req: Request, res: Response, next: NextFunction) {
  try {
    const target = await targetsService.upsertTarget(
      req.body,
      req.user!.userId,
      req.user!.role,
    );
    res.json(target);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { employeeId, periodMonth } = req.query as Record<string, string>;
    // Restrict to what this viewer may see: admin = all, manager = own team, else self.
    const employeeIds = await resolveVisibleEmployeeIds(req.user!.userId, req.user!.role);
    const targets = await targetsService.findTargets({ employeeId, periodMonth, employeeIds });
    res.json(targets);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await targetsService.deleteTarget(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
