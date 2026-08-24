import { Request, Response, NextFunction } from 'express';
import * as service from './permissions.service';
import { describeAccessForClient } from '../../services/access-control.service';

export async function catalogue(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(service.getCatalogue());
  } catch (err) {
    next(err);
  }
}

/**
 * What the signed-in user may do. Polled by the admin panel on load and after login, and the
 * single source the frontend `can()` reads — the hardcoded per-role Sets it used to consult
 * are gone.
 *
 * Deliberately not gated by a permission: everyone is allowed to ask what they themselves can
 * do, and gating it would make the answer unreachable for the users who most need it.
 */
export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await describeAccessForClient(req.user));
  } catch (err) {
    next(err);
  }
}

export async function getRolePolicy(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getPolicy('role', req.params.role));
  } catch (err) {
    next(err);
  }
}

export async function saveRolePolicy(req: Request, res: Response, next: NextFunction) {
  try {
    const saved = await service.savePolicy(
      'role',
      req.params.role,
      { permissions: req.body.permissions ?? [], reports: req.body.reports ?? [] },
      req.user?.userId,
    );
    res.json(saved);
  } catch (err) {
    next(err);
  }
}

export async function getProfilePolicy(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getPolicy('profile', req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function saveProfilePolicy(req: Request, res: Response, next: NextFunction) {
  try {
    const saved = await service.savePolicy(
      'profile',
      req.params.id,
      { permissions: req.body.permissions ?? [], reports: req.body.reports ?? [] },
      req.user?.userId,
    );
    res.json(saved);
  } catch (err) {
    next(err);
  }
}

export async function listProfiles(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ profiles: await service.listProfiles() });
  } catch (err) {
    next(err);
  }
}

export async function createProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const created = await service.createProfile(
      { name: req.body.name, description: req.body.description, roles: req.body.roles ?? [] },
      req.user?.userId,
    );
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

export async function setProfileActive(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.setProfileActive(req.params.id, req.body.isActive === true));
  } catch (err) {
    next(err);
  }
}

export async function deleteProfile(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.deleteProfile(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function uncovered(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ combinations: await service.findUncoveredCombinations() });
  } catch (err) {
    next(err);
  }
}

export async function setUserRoles(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.setUserRoles(req.params.userId, req.body.roles ?? []));
  } catch (err) {
    next(err);
  }
}

export async function getUserAccess(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getUserAccessDetail(req.params.userId));
  } catch (err) {
    next(err);
  }
}

export async function saveUserPolicy(req: Request, res: Response, next: NextFunction) {
  try {
    const saved = await service.savePolicy(
      'user',
      req.params.userId,
      { permissions: req.body.permissions ?? [], reports: req.body.reports ?? [] },
      req.user?.userId,
    );
    res.json(saved);
  } catch (err) {
    next(err);
  }
}

export async function clearUserPolicy(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.clearUserPolicy(req.params.userId));
  } catch (err) {
    next(err);
  }
}

export async function overriddenUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ userIds: await service.listOverriddenUserIds() });
  } catch (err) {
    next(err);
  }
}
