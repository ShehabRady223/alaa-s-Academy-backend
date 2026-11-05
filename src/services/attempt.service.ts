import { Exam } from '../models/Exam';
import { ExamAccess } from '../models/ExamAccess';
import { ExamAttempt } from '../models/ExamAttempt';
import { User } from '../models/User';
import { ExamAccessLean, AttemptAnswer, AttemptLean } from '../types/attempt';
import { ExamLean, StoredQuestion } from '../types/exam';
import { cleanResponse } from '../utils/responses';
import { AuthUser } from '../middleware/auth';
import { shuffle } from '../utils/crypto';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';
import { toStudentQuestion } from '../utils/serializers';
import { sha256 } from '../utils/tokens';
import { AnswerIn } from '../validators/attempts';
import { gradeAttempt, round2 } from './grading.service';
import { notifyUser } from './notification.service';

const SAVE_GRACE_MS = 15_000; // autosave accepted slightly after the deadline (clock/latency slack)
const SUBMIT_GRACE_MS = 30_000; // final submit payload accepted; after this only saved answers count

type ExamFull = ExamLean & { questions: StoredQuestion[] };
const lean = <T>(v: unknown) => v as T;
const fail = (status: number, code: string, msg: string) => new AppError(status, msg, code);

async function loadExam(id: unknown): Promise<ExamFull | null> {
  return lean<ExamFull | null>(await Exam.findById(id).select('+questions').lean());
}

// ---------- access validation (the only way into an exam) ----------
async function resolveAccess(rawToken: string, user: AuthUser) {
  const access = lean<ExamAccessLean | null>(await ExamAccess.findOne({ tokenHash: sha256(rawToken) }).lean());
  if (!access) throw fail(404, 'LINK_INVALID', 'This exam link is not valid.');
  // The token only identifies the access. The logged-in student must own it.
  if (String(access.studentId) !== user.id) throw fail(403, 'NOT_YOUR_EXAM', 'This exam was not assigned to your account.');
  if (access.status === 'revoked') throw fail(410, 'LINK_REVOKED', 'This exam link has been withdrawn by your teacher.');

  await finalizeOverdue(access._id);

  const now = new Date();
  if (access.expiresAt && access.expiresAt <= now) throw fail(410, 'LINK_EXPIRED', 'This exam link has expired.');
  const exam = await loadExam(access.examId);
  if (!exam || exam.status !== 'published') throw fail(410, 'EXAM_UNAVAILABLE', 'This exam is no longer available.');
  if (exam.startDate && exam.startDate > now) throw fail(403, 'EXAM_NOT_OPEN', `This exam opens on ${exam.startDate.toISOString()}.`);
  if (exam.expiresAt && exam.expiresAt <= now) throw fail(410, 'EXAM_EXPIRED', 'This exam is closed.');

  const [used, open] = await Promise.all([
    ExamAttempt.countDocuments({ accessId: access._id, status: { $ne: 'voided' } }),
    ExamAttempt.findOne({ accessId: access._id, status: 'in_progress' }).lean(),
  ]);
  return { access, exam, used, open: lean<AttemptLean | null>(open) };
}

export async function accessInfo(rawToken: string, user: AuthUser) {
  const { access, exam, used, open } = await resolveAccess(rawToken, user);
  const canStart = !!open || used < access.maxAttempts;
  const last = canStart ? null : await ExamAttempt.findOne({ accessId: access._id, status: { $ne: 'voided' } }).sort({ attemptNumber: -1 }).select('_id').lean();
  return {
    exam: {
      title: exam.title, description: exam.description ?? null, instructions: exam.instructions ?? null,
      durationMinutes: exam.durationMinutes ?? null, passingScore: exam.passingScore,
      questionCount: exam.questions.length, totalPoints: round2(exam.questions.reduce((s, q) => s + q.points, 0)),
    },
    attemptsUsed: used, maxAttempts: access.maxAttempts,
    inProgressAttemptId: open ? String(open._id) : null,
    canStart, reason: canStart ? null : 'NO_ATTEMPTS_LEFT', lastAttemptId: last ? String(last._id) : null,
  };
}

