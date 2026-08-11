import { Request, Response, NextFunction } from 'express';
import * as regionSalesService from './region-sales.service';

export async function regions(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, from, to } = req.query as Record<string, string>;
    const report = await regionSalesService.getRegionTotals(
      { date, from, to },
      req.user!.userId,
      req.user!.role,
    );
    res.json(report);
  } catch (err) {
    next(err);
  }
}

export async function regionSalesmen(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, from, to } = req.query as Record<string, string>;
    // The Unassigned bucket has an empty key, so the route uses a literal placeholder
    // ("unassigned") that would otherwise be an empty path segment.
    const raw = req.params.regionKey ?? '';
    const regionKey = raw.toLowerCase() === 'unassigned' ? '' : decodeURIComponent(raw);

    const report = await regionSalesService.getRegionSalesmen(
      { date, from, to },
      regionKey,
      req.user!.userId,
      req.user!.role,
    );
    res.json(report);
  } catch (err) {
    next(err);
  }
}

export async function salesmanDaily(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as Record<string, string>;
    const report = await regionSalesService.getSalesmanDaily(
      req.params.employeeId,
      from,
      to,
      req.user!.userId,
      req.user!.role,
    );
    res.json(report);
  } catch (err) {
    next(err);
  }
}
