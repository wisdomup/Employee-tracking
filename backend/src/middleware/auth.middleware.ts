import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model';
import { unauthorized } from '../utils/app-error';

export interface AuthUser {
  userId: string;
  username: string;
  /** Primary role. Always `roles[0]`; kept for the many queries that still read it. */
  role: string;
  /**
   * Every role held, primary first. Read by the permission resolver to decide between a
   * single-role policy and a multi-role profile.
   *
   * Resolved per-request from the database alongside `role`, not from the JWT, for the same
   * reason `isFrozen` is: an admin changing someone's roles must take effect on their next
   * call, not whenever their 24h token happens to expire.
   */
  roles: string[];
  /** Warehouse the caller is attached to, if any. Drives warehouse-module row-level scoping. */
  warehouseId?: string;
  /**
   * True while the account is frozen for a late start. Read by `blockFrozenWrites`, which
   * refuses writes in the field modules. Resolved per-request from the database rather
   * than the JWT, so an admin's unfreeze takes effect on the rider's very next call
   * instead of when their 24h token expires.
   */
  isFrozen?: boolean;
  frozenReason?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Missing or invalid authorization header'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET || 'default_secret';
    const payload = jwt.verify(token, secret) as Record<string, unknown>;

    const rawSub = payload.sub;
    const userId =
      typeof rawSub === 'string'
        ? rawSub
        : rawSub && typeof rawSub === 'object' && rawSub !== null && '$oid' in rawSub
          ? String((rawSub as { $oid: string }).$oid)
          : String(rawSub ?? '');

    if (!userId) {
      return next(unauthorized('Invalid token subject'));
    }

    const currentUser = await UserModel.findOne({
      _id: userId,
      isTrashed: { $ne: true },
    })
      .select('_id username role roles isActive warehouseId isFrozen frozenReason')
      .lean()
      .exec();

    if (!currentUser || currentUser.isActive !== true) {
      return next(unauthorized('User account is inactive'));
    }

    // Accounts written before the multi-role migration have no `roles` array. Reading the
    // primary role as a one-element list keeps them resolving normally rather than as a user
    // with no roles at all, which would deny them everything.
    const roles =
      Array.isArray(currentUser.roles) && currentUser.roles.length > 0
        ? currentUser.roles
        : [currentUser.role];

    req.user = {
      userId: String(currentUser._id),
      username: currentUser.username,
      role: currentUser.role,
      roles,
      ...(currentUser.warehouseId ? { warehouseId: String(currentUser.warehouseId) } : {}),
      ...(currentUser.isFrozen === true
        ? { isFrozen: true, ...(currentUser.frozenReason ? { frozenReason: currentUser.frozenReason } : {}) }
        : {}),
    };

    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}
