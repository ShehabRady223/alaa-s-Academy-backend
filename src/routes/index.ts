import { Router } from 'express';
import { analyticsRoutes, dashboardRoutes, notificationRoutes, reportRoutes, resultRoutes, settingsRoutes } from './admin.routes';
import { assignmentRoutes, studentAssignmentRoutes } from './assignment.routes';
import { attemptRoutes } from './attempt.routes';
import { authRoutes } from './auth.routes';
import { examRoutes } from './exam.routes';
import { examAccessRoutes } from './examAccess.routes';
import { qrRoutes } from './qr.routes';
import { studentRoutes } from './student.routes';

export const routes = Router();
routes.get('/health', (_req, res) => res.json({ status: 'ok' }));
routes.use('/auth', authRoutes);
routes.use('/students', studentRoutes);
// Exams (QR-based assessments) and their per-student QR access
routes.use('/exams', examRoutes);
routes.use('/exam-access', examAccessRoutes);
routes.use('/qr', qrRoutes);
routes.use('/attempts', attemptRoutes);
routes.use('/results', resultRoutes);
// Assignments (homework): independent of exams
routes.use('/assignments', assignmentRoutes);
routes.use('/student/assignments', studentAssignmentRoutes);
routes.use('/dashboard', dashboardRoutes);
routes.use('/analytics', analyticsRoutes);
routes.use('/reports', reportRoutes);
routes.use('/notifications', notificationRoutes);
routes.use('/settings', settingsRoutes);
