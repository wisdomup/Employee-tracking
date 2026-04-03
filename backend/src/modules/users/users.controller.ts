import { Request, Response, NextFunction } from 'express';
import * as usersService from './users.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.createUser(req.body, req.user?.userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { role, isActive } = req.query as Record<string, string>;
    const filters: { role?: string; isActive?: boolean } = {};

    if (role) filters.role = role;
    if (isActive !== undefined) filters.isActive = isActive === 'true';

    const users = await usersService.findAll(filters);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

export async function findByRole(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await usersService.findByRole(req.params.role);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await usersService.findById(req.params.id);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await usersService.findById(req.user!.userId);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await usersService.updateProfile(req.user!.userId, req.body, req.user?.userId);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await usersService.updateUser(req.params.id, req.body, req.user?.userId);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.deleteUser(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.restoreUser(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.permanentlyDeleteUser(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
