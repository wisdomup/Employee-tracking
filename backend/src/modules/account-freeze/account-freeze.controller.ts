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

/** The admin banner's numbers: who is frozen, what today's freezes cost, what is still owed. */
export async function fineOverview(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getFineOverview());
  } catch (err) {
    next(err);
  }
}

/** One rider's fine history — the answer to a disputed fine. */
export async function riderFines(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit);
    res.json(await service.listRiderFines(req.params.id, Number.isFinite(limit) ? limit : 50));
  } catch (err) {
    next(err);
  }
}

/**
 * Sets this rider's own late-start fine, or clears it back to the company default.
 *
 * `amount: null` (or an empty body) clears the override. `0` is accepted and means "freeze
 * this rider but do not fine them" — a real setting, not a missing one, which is why it
 * cannot be treated as absent here.
 */
export async function setFineAmount(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.body?.amount;
    const amount = raw === null || raw === undefined || raw === '' ? null : raw;
    const result = await service.setRiderFineAmount(
      req.params.id,
      amount as number | null,
      req.user!.userId,
    );
    res.json({
      message:
        amount === null
          ? 'Fine amount reset to the company default'
          : 'Fine amount updated',
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

/** Cancels a fine without touching the freeze — the two are separate decisions. */
export async function waiveFine(req: Request, res: Response, next: NextFunction) {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : undefined;
    const fine = await service.waiveFine(req.params.fineId, req.user!.userId, note || undefined);
    res.json({ message: 'Fine waived', fine });
  } catch (err) {
    next(err);
  }
}
