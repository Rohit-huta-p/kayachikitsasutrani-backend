import type { Request, Response, NextFunction } from 'express';
import { verifySession } from '../lib/jwt';
import { SESSION_COOKIE_NAME } from '../lib/cookies';
import { User } from '../models/User';
import { toPublicUser } from '../lib/publicUser';
import { env } from '../env';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } });
    return;
  }
  try {
    const payload = verifySession(token, env().JWT_SECRET);
    const doc = await User.findById(payload.sub);
    if (!doc) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Session invalid' } });
      return;
    }
    req.user = toPublicUser(doc);
    next();
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Session invalid' } });
  }
}
