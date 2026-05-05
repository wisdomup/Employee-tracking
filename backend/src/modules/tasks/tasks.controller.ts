import { Request, Response, NextFunction } from 'express';
import { saveFile } from '../../services/file-upload.service';
import * as tasksService from './tasks.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as Record<string, unknown>;
    const payload: Record<string, unknown> = {
      taskName: body.taskName,
      description: body.description,
      referenceImage: body.referenceImage,
      employeeNotes: body.employeeNotes,
      quantity: body.quantity != null ? Number(body.quantity) : undefined,
      dealerId: body.dealerId || undefined,
      routeId: body.routeId || undefined,
    };
    if (req.file) {
      payload.document = await saveFile(req.file, 'task-documents');
    }
    const task = await tasksService.createTask(payload as any, req.user!.userId);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, routeId, status, assignedTo } = req.query as Record<string, string>;
    const tasks = await tasksService.findAll({ dealerId, routeId, status, assignedTo });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await tasksService.findById(req.params.id);
    res.json(task);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as Record<string, unknown>;
    const payload: Record<string, unknown> = {
      taskName: body.taskName,
      description: body.description,
      referenceImage: body.referenceImage,
      employeeNotes: body.employeeNotes,
      quantity: body.quantity != null ? Number(body.quantity) : undefined,
      dealerId: body.dealerId !== undefined ? (body.dealerId || null) : undefined,
      routeId: body.routeId !== undefined ? (body.routeId || null) : undefined,
    };
    if (req.file) {
      payload.document = await saveFile(req.file, 'task-documents');
    }
    const task = await tasksService.updateTask(req.params.id, payload as any);
    res.json(task);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tasksService.deleteTask(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function assignTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await tasksService.assignTask(
      req.params.id,
      req.body.assignedTo,
      req.user!.userId,
    );
    res.json(task);
  } catch (err) {
    next(err);
  }
}

export async function startTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await tasksService.startTask(
      req.params.id,
      req.body,
      req.user!.userId,
      req.user!.role,
    );
    res.json(task);
  } catch (err) {
    next(err);
  }
}

export async function completeTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await tasksService.completeTask(
      req.params.id,
      req.body,
      req.user!.userId,
      req.user!.role,
    );
    res.json(task);
  } catch (err) {
    next(err);
  }
}
