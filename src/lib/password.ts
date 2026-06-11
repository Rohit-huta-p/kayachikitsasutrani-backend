import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Generate a cryptographically random, human-friendly password.
 * Avoids ambiguous chars (0/O, 1/l/I) so it survives being copy-pasted
 * out of a mail client or read aloud over the phone.
 */
export function generateRandomPassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%*+-';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
