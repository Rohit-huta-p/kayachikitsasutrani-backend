import jwt from 'jsonwebtoken';

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

const EXPIRES_IN = '7d';

export function signSession(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn: EXPIRES_IN });
}

export function verifySession(token: string, secret: string): SessionPayload {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.sub !== 'string') {
    throw new Error('Invalid session payload');
  }
  return decoded as SessionPayload;
}
