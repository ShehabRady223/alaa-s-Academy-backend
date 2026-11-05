import { Router } from 'express';
import * as c from '../controllers/assignment.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { answersBody, createAssignmentBody, gradeBody, listAssignmentsQuery, submissionParams, updateAssignmentBody } from '../validators/assignments';
import { idParams } from '../validators/common';

export const assignmentRoutes = Router(); // teacher: /assignments
assignmentRoutes.use(authenticate, requireRole('admin'));
assignmentRoutes.get('/', validate({ query: listAssignmentsQuery }), c.list);
assignmentRoutes.post('/', validate({ body: createAssignmentBody }), c.create);
assignmentRoutes.get('/:id', validate({ params: idParams }), c.get);
assignmentRoutes.patch('/:id', validate({ params: idParams, body: updateAssignmentBody }), c.update);
assignmentRoutes.delete('/:id', validate({ params: idParams }), c.remove);
assignmentRoutes.post('/:id/publish', validate({ params: idParams }), c.publish);
assignmentRoutes.post('/:id/close', validate({ params: idParams }), c.close);
assignmentRoutes.get('/:id/submissions', validate({ params: idParams }), c.submissions);
assignmentRoutes.get('/:id/submissions/:sid', validate({ params: submissionParams }), c.submission);
assignmentRoutes.patch('/:id/submissions/:sid/grade', validate({ params: submissionParams, body: gradeBody }), c.grade);

export const studentAssignmentRoutes = Router(); // student: /student/assignments
studentAssignmentRoutes.use(authenticate, requireRole('student'));
studentAssignmentRoutes.get('/', c.mine);
studentAssignmentRoutes.get('/:id', validate({ params: idParams }), c.mineOne);
studentAssignmentRoutes.put('/:id/submission', validate({ params: idParams, body: answersBody }), c.saveDraft);
studentAssignmentRoutes.post('/:id/submission/submit', validate({ params: idParams, body: answersBody }), c.submit);
