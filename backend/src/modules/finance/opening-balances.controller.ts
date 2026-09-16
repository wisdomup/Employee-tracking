import { Request, Response, NextFunction } from 'express';
import * as opening from './opening-balances.service';

export async function status(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await opening.migrationStatus());
  } catch (err) {
    next(err);
  }
}

export async function worksheet(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await opening.worksheet());
  } catch (err) {
    next(err);
  }
}

export async function save(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await opening.saveWorksheet(req.body.entries, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function post(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await opening.postOpeningEntry(
        { cutoverDate: req.body.cutoverDate, narration: req.body.narration },
        req.user!.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function closeEquity(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await opening.closeOpeningEquity(req.body.toLedgerId, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function reopen(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await opening.reopenMigration(req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}
