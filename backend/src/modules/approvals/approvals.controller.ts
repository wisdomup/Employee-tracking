import { Request, Response, NextFunction } from 'express';
import * as approvalsService from './approvals.service';
import { forbidden } from '../../utils/app-error';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await approvalsService.createApproval(req.body, req.user!.userId);
    res.status(201).json(approval);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { employeeId, status, approvalType } = req.query as Record<string, string>;
    let effectiveEmployeeId = employeeId;
    if (req.user?.role === 'order_taker') {
      effectiveEmployeeId = req.user.userId;
    }
    const approvals = await approvalsService.findAll({
      employeeId: effectiveEmployeeId,
      status,
      approvalType,
    });
    res.json(approvals);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await approvalsService.findById(req.params.id);
    if (req.user?.role === 'order_taker' && req.user.userId) {
      const e = (approval as { employeeId?: unknown }).employeeId;
      const ownerId =
        e && typeof e === 'object' && e !== null && '_id' in e
          ? String((e as { _id: unknown })._id)
          : String(e ?? '');
      if (ownerId !== req.user.userId) {
        return next(forbidden('You can only view your own approvals'));
      }
    }
    res.json(approval);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const isAdmin = req.user!.role === 'admin';
    const approval = await approvalsService.updateApproval(req.params.id, req.body, {
      isAdmin,
      userId: req.user!.userId,
    });
    res.json(approval);
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const approval = await approvalsService.updateApprovalStatus(
      req.params.id,
      req.body.status,
      req.user!.userId,
    );
    res.json(approval);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const isAdmin = req.user!.role === 'admin';
    const result = await approvalsService.deleteApproval(req.params.id, {
      isAdmin,
      userId: req.user!.userId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