export function computeDeadline(startedAt: Date, exam: ExamLean, access: ExamAccessLean) {
  const c: number[] = [];
  if (exam.durationMinutes) c.push(startedAt.getTime() + exam.durationMinutes * 60_000);
  if (access.expiresAt) c.push(access.expiresAt.getTime());
  if (exam.expiresAt) c.push(exam.expiresAt.getTime());
  return c.length ? new Date(Math.min(...c)) : null;
}

/** What the runner needs. Questions go through toStudentQuestion: never any answers. */
export function runnerPayload(attempt: AttemptLean, exam: ExamFull) {
  const byId = new Map(exam.questions.map((s) => [String(s.questionId), s]));
  const questions = attempt.layout.flatMap((l) => {
    const q = byId.get(String(l.questionId));
    if (!q) return [];
    const text = new Map(q.options.map((o) => [o.id, o.text]));
    return [{ ...toStudentQuestion(q), options: l.optionOrder.map((id) => ({ id, text: text.get(id) ?? '' })) }];
  });
  return {
    attemptId: String(attempt._id), examTitle: exam.title, durationMinutes: exam.durationMinutes ?? null,
    startedAt: attempt.startedAt, deadline: attempt.deadline ?? null, serverNow: new Date(), questions,
    answers: Object.fromEntries(attempt.answers.map((a) => [String(a.questionId), a.response ?? null])),
  };
}

export async function startAttempt(rawToken: string, user: AuthUser) {
  const { access, exam, used, open } = await resolveAccess(rawToken, user);
  if (open) return runnerPayload(open, exam); // resume
  if (used >= access.maxAttempts) throw fail(409, 'NO_ATTEMPTS_LEFT', 'You have used all your attempts for this exam.');
  if (exam.questions.length === 0) throw fail(409, 'EXAM_UNAVAILABLE', 'This exam has no questions.');

  const startedAt = new Date();
  const qIds = exam.questions.map((s) => s.questionId);
  const order = exam.settings.shuffleQuestions ? shuffle(qIds) : qIds;
  const byId = new Map(exam.questions.map((s) => [String(s.questionId), s]));
  const layout = order.map((id) => {
    const ids = byId.get(String(id))!.options.map((o) => o.id);
    const q = byId.get(String(id))!;
    return { questionId: id, optionOrder: exam.settings.shuffleOptions && q.type !== 'true_false' ? shuffle(ids) : ids };
  });

  try {
    const doc = await ExamAttempt.create({
      accessId: access._id, teacherId: access.teacherId, studentId: user.id, examId: exam._id, attemptNumber: used + 1,
      startedAt, deadline: computeDeadline(startedAt, exam, access), layout,
      maxScore: round2(exam.questions.reduce((s, q) => s + q.points, 0)),
    });
    return runnerPayload(lean<AttemptLean>(doc.toObject()), exam);
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    // Lost a race against another tab: return the winner's attempt, never a second one.
    const winner = lean<AttemptLean | null>(await ExamAttempt.findOne({ accessId: access._id, status: 'in_progress' }).lean());
    if (winner) return runnerPayload(winner, exam);
    throw conflict('Could not start the attempt. Please try again.');
  }
}

async function ownAttempt(id: string, userId: string) {
  const a = lean<AttemptLean | null>(await ExamAttempt.findOne({ _id: id, studentId: userId }).lean());
  if (!a) throw notFound('Attempt not found');
  return a;
}

const isOverdue = (a: AttemptLean, grace: number) => !!a.deadline && Date.now() > a.deadline.getTime() + grace;

export async function getRunner(id: string, user: AuthUser) {
  let attempt = await ownAttempt(id, user.id);
  const exam = await loadExam(attempt.examId);
  if (!exam) throw notFound('Exam not found');
  if (attempt.status === 'in_progress' && isOverdue(attempt, SUBMIT_GRACE_MS)) {
    await finalize(attempt, exam, attempt.answers);
    attempt = await ownAttempt(id, user.id);
  }
  if (attempt.status !== 'in_progress') throw fail(409, 'ATTEMPT_CLOSED', 'This attempt has already been submitted.');
  return runnerPayload(attempt, exam);
}

