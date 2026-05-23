import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../src/lib/password';

describe('password', () => {
  it('hashes a password to a different string', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toBe('hunter2');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('compare succeeds with correct password', async () => {
    const hash = await hashPassword('hunter2');
    expect(await comparePassword('hunter2', hash)).toBe(true);
  });

  it('compare fails with wrong password', async () => {
    const hash = await hashPassword('hunter2');
    expect(await comparePassword('wrong', hash)).toBe(false);
  });
});
