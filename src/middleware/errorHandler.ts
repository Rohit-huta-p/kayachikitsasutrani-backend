import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
    });
    return;
  }
  console.error('[error]', err);
  const message = err instanceof Error ? err.message : 'Something went wrong';
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      // Stack only when explicitly enabled — set DEBUG_ERRORS=1 in env.
      ...(process.env.DEBUG_ERRORS === '1' && err instanceof Error ? { stack: err.stack } : {}),
    },
  });
}
