import { Request, Response, NextFunction } from 'express';
import * as activityLogsService from './activity-logs.service';

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { employeeId, module, action, startDate, endDate, limit } = req.query as Record<string, string>;
    const limitNum = limit ? parseInt(limit, 10) : 100;
    const logs = await activityLogsService.findAll({
      employeeId,
      module,
      action,
      startDate,
      endDate,
      limit: limitNum,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
}

export async function getRecent(req: Request, res: Response, next: NextFunction) {
  try {
    const { limit } = req.query as Record<string, string>;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const logs = await activityLogsService.getRecentActivity(limitNum);
    res.json(logs);
  } catch (err) {
    next(err);
  }
}

export async function findByEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const { startDate, endDate } = req.query as Record<string, string>;
    const logs = await activityLogsService.findByEmployee(req.params.id, { startDate, endDate });
    res.json(logs);
  } catch (err) {
    next(err);
  }
}
