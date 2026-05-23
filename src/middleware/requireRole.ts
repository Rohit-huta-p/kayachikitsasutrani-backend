import type { Request, Response, NextFunction } from 'express';

export function requireRole(role: 'student' | 'admin') {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
      return;
    }
    next();
  };
}
