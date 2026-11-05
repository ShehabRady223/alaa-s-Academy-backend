import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { Role } from '../models/User';
import { ACCESS_COOKIE } from '../utils/cookies';
import { AppError, forbidden } from '../utils/errors';

export interface AuthUser { id: string; role: Role }
declare module 'express-serve-static-core' { interface Request { user?: AuthUser } }

export const JWT_OPTS = { issuer: 'alaas-academy', audience: 'api' } as const;
const deny = (code: string, msg: string) => new AppError(401, msg, code);

/**
 * Stateless: verifies the short-lived access token and trusts its claims, so protected routes cost no database read.
 * A disabled account or a logout takes full effect at the next refresh, i.e. within ACCESS_TOKEN_MINUTES.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) return next(deny('NO_TOKEN', 'Authentication required'));
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { ...JWT_OPTS, algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (p.typ !== 'access' || typeof p.sub !== 'string' || (p.role !== 'admin' && p.role !== 'student')) return next(deny('TOKEN_INVALID', 'Invalid session'));
    req.user = { id: p.sub, role: p.role };
    next();
  } catch (e) {
    next(e instanceof jwt.TokenExpiredError ? deny('TOKEN_EXPIRED', 'Session expired') : deny('TOKEN_INVALID', 'Invalid session'));
  }
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(deny('NO_TOKEN', 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

/** Blocks cross-site state-changing requests even if a cookie would otherwise be attached (defence in depth with SameSite). */
export function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if ((origin && origin !== new URL(env.CLIENT_URL).origin) || req.get('sec-fetch-site') === 'cross-site') {
    return next(new AppError(403, 'Cross-site request blocked', 'CSRF_BLOCKED'));
  }
  next();
}
