import { Request, Response, NextFunction } from 'express';
import * as leavesService from './leaves.service';

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
    const leaves = await leavesService.findAll({ employeeId, status });
    res.json(leaves);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await leavesService.findById(req.params.id);
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
    const result = await leavesService.deleteLeave(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
