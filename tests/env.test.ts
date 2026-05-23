import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/env';

const VALID = {
  NODE_ENV: 'development',
  PORT: '4000',
  MONGO_URI: 'mongodb://localhost:27017/shloka',
  JWT_SECRET: 'a'.repeat(32),
  FRONTEND_ORIGIN: 'http://localhost:3000',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'verystrong',
  ADMIN_NAME: 'Admin',
};

describe('parseEnv', () => {
  it('parses a valid env object', () => {
    const env = parseEnv(VALID);
    expect(env.PORT).toBe(4000);
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws on missing MONGO_URI', () => {
    const bad = { ...VALID, MONGO_URI: undefined } as unknown as Record<string, string>;
    expect(() => parseEnv(bad)).toThrow();
  });

  it('throws when JWT_SECRET is too short', () => {
    const bad = { ...VALID, JWT_SECRET: 'short' };
    expect(() => parseEnv(bad)).toThrow();
  });

  it('parses comma-separated FRONTEND_ORIGIN into a list', () => {
    const env = parseEnv({ ...VALID, FRONTEND_ORIGIN: 'http://a.test,http://b.test' });
    expect(env.FRONTEND_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });
});
