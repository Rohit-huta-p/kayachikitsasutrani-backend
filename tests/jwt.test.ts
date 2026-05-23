import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from '../src/lib/jwt.js';

const SECRET = 'a'.repeat(32);

describe('jwt', () => {
  it('sign and verify round trip', () => {
    const token = signSession('user-123', SECRET);
    const payload = verifySession(token, SECRET);
    expect(payload.sub).toBe('user-123');
  });

  it('rejects token signed with different secret', () => {
    const token = signSession('user-123', SECRET);
    expect(() => verifySession(token, 'b'.repeat(32))).toThrow();
  });

  it('rejects an obviously malformed token', () => {
    expect(() => verifySession('not-a-token', SECRET)).toThrow();
  });

  it('encodes expiry 7 days out', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signSession('user-123', SECRET);
    const payload = verifySession(token, SECRET);
    const sevenDays = 7 * 24 * 60 * 60;
    expect(payload.exp).toBeGreaterThanOrEqual(before + sevenDays - 5);
    expect(payload.exp).toBeLessThanOrEqual(before + sevenDays + 5);
  });
});
