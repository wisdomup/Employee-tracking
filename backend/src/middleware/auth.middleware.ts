import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { unauthorized } from '../utils/app-error';

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Missing or invalid authorization header'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET || 'default_secret';
    const payload = jwt.verify(token, secret) as any;

    req.user = {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
    };

    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}
