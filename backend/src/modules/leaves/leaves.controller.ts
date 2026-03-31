import { Request, Response, NextFunction } from 'express';
import * as leavesService from './leaves.service';
import { forbidden } from '../../utils/app-error';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await leavesService.createLeave(req.body, req.user!.userId);
    res.status(201).json(leave);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { employeeId, status } = req.query as Record<string, string>;
    let effectiveEmployeeId = employeeId;
    if (req.user?.role === 'order_taker') {
      effectiveEmployeeId = req.user.userId;
    }
    const leaves = await leavesService.findAll({ employeeId: effectiveEmployeeId, status });
    res.json(leaves);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await leavesService.findById(req.params.id);
    if (req.user?.role === 'order_taker' && req.user.userId) {
      const e = (leave as { employeeId?: unknown }).employeeId;
      const ownerId =
        e && typeof e === 'object' && e !== null && '_id' in e
          ? String((e as { _id: unknown })._id)
          : String(e ?? '');
      if (ownerId !== req.user.userId) {
        return next(forbidden('You can only view your own leave requests'));
      }
    }
    res.json(leave);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const isAdmin = req.user!.role === 'admin';
    const leave = await leavesService.updateLeave(req.params.id, req.body, {
      isAdmin,
      userId: req.user!.userId,
    });
    res.json(leave);
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await leavesService.updateLeaveStatus(
      req.params.id,
      req.body.status,
      req.user!.userId,
    );
    res.json(leave);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const isAdmin = req.user!.role === 'admin';
    const result = await leavesService.deleteLeave(req.params.id, {
      isAdmin,
      userId: req.user!.userId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
