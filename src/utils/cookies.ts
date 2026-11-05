import { CookieOptions, Response } from 'express';
import { env, isProd } from '../config/env';

export const ACCESS_COOKIE = 'aa_access';
export const REFRESH_COOKIE = 'aa_refresh';
const DAY = 24 * 3600_000;

// The access cookie outlives the JWT inside it on purpose: when the JWT expires the server still receives it,
// can answer TOKEN_EXPIRED, and the client knows a silent refresh is worth trying (an anonymous visitor gets NO_TOKEN).
const access: CookieOptions = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: env.REFRESH_ABSOLUTE_DAYS * DAY };
// The refresh cookie is only ever sent to /api/auth/* and never on cross-site requests.
const refresh: CookieOptions = { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/api/auth', maxAge: env.REFRESH_TOKEN_DAYS * DAY };

export function setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, access).cookie(REFRESH_COOKIE, refreshToken, refresh);
}
export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...access, maxAge: undefined }).clearCookie(REFRESH_COOKIE, { ...refresh, maxAge: undefined });
}
