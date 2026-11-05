import { Types } from 'mongoose';
import { Exam } from '../models/Exam';
import { ExamAttempt } from '../models/ExamAttempt';
import { User } from '../models/User';
import { AttemptAnswer, AttemptLean } from '../types/attempt';
import { ExamLean, StoredQuestion } from '../types/exam';
import { badRequest, conflict, notFound } from '../utils/errors';
import { round2 } from './grading.service';

const lean = <T>(v: unknown) => v as T;
export interface GradeIn { questionId: string; points: number; feedback?: string }

/** Pure: applies teacher scores, validates bounds, recomputes the total. */
export function applyManualGrades(answers: AttemptAnswer[], grades: GradeIn[]) {
  const byId = new Map(answers.map((a) => [String(a.questionId), a]));
  const changed = new Map<string, AttemptAnswer>();
  for (const g of grades) {
    const a = byId.get(g.questionId);
    if (!a) throw badRequest('A graded question is not part of this attempt');
    const max = a.maxPoints ?? 0;
    if (g.points < 0 || g.points > max) throw badRequest(`Points must be between 0 and ${max}`);
    changed.set(g.questionId, {
      ...a, pointsAwarded: round2(g.points), isCorrect: g.points >= max ? true : g.points <= 0 ? false : null,
      needsReview: false, reviewed: true, feedback: g.feedback ?? a.feedback ?? null,
    });
  }
  const next = answers.map((a) => changed.get(String(a.questionId)) ?? a);
  return { answers: next, score: round2(next.reduce((s, a) => s + (a.pointsAwarded ?? 0), 0)), pending: next.some((a) => a.needsReview) };
}

export async function listResults(tid: string, q: { page: number; limit: number; examId?: string; studentId?: string; status?: string }) {
  const filter: Record<string, unknown> = { teacherId: tid, status: q.status ?? { $in: ['graded', 'pending_review'] } };
  if (q.examId) filter.examId = q.examId;
  if (q.studentId) filter.studentId = q.studentId;
  const [docs, total] = await Promise.all([
    ExamAttempt.find(filter).sort({ submittedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit)
      .select('-answers -layout').lean(),
    ExamAttempt.countDocuments(filter),
  ]);
  const items = lean<AttemptLean[]>(docs);
  const [users, exams] = await Promise.all([
    User.find({ _id: { $in: items.map((a) => a.studentId) } }).select('name email').lean(),
    Exam.find({ _id: { $in: items.map((a) => a.examId) } }).select('title').lean(),
  ]);
  const u = new Map(users.map((x) => [String(x._id), { id: String(x._id), name: x.name, email: x.email }]));
  const e = new Map(exams.map((x) => [String(x._id), { id: String(x._id), title: x.title }]));
  return {
    items: items.map((a) => ({
      id: String(a._id), status: a.status, attemptNumber: a.attemptNumber, student: u.get(String(a.studentId)) ?? null,
      exam: e.get(String(a.examId)) ?? null, score: a.score ?? null, maxScore: a.maxScore, percentage: a.percentage ?? null,
      passed: a.passed ?? null, submittedAt: a.submittedAt ?? null, timeTakenSec: a.timeTakenSec ?? null, released: !!a.releasedAt,
    })),
    page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit),
  };
}

async function loadAttempt(tid: string, id: string) {
  // Scoped lookup: another teacher's attempt id behaves exactly like a missing one.
  const a = lean<AttemptLean | null>(await ExamAttempt.findOne({ _id: id, teacherId: tid }).lean());
  if (!a || a.status === 'voided') throw notFound('Result not found');
  return a;
}

/** Admin detail: includes correct answers and the student's responses. */
export async function getResultDetail(tid: string, id: string) {
  const a = await loadAttempt(tid, id);
  if (a.status === 'in_progress') throw conflict('This attempt is still in progress');
  const [exam, student] = await Promise.all([
    Exam.findById(a.examId).select('+questions title passingScore').lean(),
    User.findById(a.studentId).select('name email').lean(),
  ]);
  const snap = new Map(lean<{ questions: StoredQuestion[] }>(exam).questions.map((s) => [String(s.questionId), s]));
  return {
    id: String(a._id), status: a.status, attemptNumber: a.attemptNumber, released: !!a.releasedAt,
    student: student ? { id: String(student._id), name: student.name, email: student.email } : null,
    exam: exam ? { id: String(exam._id), title: exam.title, passingScore: exam.passingScore } : null,
    startedAt: a.startedAt, submittedAt: a.submittedAt ?? null, timeTakenSec: a.timeTakenSec ?? null,
    score: a.score ?? null, maxScore: a.maxScore, percentage: a.percentage ?? null, passed: a.passed ?? null,
    questions: a.answers.map((ans) => {
      const q = snap.get(String(ans.questionId));
      return {
        questionId: String(ans.questionId), type: ans.type, text: q?.text ?? '', options: q?.options ?? [], response: ans.response,
        correctOptionIds: q?.correctOptionIds ?? [], acceptedAnswers: q?.acceptedAnswers ?? [], explanation: q?.explanation ?? null,
        subject: ans.subjectName, topic: ans.topicName, isCorrect: ans.isCorrect, pointsAwarded: ans.pointsAwarded,
        maxPoints: ans.maxPoints, needsReview: !!ans.needsReview, feedback: ans.feedback ?? null, timeSpentSec: ans.timeSpentSec ?? 0,
      };
    }),
  };
}

export async function reviewAttempt(tid: string, id: string, grades: GradeIn[]) {
  const a = await loadAttempt(tid, id);
  if (a.status !== 'pending_review' && a.status !== 'graded') throw conflict('This attempt cannot be graded yet');
  const exam = lean<ExamLean | null>(await Exam.findById(a.examId).lean());
  if (!exam) throw notFound('Exam not found');

  const r = applyManualGrades(a.answers, grades);
  const set: Record<string, unknown> = { answers: r.answers, score: r.score };
  if (!r.pending) {
    const percentage = a.maxScore > 0 ? round2((r.score / a.maxScore) * 100) : 0;
    Object.assign(set, { status: 'graded', percentage, passed: percentage >= exam.passingScore, gradedAt: new Date(), gradedBy: tid });
    if (exam.settings.resultRelease === 'instant' && !a.releasedAt) set.releasedAt = new Date();
  }
  // CAS on status: two teachers grading at once cannot silently overwrite each other's final state.
  const ok = await ExamAttempt.findOneAndUpdate({ _id: id, teacherId: tid, status: a.status, updatedAt: (a as unknown as { updatedAt: Date }).updatedAt }, { $set: set });
  if (!ok) throw conflict('This result was changed by someone else. Reload and try again.');
  return getResultDetail(tid, id);
}

export async function releaseResult(tid: string, id: string) {
  await loadAttempt(tid, id); // 404 if it is not yours
  const r = await ExamAttempt.updateOne({ _id: id, teacherId: tid, status: 'graded', releasedAt: { $exists: false } }, { releasedAt: new Date() });
  if (!r.matchedCount) throw conflict('Only graded, unreleased results can be released');
  return getResultDetail(tid, id);
}

export async function releaseExam(tid: string, examId: string) {
  if (!(await Exam.exists({ _id: examId, teacherId: tid }))) throw notFound('Exam not found');
  const r = await ExamAttempt.updateMany({ examId: new Types.ObjectId(examId), teacherId: tid, status: 'graded', releasedAt: { $exists: false } }, { releasedAt: new Date() });
  return { released: r.modifiedCount };
}
