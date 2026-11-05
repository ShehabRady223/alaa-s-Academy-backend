import { Router } from 'express';
import * as c from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as v from '../validators/admin';
import { idParams } from '../validators/common';

const admin = [authenticate, requireRole('admin')];

export const resultRoutes = Router();
resultRoutes.use(...admin);
resultRoutes.get('/', validate({ query: v.listResultsQuery }), c.listResults);
resultRoutes.post('/release', validate({ body: v.releaseBody }), c.releaseExam); // before /:id
resultRoutes.get('/:id', validate({ params: idParams }), c.getResult);
resultRoutes.patch('/:id/grade', validate({ params: idParams, body: v.gradeBody }), c.gradeResult);
resultRoutes.post('/:id/release', validate({ params: idParams }), c.releaseResult);

export const dashboardRoutes = Router();
dashboardRoutes.get('/admin', ...admin, c.adminDashboard);
dashboardRoutes.get('/student', authenticate, requireRole('student'), c.studentDashboard);

export const analyticsRoutes = Router();
analyticsRoutes.use(...admin);
analyticsRoutes.get('/students/:id', validate({ params: idParams }), c.studentAnalytics);
analyticsRoutes.get('/exams/:id', validate({ params: idParams }), c.examAnalytics);
analyticsRoutes.get('/questions', validate({ query: v.questionStatsQuery }), c.questionAnalytics);
analyticsRoutes.get('/topics', c.topicAnalytics);

export const reportRoutes = Router();
reportRoutes.use(...admin);
reportRoutes.get('/results.csv', validate({ query: v.reportQuery }), c.resultsCsv);
reportRoutes.get('/students/:id/pdf', validate({ params: idParams }), c.studentPdf);

export const notificationRoutes = Router();
notificationRoutes.use(...admin);
notificationRoutes.get('/', validate({ query: v.notificationsQuery }), c.notifications);
notificationRoutes.post('/read-all', c.readAll); // before /:id
notificationRoutes.post('/:id/read', validate({ params: idParams }), c.readNotification);

export const settingsRoutes = Router();
settingsRoutes.use(...admin);
settingsRoutes.get('/', c.getSettings);
settingsRoutes.put('/', validate({ body: v.settingsBody }), c.putSettings);
