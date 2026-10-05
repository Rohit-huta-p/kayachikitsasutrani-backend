import { describe, it, expect, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, credentialCryptoReady } from '../src/lib/credentialCrypto.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

afterEach(() => {
  delete process.env.CREDENTIAL_ENC_KEY;
});

describe('credentialCrypto', () => {
  it('round-trips a secret', () => {
    process.env.CREDENTIAL_ENC_KEY = KEY;
    const sealed = encryptSecret('v7Kq-2pML-9za');
    expect(sealed.iv).toBeTruthy();
    expect(sealed.ciphertext).not.toContain('v7Kq');
    expect(decryptSecret(sealed)).toBe('v7Kq-2pML-9za');
  });

  it('detects tampering via the GCM tag', () => {
    process.env.CREDENTIAL_ENC_KEY = KEY;
    const sealed = encryptSecret('secret');
    expect(() => decryptSecret({ ...sealed, ciphertext: Buffer.from('zzzzzz').toString('base64') })).toThrow();
  });

  it('is not ready and throws without a key', () => {
    expect(credentialCryptoReady()).toBe(false);
    expect(() => encryptSecret('x')).toThrow();
  });

  it('rejects a wrong-size key', () => {
    process.env.CREDENTIAL_ENC_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(credentialCryptoReady()).toBe(false);
  });
});
