import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export function validate(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      res.status(400).json({
        message: 'Validation error',
        errors: error.details.map((d) => d.message),
      });
      return;
    }

    req.body = value;
    next();
  };
}
