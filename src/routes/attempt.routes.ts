import { Router } from 'express';
import * as c from '../controllers/attempt.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { enterBody } from '../validators/examAccess';
import { autosaveBody, submitBody } from '../validators/attempts';
import { idParams } from '../validators/common';
import { tokenLimiter } from './examAccess.routes';

export const attemptRoutes = Router();
attemptRoutes.use(authenticate, requireRole('student'));
attemptRoutes.post('/start', tokenLimiter, validate({ body: enterBody }), c.start);
attemptRoutes.get('/:id', validate({ params: idParams }), c.get);
attemptRoutes.patch('/:id/autosave', validate({ params: idParams, body: autosaveBody }), c.autosave);
attemptRoutes.post('/:id/submit', validate({ params: idParams, body: submitBody }), c.submit);
attemptRoutes.get('/:id/result', validate({ params: idParams }), c.result);
