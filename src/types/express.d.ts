import type { PublicUser } from '../lib/publicUser.js';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export {};
