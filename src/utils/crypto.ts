import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'crypto';
import { env } from '../config/env';

const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex');

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const parts = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const [iv, tag, enc] = parts;
  if (parts.length !== 3 || !iv || !tag || !enc) throw new Error('Malformed ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/** Unbiased Fisher-Yates using crypto randomness. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
