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
    const { broadcastTo } = req.query as Record<string, string>;
    const notifications = await notificationsService.findAll({ broadcastTo });
    res.json(notifications);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const notification = await notificationsService.findById(req.params.id);
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
