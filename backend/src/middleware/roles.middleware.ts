import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../utils/app-error';

export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      return next(forbidden('Not authenticated'));
    }

    if (!roles.includes(user.role)) {
      return next(forbidden('Insufficient permissions'));
    }

    next();
  };
}
