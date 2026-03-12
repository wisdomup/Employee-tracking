import { Request, Response, NextFunction } from 'express';
import * as routeAssignmentsService from './route-assignments.service';

export async function assignRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await routeAssignmentsService.assignRouteToEmployee(
      req.body.routeId,
      req.body.employeeId,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function findAll(_req: Request, res: Response, next: NextFunction) {
  try {
    const assignments = await routeAssignmentsService.findAll();
    res.json(assignments);
  } catch (err) {
    next(err);
  }
}

export async function findByRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const assignment = await routeAssignmentsService.findByRoute(req.params.routeId);
    res.json(assignment);
  } catch (err) {
    next(err);
  }
}

export async function findByEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const assignments = await routeAssignmentsService.findByEmployee(req.params.employeeId);
    res.json(assignments);
  } catch (err) {
    next(err);
  }
}

export async function unassignRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await routeAssignmentsService.unassignRoute(req.params.routeId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
