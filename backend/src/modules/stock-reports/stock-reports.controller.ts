import { Request, Response, NextFunction } from 'express';
import * as stockReportsService from './stock-reports.service';

function parseFilters(query: Record<string, string>) {
  return {
    startDate: query.startDate || undefined,
    endDate: query.endDate || undefined,
    categoryId: query.categoryId || undefined,
    search: query.search || undefined,
  };
}

export async function getCurrentStock(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await stockReportsService.getCurrentStockReport(
      parseFilters(req.query as Record<string, string>),
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getHoldStock(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await stockReportsService.getHoldStockReport(
      parseFilters(req.query as Record<string, string>),
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getDamageStock(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await stockReportsService.getDamageStockReport(
      parseFilters(req.query as Record<string, string>),
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getProfitLoss(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await stockReportsService.getProfitLossReport(
      parseFilters(req.query as Record<string, string>),
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getLowStock(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await stockReportsService.getLowStockReport(
      parseFilters(req.query as Record<string, string>),
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}
