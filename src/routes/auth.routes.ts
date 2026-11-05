import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { changePasswordBody, forgotBody, loginBody, setPasswordBody } from '../validators/auth';

const limited = (limit: number, key?: (req: import('express').Request) => string) => rateLimit({
  windowMs: 15 * 60_000, limit, standardHeaders: 'draft-7', legacyHeaders: false, validate: false, keyGenerator: key,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } },
});
const byIpAndEmail = (req: import('express').Request) => `${req.ip}|${String(req.body?.email ?? '').toLowerCase().slice(0, 120)}`;

export const authRoutes = Router();
// Brute force: a tight limit per (IP + account) so one attacker can't lock out the real user from another IP, plus a wider per-IP cap.
authRoutes.post('/login', limited(100), limited(8, byIpAndEmail), validate({ body: loginBody }), c.login);
authRoutes.post('/refresh', limited(120), c.refresh);
authRoutes.post('/logout', c.logout);
authRoutes.post('/logout-all', authenticate, c.logoutAll);
authRoutes.get('/me', authenticate, c.me);
authRoutes.post('/forgot-password', limited(20), limited(5, byIpAndEmail), validate({ body: forgotBody }), c.forgotPassword);
authRoutes.post('/set-password', limited(20), validate({ body: setPasswordBody }), c.setPassword);
authRoutes.post('/change-password', authenticate, limited(10), validate({ body: changePasswordBody }), c.changePassword);
