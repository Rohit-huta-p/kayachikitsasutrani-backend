import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SealedSecret {
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  tag: string; // base64 (16 bytes)
}

// Read the key straight from process.env (not the cached env()) so this module
// stays decoupled and unit-testable without the full env. Accepts base64 or hex.
function keyBuf(): Buffer | null {
  const raw = process.env.CREDENTIAL_ENC_KEY;
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

/** True when a valid 32-byte CREDENTIAL_ENC_KEY is configured. */
export function credentialCryptoReady(): boolean {
  return keyBuf() !== null;
}

export function encryptSecret(plain: string): SealedSecret {
  const k = keyBuf();
  if (!k) throw new Error('CREDENTIAL_ENC_KEY missing or not 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(s: SealedSecret): string {
  const k = keyBuf();
  if (!k) throw new Error('CREDENTIAL_ENC_KEY missing or not 32 bytes');
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(s.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(s.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
