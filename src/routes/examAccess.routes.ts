import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as c from '../controllers/examAccess.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParams } from '../validators/common';
import { createAccessBody, enterBody, listAccessQuery } from '../validators/examAccess';

export const tokenLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, validate: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } } });
const teacher = [authenticate, requireRole('admin')];

export const examAccessRoutes = Router();
examAccessRoutes.post('/enter', authenticate, requireRole('student'), tokenLimiter, validate({ body: enterBody }), c.enter); // student: scan a QR
examAccessRoutes.get('/', ...teacher, validate({ query: listAccessQuery }), c.list);
examAccessRoutes.post('/', ...teacher, validate({ body: createAccessBody }), c.create);
examAccessRoutes.get('/:id', ...teacher, validate({ params: idParams }), c.get);
examAccessRoutes.post('/:id/revoke', ...teacher, validate({ params: idParams }), c.revoke);
examAccessRoutes.post('/:id/qr/regenerate', ...teacher, validate({ params: idParams }), c.regenerate);
