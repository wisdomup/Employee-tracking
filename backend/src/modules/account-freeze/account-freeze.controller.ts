import { Request, Response, NextFunction } from 'express';
import * as service from './account-freeze.service';

/** The caller's own freeze state — what the rider app renders its banner from. */
export async function myStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getFreezeStatus(req.user!.userId));
  } catch (err) {
    next(err);
  }
}

/** The admin queue of everyone currently frozen. */
export async function findFrozen(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.findFrozenUsers());
  } catch (err) {
    next(err);
  }
}

export async function unfreeze(req: Request, res: Response, next: NextFunction) {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : undefined;
    const user = await service.unfreezeUser(req.params.id, req.user!.userId, note || undefined);
    res.json({ message: 'Account unfrozen', user });
  } catch (err) {
    next(err);
  }
}

/**
 * Runs the late-start sweep on demand. The cron does this automatically; the endpoint
 * exists so an admin can re-run it after a server outage over the deadline, and so the
 * behaviour is testable without waiting for a wall-clock time.
 */
export async function runSweep(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.sweepLateStarters());
  } catch (err) {
    next(err);
  }
}
