import { Request, Response, NextFunction } from 'express';
import * as rates from './tax-rates.service';
import { TaxRateKind } from '../../models/tax-rate.model';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await rates.listTaxRates({
        kind: q.kind as TaxRateKind | undefined,
        status: q.status as 'active' | 'inactive' | 'all' | undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await rates.createTaxRate(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await rates.updateTaxRate(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function setStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await rates.updateTaxRate(req.params.id, { isActive: req.body.isActive }, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await rates.deleteTaxRate(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}
