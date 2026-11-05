import { Router } from 'express';
import * as c from '../controllers/qr.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { qrQuery } from '../validators/examAccess';
import { idParams } from '../validators/common';

export const qrRoutes = Router();
qrRoutes.use(authenticate, requireRole('admin'));
qrRoutes.get('/:id', validate({ params: idParams, query: qrQuery }), c.image);
qrRoutes.get('/:id/link', validate({ params: idParams }), c.link);