function mergeAnswers(existing: AttemptAnswer[], incoming: AnswerIn[], attempt: AttemptLean, exam: ExamFull) {
  const allowed = new Set(attempt.layout.map((l) => String(l.questionId)));
  const qById = new Map(exam.questions.map((s) => [String(s.questionId), s]));
  const map = new Map(existing.map((a) => [String(a.questionId), a]));
  const now = new Date();
  for (const inc of incoming) {
    const q = qById.get(inc.questionId);
    if (!allowed.has(inc.questionId) || !q) throw badRequest('Answer for a question that is not part of this attempt');
    const prev = map.get(inc.questionId);
    map.set(inc.questionId, {
      questionId: q.questionId, response: cleanResponse(q, inc.response),
      timeSpentSec: inc.timeSpentSec ?? prev?.timeSpentSec ?? 0, savedAt: now,
    });
  }
  return [...map.values()];
}

async function assertAccessLive(attempt: AttemptLean) {
  const a = await ExamAccess.findById(attempt.accessId).select('status').lean();
  if (!a || a.status === 'revoked') {
    await ExamAttempt.updateOne({ _id: attempt._id, status: 'in_progress' }, { status: 'voided' });
    throw fail(403, 'LINK_REVOKED', 'This exam has been withdrawn by your teacher.');
  }
}

export async function autosave(id: string, user: AuthUser, answers: AnswerIn[]) {
  const attempt = await ownAttempt(id, user.id);
  if (attempt.status !== 'in_progress') throw fail(409, 'ATTEMPT_CLOSED', 'This attempt has already been submitted.');
  if (isOverdue(attempt, SAVE_GRACE_MS)) throw fail(409, 'TIME_UP', 'Time is up. Submit your exam.');
  await assertAccessLive(attempt);
  const exam = await loadExam(attempt.examId);
  if (!exam) throw notFound('Exam not found');
  const merged = mergeAnswers(attempt.answers, answers, attempt, exam);
  const r = await ExamAttempt.updateOne({ _id: id, status: 'in_progress' }, { $set: { answers: merged } });
  if (r.matchedCount === 0) throw fail(409, 'ATTEMPT_CLOSED', 'This attempt has already been submitted.');
  return { savedAt: new Date(), deadline: attempt.deadline ?? null };
}

export async function submit(id: string, user: AuthUser, answers?: AnswerIn[]) {
  const attempt = await ownAttempt(id, user.id);
  const exam = await loadExam(attempt.examId);
  if (!exam) throw notFound('Exam not found');
  if (attempt.status === 'in_progress') {
    await assertAccessLive(attempt);
    // After the grace window the client's final payload is ignored: only autosaved answers count.
    const usePayload = answers && !isOverdue(attempt, SUBMIT_GRACE_MS);
    const final = usePayload ? mergeAnswers(attempt.answers, answers, attempt, exam) : attempt.answers;
    await finalize(attempt, exam, final);
  } // already submitted (double click / retry): fall through, return the same outcome
  const done = await ownAttempt(id, user.id);
  return { attemptId: id, status: done.status, result: studentResult(done, exam) };
}

export async function getResult(id: string, user: AuthUser) {
  const attempt = await ownAttempt(id, user.id);
  if (attempt.status === 'in_progress') throw fail(409, 'ATTEMPT_OPEN', 'This attempt is still in progress.');
  const exam = await loadExam(attempt.examId);
  if (!exam) throw notFound('Exam not found');
  return { attemptId: id, status: attempt.status, result: studentResult(attempt, exam) };
}

