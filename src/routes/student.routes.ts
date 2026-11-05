import { Router } from 'express';
import * as c from '../controllers/student.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createStudentBody, idParams, listStudentsQuery, updateStudentBody } from '../validators/students';

export const studentRoutes = Router();
studentRoutes.use(authenticate, requireRole('admin'));

studentRoutes.get('/', validate({ query: listStudentsQuery }), c.list);
studentRoutes.post('/', validate({ body: createStudentBody }), c.create);
studentRoutes.get('/:id', validate({ params: idParams }), c.get);
studentRoutes.patch('/:id', validate({ params: idParams, body: updateStudentBody }), c.update);
studentRoutes.post('/:id/resend-invite', validate({ params: idParams }), c.resendInvite);
studentRoutes.delete('/:id', validate({ params: idParams }), c.remove);
