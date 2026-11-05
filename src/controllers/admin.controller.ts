import { Request } from 'express';
import { Types } from 'mongoose';
import * as analytics from '../services/analytics.service';
import * as inbox from '../services/inbox.service';
import * as report from '../services/report.service';
import * as results from '../services/results.service';
import * as settings from '../services/settings.service';
import { asyncHandler } from '../utils/asyncHandler';
import { pid } from '../utils/params';

const q = (req: Request) => req.query as unknown as Record<string, any>; // validated by zod before reaching here
const me = (req: Request) => req.user!.id;

// results
export const listResults = asyncHandler(async (req, res) => { res.json(await results.listResults(me(req), q(req) as never)); });
export const getResult = asyncHandler(async (req, res) => { res.json({ result: await results.getResultDetail(me(req), pid(req)) }); });
export const gradeResult = asyncHandler(async (req, res) => { res.json({ result: await results.reviewAttempt(me(req), pid(req), req.body.grades) }); });
export const releaseResult = asyncHandler(async (req, res) => { res.json({ result: await results.releaseResult(me(req), pid(req)) }); });
export const releaseExam = asyncHandler(async (req, res) => { res.json(await results.releaseExam(me(req), req.body.examId)); });

// dashboards + analytics
export const adminDashboard = asyncHandler(async (req, res) => { res.json(await analytics.adminOverview(me(req))); });
export const studentDashboard = asyncHandler(async (req, res) => { res.json(await analytics.studentDashboard(me(req))); });
export const studentAnalytics = asyncHandler(async (req, res) => { res.json(await analytics.studentProfileDetail(me(req), pid(req))); });
export const examAnalytics = asyncHandler(async (req, res) => { res.json(await analytics.examAnalytics(me(req), pid(req))); });
export const questionAnalytics = asyncHandler(async (req, res) => {
  const { examId } = q(req);
  // teacherId in the match: the stats only ever cover the caller's own exams
  res.json(await analytics.questionStats({ teacherId: new Types.ObjectId(me(req)), ...(examId ? { examId: new Types.ObjectId(examId) } : {}) }, 3));
});
export const topicAnalytics = asyncHandler(async (req, res) => { res.json(await analytics.topicPerformance({ teacherId: new Types.ObjectId(me(req)) })); });

// reports
export const resultsCsv = asyncHandler(async (req, res) => {
  const csv = await report.resultsCsv(me(req), q(req));
  res.type('text/csv; charset=utf-8').attachment('results.csv').send(csv);
});
export const studentPdf = asyncHandler(async (req, res) => { await report.streamStudentReport(res, me(req), pid(req)); });

// inbox
export const notifications = asyncHandler(async (req, res) => { res.json(await inbox.listNotifications(me(req), q(req) as never)); });
export const readNotification = asyncHandler(async (req, res) => { await inbox.markRead(me(req), pid(req)); res.status(204).end(); });
export const readAll = asyncHandler(async (req, res) => { await inbox.markAllRead(me(req)); res.status(204).end(); });

// settings
export const getSettings = asyncHandler(async (_req, res) => { res.json({ settings: await settings.getSettings() }); });
export const putSettings = asyncHandler(async (req, res) => { res.json({ settings: await settings.updateSettings(req.body) }); });