/** Student-facing result. Hidden until the teacher/system releases it. */
export function studentResult(a: AttemptLean, exam: ExamFull) {
  if (a.status === 'voided') return { released: false, message: 'This attempt was cancelled.' };
  if (!a.releasedAt) {
    return {
      released: false,
      message: a.status === 'pending_review'
        ? 'Submitted. Your teacher still needs to review some answers.'
        : 'Submitted. Your teacher will release the results.',
    };
  }
  const byId = new Map(exam.questions.map((s) => [String(s.questionId), s]));
  const show = exam.settings.showCorrectAnswers;
  return {
    released: true, score: a.score, maxScore: a.maxScore, percentage: a.percentage, passed: a.passed,
    passingScore: exam.passingScore, timeTakenSec: a.timeTakenSec, submittedAt: a.submittedAt,
    questions: a.answers.flatMap((ans) => {
      const q = byId.get(String(ans.questionId));
      if (!q) return [];
      return [{
        questionId: String(q.questionId), type: q.type, text: q.text, image: q.image ?? null, options: q.options,
        response: ans.response, isCorrect: ans.isCorrect, pointsAwarded: ans.pointsAwarded, maxPoints: ans.maxPoints,
        feedback: ans.feedback ?? null,
        ...(show ? { correctOptionIds: q.correctOptionIds, acceptedAnswers: q.acceptedAnswers, explanation: q.explanation ?? null } : {}),
      }];
    }),
  };
}

// ---------- grading + atomic close ----------
async function finalize(attempt: AttemptLean, exam: ExamFull, answers: AttemptAnswer[]) {
  const g = gradeAttempt(exam.questions, attempt.layout.map((l) => l.questionId), new Map(answers.map((a) => [String(a.questionId), a])), exam.subject);
  const now = new Date();
  const pending = g.needsReview;
  const percentage = g.maxScore > 0 ? round2((g.score / g.maxScore) * 100) : 0;
  const end = attempt.deadline && attempt.deadline < now ? attempt.deadline : now;
  const set: Record<string, unknown> = {
    status: pending ? 'pending_review' : 'graded', answers: g.answers, score: g.score, maxScore: g.maxScore,
    submittedAt: now, timeTakenSec: Math.max(0, Math.round((end.getTime() - attempt.startedAt.getTime()) / 1000)),
  };
  if (!pending) {
    Object.assign(set, { percentage, passed: percentage >= exam.passingScore, gradedAt: now });
    if (exam.settings.resultRelease === 'instant') set.releasedAt = now;
  }

  // Compare-and-set: only one concurrent submit can win; the loser is a harmless no-op.
  const won = await ExamAttempt.findOneAndUpdate({ _id: attempt._id, status: 'in_progress' }, { $set: set }, { new: true }).lean();
  if (!won) return false;

  const used = await ExamAttempt.countDocuments({ accessId: attempt.accessId, status: { $ne: 'voided' } });
  const asg = await ExamAccess.findById(attempt.accessId).select('maxAttempts').lean();
  if (asg && used >= asg.maxAttempts) await ExamAccess.updateOne({ _id: asg._id, status: 'active' }, { status: 'completed' });

  const student = await User.findById(attempt.studentId).select('name').lean();
  const who = student?.name ?? 'A student';
  await notifyUser(attempt.teacherId, 'attempt_completed', `${who} completed "${exam.title}"`, pending ? 'Some answers need manual grading.' : `Score: ${percentage}%`, { type: 'ExamAttempt', id: attempt._id });
  if (pending) await notifyUser(attempt.teacherId, 'manual_grading', `Grading needed: ${exam.title}`, `${who}'s attempt has answers waiting for review.`, { type: 'ExamAttempt', id: attempt._id });
  return true;
}

/** Closes attempts whose time ran out without a submit (student closed the tab). Run lazily and by cron (step 4). */
export async function finalizeOverdue(accessId?: unknown) {
  const filter: Record<string, unknown> = { status: 'in_progress', deadline: { $lt: new Date(Date.now() - SUBMIT_GRACE_MS) } };
  if (accessId) filter.accessId = accessId;
  const overdue = lean<AttemptLean[]>(await ExamAttempt.find(filter).limit(200).lean());
  for (const a of overdue) {
    const exam = await loadExam(a.examId);
    if (exam) await finalize(a, exam, a.answers);
  }
  return overdue.length;
}
