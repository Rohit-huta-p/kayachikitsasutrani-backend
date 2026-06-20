import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';

/**
 * Express middleware that validates a route parameter as a valid MongoDB ObjectId.
 *
 * Returns a 404 with the standard error envelope when the value is not a valid
 * ObjectId, preventing the handler from running a pointless DB lookup.
 *
 * @param paramName  Route param to validate (default `"id"`).
 * @param label      Human-readable label for the error message (default `"Resource"`).
 */
export function validateObjectId(paramName = 'id', label = 'Resource') {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!Types.ObjectId.isValid(req.params[paramName])) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `${label} not found` } });
      return;
    }
    next();
  };
}
