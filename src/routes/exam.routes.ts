import { Router } from 'express';
import * as c from '../controllers/exam.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParams } from '../validators/common';
import { createExamBody, listExamsQuery, updateExamBody } from '../validators/exams';

export const examRoutes = Router();
examRoutes.use(authenticate, requireRole('admin'));
examRoutes.get('/', validate({ query: listExamsQuery }), c.list);
examRoutes.post('/', validate({ body: createExamBody }), c.create);
examRoutes.get('/:id', validate({ params: idParams }), c.get);
examRoutes.patch('/:id', validate({ params: idParams, body: updateExamBody }), c.update);
examRoutes.delete('/:id', validate({ params: idParams }), c.remove);
examRoutes.post('/:id/publish', validate({ params: idParams }), c.publish);
examRoutes.post('/:id/archive', validate({ params: idParams }), c.archive);
examRoutes.post('/:id/duplicate', validate({ params: idParams }), c.duplicate);
