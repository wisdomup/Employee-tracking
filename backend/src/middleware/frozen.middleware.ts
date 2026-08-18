import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../utils/app-error';

/**
 * Refuses write requests from a frozen account.
 *
 * Mounted on the routers a field rider records work through (visits, orders, returns,
 * dealers, approvals, collections). Reads are deliberately left open — a frozen rider
 * must still be able to open the app, see their day and read the banner explaining why
 * they are locked out. Blocking GETs too would leave them staring at an error screen
 * with no way to learn what happened.
 *
 * 403 rather than 401 on purpose: 401 makes the admin app's axios interceptor log the
 * user straight out, which is precisely the "can still sign in and see why" behaviour
 * this feature is built around.
 */
export function blockFrozenWrites(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  if (req.user?.isFrozen) {
    return next(
      forbidden(
        req.user.frozenReason ||
          'Your account is frozen. Please contact the admin to have it unfrozen.',
      ),
    );
  }

  next();
}
