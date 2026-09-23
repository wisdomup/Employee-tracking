import { Request, Response, NextFunction } from 'express';
import { badRequest } from '../../utils/app-error';
import { trailQuerySchema } from './dto/trail.schemas';
import { resolveTrail, TrailRef } from './trail.service';

export async function trail(req: Request, res: Response, next: NextFunction) {
  try {
    const { error, value } = trailQuerySchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: false,
    });
    if (error) {
      throw badRequest(error.details.map((d) => d.message).join('; '));
    }
    res.json(await resolveTrail(value as TrailRef));
  } catch (err) {
    next(err);
  }
}
