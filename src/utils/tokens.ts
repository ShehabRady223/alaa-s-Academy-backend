import { createHash, randomBytes } from 'crypto';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** 32 random bytes, URL-safe. Only the hash is ever stored. */
export function generateToken() {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: sha256(raw) };
}
