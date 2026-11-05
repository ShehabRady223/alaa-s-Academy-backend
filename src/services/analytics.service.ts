import { Types } from 'mongoose';
import { Exam } from '../models/Exam';
import { ExamAccess } from '../models/ExamAccess';
import { ExamAttempt } from '../models/ExamAttempt';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { notFound } from '../utils/errors';

const oid = (id: string) => new Types.ObjectId(id);
const r1 = (n: number) => Math.round(n * 10) / 10;
const SUBMITTED = ['graded', 'pending_review'];
type Trend = 'improving' | 'declining' | 'stable' | 'insufficient_data';

/** Compares the latest attempts with the ones before them (+/-5 points = a real change). */
export function computeTrend(pcts: number[]): Trend {
  const n = pcts.length;
  if (n < 2) return 'insufficient_data';
  const k = Math.min(3, Math.floor(n / 2));
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const d = avg(pcts.slice(-k)) - avg(pcts.slice(-2 * k, -k));
  return d > 5 ? 'improving' : d < -5 ? 'declining' : 'stable';
}

// ---------- topics ----------
interface TopicAgg { _id: { s: string | null; t: string | null }; earned: number; possible: number; questions: number }

/** Subject -> topic percentages from graded attempts matching `match`. Reviewed essays count, unreviewed ones don't. */
export async function topicPerformance(match: Record<string, unknown> = {}) {
  const rows = await ExamAttempt.aggregate<TopicAgg>([
    { $match: { status: 'graded', ...match } },
    { $unwind: '$answers' },
    { $match: { 'answers.needsReview': { $ne: true } } },
    { $group: {
      _id: { s: '$answers.subjectName', t: '$answers.topicName' }, earned: { $sum: '$answers.pointsAwarded' },
      possible: { $sum: '$answers.maxPoints' }, questions: { $sum: 1 },
    } },
  ]);
  const bySubject = new Map<string, { subject: string; earned: number; possible: number; topics: { topic: string; percentage: number; questions: number }[] }>();
  for (const r of rows) {
    const key = r._id.s ?? 'General';
    const s = bySubject.get(key) ?? { subject: key, earned: 0, possible: 0, topics: [] };
    s.earned += r.earned; s.possible += r.possible;
    s.topics.push({ topic: r._id.t ?? 'General', percentage: r.possible ? r1((r.earned / r.possible) * 100) : 0, questions: r.questions });
    bySubject.set(key, s);
  }
  const subjects = [...bySubject.values()]
    .map((s) => ({ subject: s.subject, percentage: s.possible ? r1((s.earned / s.possible) * 100) : 0, topics: s.topics.sort((a, b) => a.topic.localeCompare(b.topic)) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
  const flat = subjects.flatMap((s) => s.topics.filter((t) => t.questions >= 3).map((t) => ({ subject: s.subject, ...t })));
  return {
    subjects,
    strengths: flat.filter((t) => t.percentage >= 80).sort((a, b) => b.percentage - a.percentage).slice(0, 5),
    weaknesses: flat.filter((t) => t.percentage < 60).sort((a, b) => a.percentage - b.percentage).slice(0, 5),
  };
}

// ---------- per-question stats ----------
export async function questionStats(match: Record<string, unknown> = {}, minAttempts = 3) {
  const rows = await ExamAttempt.aggregate<{ _id: Types.ObjectId; examId: Types.ObjectId; attempts: number; earned: number; possible: number; avgTime: number | null; subject: string; topic: string }>([
    { $match: { status: 'graded', ...match } },
    { $unwind: '$answers' },
    { $match: { 'answers.needsReview': { $ne: true } } },
    { $group: {
      _id: '$answers.questionId', attempts: { $sum: 1 }, earned: { $sum: '$answers.pointsAwarded' },
      possible: { $sum: '$answers.maxPoints' }, avgTime: { $avg: '$answers.timeSpentSec' },
      examId: { $first: '$examId' }, subject: { $first: '$answers.subjectName' }, topic: { $first: '$answers.topicName' },
    } },
    { $match: { attempts: { $gte: minAttempts } } },
  ]);
  // Question text lives inside its exam; look it up there (a deleted exam simply shows "(deleted question)").
  const exams = await Exam.find({ _id: { $in: [...new Set(rows.map((r) => String(r.examId)))] } }).select('+questions').lean();
  const tMap = new Map<string, { text: string; type: string }>();
  for (const e of exams) for (const q of (e as unknown as { questions?: { questionId: Types.ObjectId; text: string; type: string }[] }).questions ?? []) tMap.set(String(q.questionId), q);
  const all = rows.map((r) => ({
    questionId: String(r._id), text: tMap.get(String(r._id))?.text ?? '(deleted question)', type: tMap.get(String(r._id))?.type ?? null,
    subject: r.subject, topic: r.topic, attempts: r.attempts,
    successRate: r.possible ? r1((r.earned / r.possible) * 100) : 0, avgTimeSec: r.avgTime == null ? null : Math.round(r.avgTime),
  }));
  const byRate = [...all].sort((a, b) => a.successRate - b.successRate);
  const times = all.filter((q) => q.avgTimeSec != null);
  return {
    hardest: byRate.slice(0, 10), easiest: [...byRate].reverse().slice(0, 10),
    averageTimePerQuestionSec: times.length ? Math.round(times.reduce((s, q) => s + (q.avgTimeSec ?? 0), 0) / times.length) : null,
  };
}

const LABELS = ['0-49', '50-59', '60-69', '70-79', '80-89', '90-100'];
async function distribution(match: Record<string, unknown> = {}) {
  const rows = await ExamAttempt.aggregate<{ _id: number | string; count: number }>([
    { $match: { status: 'graded', ...match } },
    { $bucket: { groupBy: '$percentage', boundaries: [0, 50, 60, 70, 80, 90, 100.0001], default: 'other', output: { count: { $sum: 1 } } } },
  ]);
  const byLow = new Map(rows.map((r) => [r._id, r.count]));
  return [0, 50, 60, 70, 80, 90].map((lo, i) => ({ range: LABELS[i]!, count: byLow.get(lo) ?? 0 }));
}

// ---------- student ----------
/** One row of a student's history. For students, unreleased attempts are masked so held-back scores never leak. */
export function toHistoryItem(
  a: { _id: Types.ObjectId; examId: Types.ObjectId; status: string; attemptNumber: number; submittedAt?: Date | null; score?: number | null; maxScore: number; percentage?: number | null; passed?: boolean | null; timeTakenSec?: number | null; releasedAt?: Date | null },
  examTitle: string, releasedOnly: boolean,
) {
  const hide = releasedOnly && !a.releasedAt;
  return {
    attemptId: String(a._id), examId: String(a.examId), examTitle, attemptNumber: a.attemptNumber,
    status: hide ? 'pending_review' : a.status, submittedAt: a.submittedAt, maxScore: a.maxScore, timeTakenSec: a.timeTakenSec ?? null,
    score: hide ? null : a.score ?? null, percentage: hide ? null : a.percentage ?? null, passed: hide ? null : a.passed ?? null,
  };
}

/** `tid` restricts everything to one teacher's exams (teacher views). Student views pass none and see only their own released work. */
export async function studentPerformance(studentId: string, releasedOnly = false, tid?: string) {
  const sid = oid(studentId);
  const scope = tid ? { teacherId: oid(tid) } : {};
  const [attempts, assigned] = await Promise.all([
    ExamAttempt.find({ studentId: sid, ...scope, status: { $in: SUBMITTED } }).sort({ submittedAt: 1 })
      .select('examId status score maxScore percentage passed submittedAt timeTakenSec attemptNumber releasedAt').lean(),
    ExamAccess.countDocuments({ studentId: sid, ...(tid ? { teacherId: tid } : {}), status: { $ne: 'revoked' } }),
  ]);
  const exams = await Exam.find({ _id: { $in: attempts.map((a) => a.examId) } }).select('title').lean();
  const title = new Map(exams.map((e) => [String(e._id), e.title]));
  const history = attempts.map((a) => toHistoryItem(a, title.get(String(a.examId)) ?? 'Exam', releasedOnly));
  const graded = history.filter((h) => h.status === 'graded' && h.percentage != null);
  const pcts = graded.map((h) => h.percentage as number);
  const topics = await topicPerformance({ studentId: sid, ...scope, ...(releasedOnly && { releasedAt: { $exists: true } }) });
  return {
    overview: {
      assignedExams: assigned, completedExams: new Set(history.map((h) => h.examId)).size, attempts: history.length,
      averagePercentage: pcts.length ? r1(pcts.reduce((s, x) => s + x, 0) / pcts.length) : null,
      highestPercentage: pcts.length ? Math.max(...pcts) : null, lowestPercentage: pcts.length ? Math.min(...pcts) : null,
      trend: computeTrend(pcts), pendingReview: history.length - graded.length,
    },
    history: [...history].reverse(),
    performanceOverTime: graded.map((h) => ({ date: h.submittedAt, percentage: h.percentage, examTitle: h.examTitle })),
    ...topics,
  };
}

export async function studentProfileDetail(tid: string, studentId: string) {
  const profile = await StudentProfile.findOne({ userId: studentId, teacherId: tid }).lean();
  if (!profile) throw notFound('Student not found'); // someone else's student looks identical to a missing one
  const user = await User.findById(studentId).select('name email avatar createdAt').lean();
  if (!user) throw notFound('Student not found');
  const [perf, accesses] = await Promise.all([
    studentPerformance(studentId, false, tid),
    ExamAccess.find({ studentId, teacherId: tid, status: { $ne: 'revoked' } }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  const exams = await Exam.find({ _id: { $in: accesses.map((a) => a.examId) } }).select('title').lean();
  const title = new Map(exams.map((e) => [String(e._id), e.title]));
  return {
    student: { id: String(user._id), name: user.name, email: user.email, avatar: user.avatar ?? null, createdAt: user.createdAt, profile },
    ...perf,
    assignedExams: accesses.map((a) => ({ accessId: String(a._id), examTitle: title.get(String(a.examId)) ?? 'Exam', status: a.status, expiresAt: a.expiresAt ?? null, maxAttempts: a.maxAttempts })),
  };
}

// ---------- exam ----------
export async function examAnalytics(tid: string, examId: string) {
  const exam = await Exam.findOne({ _id: examId, teacherId: tid }).select('title passingScore').lean();
  if (!exam) throw notFound('Exam not found');
  const match = { examId: oid(examId) };
  const [sum] = await ExamAttempt.aggregate<{ n: number; avg: number; hi: number; lo: number; passed: number; time: number }>([
    { $match: { status: 'graded', ...match } },
    { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$percentage' }, hi: { $max: '$percentage' }, lo: { $min: '$percentage' }, passed: { $sum: { $cond: ['$passed', 1, 0] } }, time: { $avg: '$timeTakenSec' } } },
  ]);
  const [assigned, pending, questions, dist, topics] = await Promise.all([
    ExamAccess.countDocuments({ examId, teacherId: tid, status: { $ne: 'revoked' } }),
    ExamAttempt.countDocuments({ ...match, status: 'pending_review' }),
    questionStats(match, 1), distribution(match), topicPerformance(match),
  ]);
  return {
    exam: { id: String(exam._id), title: exam.title, passingScore: exam.passingScore },
    summary: {
      assigned, gradedAttempts: sum?.n ?? 0, pendingReview: pending,
      averagePercentage: sum ? r1(sum.avg) : null, highest: sum?.hi ?? null, lowest: sum?.lo ?? null,
      passRate: sum?.n ? r1((sum.passed / sum.n) * 100) : null, averageTimeSec: sum?.time != null ? Math.round(sum.time) : null,
    },
    distribution: dist, questions, subjects: topics.subjects,
  };
}

// ---------- admin dashboard ----------
export async function adminOverview(tid: string) {
  const since = new Date(Date.now() - 84 * 86400_000);
  const mine = { teacherId: oid(tid) }; // aggregation pipelines do not auto-cast ids
  const [students, activeStudents, exams, publishedExams, completed, pending, avg, assigned, doneAccess, series, dist, qs] = await Promise.all([
    StudentProfile.countDocuments({ teacherId: tid }),
    StudentProfile.countDocuments({ teacherId: tid, status: 'active' }),
    Exam.countDocuments({ teacherId: tid, status: { $ne: 'archived' } }),
    Exam.countDocuments({ teacherId: tid, status: 'published' }),
    ExamAttempt.countDocuments({ teacherId: tid, status: { $in: SUBMITTED } }),
    ExamAttempt.countDocuments({ teacherId: tid, status: 'pending_review' }),
    ExamAttempt.aggregate<{ avg: number }>([{ $match: { ...mine, status: 'graded' } }, { $group: { _id: null, avg: { $avg: '$percentage' } } }]),
    ExamAccess.countDocuments({ teacherId: tid, status: { $ne: 'revoked' } }),
    ExamAttempt.distinct('accessId', { teacherId: tid, status: { $in: SUBMITTED } }),
    ExamAttempt.aggregate<{ _id: Date; avg: number; attempts: number }>([
      { $match: { ...mine, status: 'graded', submittedAt: { $gte: since } } },
      { $group: { _id: { $dateTrunc: { date: '$submittedAt', unit: 'week' } }, avg: { $avg: '$percentage' }, attempts: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    distribution(mine), questionStats(mine, 3),
  ]);
  return {
    cards: { totalStudents: students, activeStudents, totalExams: exams, publishedExams, completedAttempts: completed, averageScore: avg[0] ? r1(avg[0].avg) : null, pendingReviews: pending },
    performanceOverTime: series.map((s) => ({ weekOf: s._id.toISOString().slice(0, 10), averagePercentage: r1(s.avg), attempts: s.attempts })),
    completionRate: { assigned, completed: doneAccess.length, rate: assigned ? r1((doneAccess.length / assigned) * 100) : null },
    distribution: dist, hardestQuestions: qs.hardest.slice(0, 5), easiestQuestions: qs.easiest.slice(0, 5),
  };
}

// ---------- student dashboard ----------
export async function studentDashboard(studentId: string) {
  const sid = oid(studentId);
  const [perf, assignments, used, open] = await Promise.all([
    studentPerformance(studentId, true), // students only ever see released results
    ExamAccess.find({ studentId: sid, status: { $ne: 'revoked' } }).sort({ createdAt: -1 }).lean(),
    ExamAttempt.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { studentId: sid, status: { $ne: 'voided' } } }, { $group: { _id: '$accessId', n: { $sum: 1 } } }]),
    ExamAttempt.find({ studentId: sid, status: 'in_progress' }).select('accessId').lean(),
  ]);
  const exams = await Exam.find({ _id: { $in: assignments.map((a) => a.examId) } }).select('title durationMinutes startDate expiresAt').lean();
  const eMap = new Map(exams.map((e) => [String(e._id), e]));
  const uMap = new Map(used.map((u) => [String(u._id), u.n]));
  const openSet = new Set(open.map((o) => String(o.accessId)));
  const now = new Date();
  // Deliberately no tokens or links here: students enter exams via the QR code their teacher gives them.
  const myExams = assignments.map((a) => {
    const e = eMap.get(String(a.examId));
    const n = uMap.get(String(a._id)) ?? 0;
    const closed = (a.expiresAt && a.expiresAt <= now) || (e?.expiresAt && e.expiresAt <= now);
    const state = openSet.has(String(a._id)) ? 'in_progress' : n >= a.maxAttempts ? 'completed' : closed ? 'expired' : e?.startDate && e.startDate > now ? 'scheduled' : 'not_started';
    return { accessId: String(a._id), examTitle: e?.title ?? 'Exam', durationMinutes: e?.durationMinutes ?? null, opensAt: e?.startDate ?? null, closesAt: a.expiresAt ?? e?.expiresAt ?? null, attemptsUsed: n, maxAttempts: a.maxAttempts, state };
  });
  return { ...perf, myExams };
}
