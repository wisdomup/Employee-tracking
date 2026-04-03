import { Request, Response, NextFunction } from 'express';
import * as notificationsService from './broadcast-notifications.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const notification = await notificationsService.createNotification(req.body, req.user!.userId);
    res.status(201).json(notification);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { audienceType } = req.query as Record<string, string>;
    const notifications = await notificationsService.findAll({ audienceType });
    res.json(notifications);
  } catch (err) {
    next(err);
  }
}

export async function inbox(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, role } = req.user!;
    const result = await notificationsService.findInboxForUser(userId, role);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, role } = req.user!;
    const result = await notificationsService.markAsRead(req.params.id, userId, role);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const isAdmin = req.user!.role === 'admin';
    const notification = await notificationsService.findByIdForViewer(req.params.id, {
      userId: req.user!.userId,
      role: req.user!.role,
      isAdmin,
    });
    res.json(notification);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const notification = await notificationsService.updateNotification(req.params.id, req.body);
    res.json(notification);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationsService.deleteNotification(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
