import { Request, Response, NextFunction } from 'express';
import * as visitsService from './visits.service';
import { resolveVisibleEmployeeIds } from '../users/users.service';
import { badRequest } from '../../utils/app-error';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.createVisit(req.body, req.user?.userId);
    res.status(201).json(visit);
  } catch (err) {
    next(err);
  }
}

export async function bulkCreate(req: Request, res: Response, next: NextFunction) {
  try {
    const visits = await visitsService.bulkCreateVisits(req.body, req.user?.userId);
    res.status(201).json(visits);
  } catch (err) {
    next(err);
  }
}

export async function createForRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const { routeId } = req.body as { routeId: string };
    const result = await visitsService.createVisitsForRoute(routeId, req.user?.userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, employeeId, routeId, status, startDate, endDate, overstayFlagged } =
      req.query as Record<string, string>;
    // Admin sees everything; a sales manager their own team; everyone else only their
    // own visits. Without this, omitting `employeeId` would return every visit.
    const visibleEmployeeIds = await resolveVisibleEmployeeIds(
      req.user!.userId,
      req.user!.role,
    );
    const visits = await visitsService.findAll({
      dealerId,
      employeeId,
      routeId,
      status,
      startDate,
      endDate,
      overstayFlagged: overstayFlagged === 'true',
      visibleEmployeeIds,
    });
    res.json(visits);
  } catch (err) {
    next(err);
  }
}

export async function dealerGallery(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId } = req.query as Record<string, string>;
    if (!dealerId) {
      return next(badRequest('dealerId is required'));
    }
    const entries = await visitsService.findDealerGallery(dealerId);
    res.json(entries);
  } catch (err) {
    next(err);
  }
}

export async function previewSkip(req: Request, res: Response, next: NextFunction) {
  try {
    const preview = await visitsService.previewSkipVisit(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    res.json(preview);
  } catch (err) {
    next(err);
  }
}

export async function skipVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await visitsService.skipVisit(
      req.params.id,
      req.body as { reason?: string; confirm?: boolean },
      req.user!.userId,
      req.user!.role,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateGallery(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.updateVisitGallery(
      req.params.id,
      req.body as { galleryImages?: { url: string; caption?: string }[]; visitNotes?: string },
      req.user!.userId,
      req.user!.role,
    );
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

export async function completeVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.completeVisit(
      req.params.id,
      req.body as { latitude: number; longitude: number; completionImages: { type: 'shop' | 'selfie'; url: string }[] },
      req.user!.userId,
      req.user!.role,
    );
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

export async function checkInVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.checkInVisit(
      req.params.id,
      req.body as { latitude: number; longitude: number },
      req.user!.userId,
      req.user!.role,
    );
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const visibleEmployeeIds = await resolveVisibleEmployeeIds(
      req.user!.userId,
      req.user!.role,
    );
    const visit = await visitsService.findById(req.params.id, visibleEmployeeIds);
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

const STATUS_ONLY_ROLES = ['order_taker', 'warehouse_manager', 'delivery_man'];

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user?.role && STATUS_ONLY_ROLES.includes(req.user.role)) {
      // Riders may only mark a visit as in progress here. Checking in and completing
      // must go through the dedicated, location-verified endpoints (/check-in, /complete)
      // so a rider can never skip the geofenced check-in step.
      const allowedStatuses = ['in_progress'];
      const { status, ...rest } = req.body;
      if (Object.keys(rest).length > 0) {
        return next(badRequest('You can only update the visit status'));
      }
      if (!status || !allowedStatuses.includes(status)) {
        return next(
          badRequest(
            'You can only set status to: in_progress. ' +
              'Use check-in to arrive at the store and complete to finish the visit.',
          ),
        );
      }
      req.body = { status };
    }
    const visit = await visitsService.updateVisit(req.params.id, req.body, req.user?.userId);
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await visitsService.deleteVisit(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await visitsService.restoreVisit(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await visitsService.permanentlyDeleteVisit(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
