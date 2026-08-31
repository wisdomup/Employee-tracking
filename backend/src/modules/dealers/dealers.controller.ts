import { Request, Response, NextFunction } from 'express';
import * as dealersService from './dealers.service';
import { resolveCityScope } from '../users/users.service';
import { badRequest } from '../../utils/app-error';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const dealer = await dealersService.createDealer(req.body, req.user?.userId);
    res.status(201).json(dealer);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, search, routeId, fields } = req.query as Record<string, string>;
    // Riders only see clients in their own city; office roles see everything.
    const cityScope = await resolveCityScope(req.user!.userId, req.user!.role);
    const dealers = await dealersService.findAll({
      status,
      search,
      routeId,
      cityScope,
      // `?fields=options` asks for the picker-sized payload. Scope still applies.
      slim: fields === 'options',
    });
    res.json(dealers);
  } catch (err) {
    next(err);
  }
}

export async function findNearby(req: Request, res: Response, next: NextFunction) {
  try {
    const { lat, lng, radius } = req.query as Record<string, string>;

    if (!lat || !lng || !radius) {
      return next(badRequest('lat, lng and radius query params are required'));
    }

    const cityScope = await resolveCityScope(req.user!.userId, req.user!.role);
    const dealers = await dealersService.findByLocation(
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radius),
      cityScope,
    );
    res.json(dealers);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const cityScope = await resolveCityScope(req.user!.userId, req.user!.role);
    const dealer = await dealersService.findById(req.params.id, cityScope);
    res.json(dealer);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const dealer = await dealersService.updateDealer(req.params.id, req.body, req.user?.userId);
    res.json(dealer);
  } catch (err) {
    next(err);
  }
}

export async function updateLocation(req: Request, res: Response, next: NextFunction) {
  try {
    // Same scope as the read path — a rider may only correct a client they can already see.
    const cityScope = await resolveCityScope(req.user!.userId, req.user!.role);
    const dealer = await dealersService.updateDealerLocation(
      req.params.id,
      req.body,
      req.user?.userId,
      cityScope,
    );
    res.json(dealer);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await dealersService.deleteDealer(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await dealersService.restoreDealer(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await dealersService.permanentlyDeleteDealer(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
