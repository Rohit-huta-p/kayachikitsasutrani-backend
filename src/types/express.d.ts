import type { PublicUser } from '../lib/publicUser';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export {};
