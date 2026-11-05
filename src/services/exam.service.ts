import { Types } from 'mongoose';
import { Exam } from '../models/Exam';
import { ExamAccess } from '../models/ExamAccess';
import { ExamAttempt } from '../models/ExamAttempt';
import { ExamLean, StoredQuestion } from '../types/exam';
import { badRequest, conflict, notFound } from '../utils/errors';
import { toStored, totalPoints } from '../utils/questions';
import { escapeRegex } from '../utils/regex';
import { adminQuestionView, examSummary } from '../utils/serializers';
import { ExamFields, ListExamsQuery } from '../validators/exams';
import { getSettings } from './settings.service';

const LOCKED_AFTER_PUBLISH = ['durationMinutes', 'passingScore', 'maxAttempts', 'settings', 'questions', 'subject'] as const;
const SIMPLE_FIELDS = ['title', 'subject', 'description', 'instructions', 'durationMinutes', 'passingScore', 'maxAttempts', 'startDate', 'expiresAt'] as const;
const lean = <T>(v: unknown) => v as T;

/** All access goes through here: an exam id belonging to another teacher is simply "not found". */
async function loadExam(tid: string, id: string) {
  const exam = await Exam.findOne({ _id: id, teacherId: tid });
  if (!exam) throw notFound('Exam not found');
  return exam;
}

export async function createExam(tid: string, input: ExamFields & { title: string }) {
  const defaults = await getSettings();
  const { questions, ...rest } = input;
  const stored = questions ? toStored(questions) : [];
  const exam = await Exam.create({
    passingScore: defaults.defaultPassingScore, maxAttempts: defaults.defaultMaxAttempts, ...rest,
    questions: stored, questionCount: stored.length, totalPoints: totalPoints(stored), teacherId: tid,
  });
  return getExamDetail(tid, exam.id);
}

export async function listExams(tid: string, q: ListExamsQuery) {
  const now = new Date();
  const filter: Record<string, unknown> = { teacherId: tid };
  if (q.search) filter.title = new RegExp(escapeRegex(q.search), 'i');
  switch (q.status) {
    case 'draft': case 'archived': case 'published': filter.status = q.status; break;
    case 'scheduled': filter.status = 'published'; filter.startDate = { $gt: now }; break;
    case 'expired': filter.status = 'published'; filter.expiresAt = { $lte: now }; break;
    case 'active':
      filter.status = 'published';
      filter.$and = [{ $or: [{ startDate: null }, { startDate: { $lte: now } }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }];
      break;
  }
  const [docs, total] = await Promise.all([
    Exam.find(filter).sort({ updatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), // questions are not loaded for lists
    Exam.countDocuments(filter),
  ]);
  return { items: lean<ExamLean[]>(docs).map(examSummary), page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

export async function getExamDetail(tid: string, id: string) {
  const doc = await Exam.findOne({ _id: id, teacherId: tid }).select('+questions').lean();
  if (!doc) throw notFound('Exam not found');
  const exam = lean<ExamLean & { questions: StoredQuestion[] }>(doc);
  return { ...examSummary(exam), questions: exam.questions.map(adminQuestionView) };
}

/** One request saves settings AND questions, so the editor never sees a half-saved intermediate state. */
export async function updateExam(tid: string, id: string, input: ExamFields) {
  const exam = await loadExam(tid, id);
  if (exam.status === 'archived') throw conflict('Archived exams cannot be edited');
  if (exam.status === 'published') {
    const locked = LOCKED_AFTER_PUBLISH.filter((k) => input[k] !== undefined);
    if (locked.length) throw conflict(`Cannot change ${locked.join(', ')} after publishing. Duplicate the exam instead.`);
  }
  for (const k of SIMPLE_FIELDS) if (input[k] !== undefined) exam.set(k, input[k]);
  if (input.settings) for (const [k, v] of Object.entries(input.settings)) exam.set(`settings.${k}`, v);
  if (input.questions) {
    const cur = await Exam.findOne({ _id: id, teacherId: tid }).select('+questions').lean();
    const known = new Set(((cur as unknown as { questions?: StoredQuestion[] })?.questions ?? []).map((q) => String(q.questionId)));
    const stored = toStored(input.questions, known);
    exam.set('questions', stored); exam.set('questionCount', stored.length); exam.set('totalPoints', totalPoints(stored));
  }
  if (exam.startDate && exam.expiresAt && exam.expiresAt <= exam.startDate) throw badRequest('Expiry must be after the start date');
  await exam.save();
  return getExamDetail(tid, id);
}

export async function publishExam(tid: string, id: string) {
  const exam = await loadExam(tid, id);
  if (exam.status !== 'draft') throw conflict('Only draft exams can be published');
  if (exam.questionCount === 0) throw badRequest('Add at least one question before publishing');
  if (exam.expiresAt && exam.expiresAt <= new Date()) throw badRequest('The expiry date is in the past');
  // Atomic guard: two simultaneous publish clicks cannot both succeed. From now on the questions are locked.
  const done = await Exam.updateOne({ _id: id, teacherId: tid, status: 'draft' }, { status: 'published', publishedAt: new Date() });
  if (!done.matchedCount) throw conflict('Exam was already published');
  return getExamDetail(tid, id);
}

export async function archiveExam(tid: string, id: string) {
  const exam = await loadExam(tid, id); // 404 if it is not yours
  if (exam.status === 'archived') throw conflict('Exam is already archived');
  await Exam.updateOne({ _id: id, teacherId: tid }, { status: 'archived' });
  const live = await ExamAccess.find({ examId: id, teacherId: tid, status: { $ne: 'revoked' } }).select('_id').lean();
  await ExamAccess.updateMany({ _id: { $in: live.map((a) => a._id) } }, { status: 'revoked', revokedAt: new Date() });
  await ExamAttempt.updateMany({ accessId: { $in: live.map((a) => a._id) }, status: 'in_progress' }, { status: 'voided' });
  return getExamDetail(tid, id);
}

export async function duplicateExam(tid: string, id: string) {
  const src = await Exam.findOne({ _id: id, teacherId: tid }).select('+questions');
  if (!src) throw notFound('Exam not found');
  const questions = (src.questions as unknown as StoredQuestion[]).map((q) => ({ ...(q as unknown as { toObject?: () => StoredQuestion }).toObject?.() ?? q, questionId: new Types.ObjectId() }));
  const copy = await Exam.create({
    title: `${src.title} (copy)`, subject: src.subject, description: src.description, instructions: src.instructions, durationMinutes: src.durationMinutes,
    passingScore: src.passingScore, maxAttempts: src.maxAttempts, settings: src.settings, questions, questionCount: src.questionCount, totalPoints: src.totalPoints, teacherId: tid,
  });
  return getExamDetail(tid, copy.id);
}

/** Deleting is only allowed while no student has ever attempted the exam; otherwise archive it to keep results. */
export async function deleteExam(tid: string, id: string) {
  await loadExam(tid, id);
  if (await ExamAttempt.exists({ examId: id })) throw conflict('Students have already taken this exam. Archive it instead of deleting it.');
  await ExamAccess.deleteMany({ examId: id, teacherId: tid });
  await Exam.deleteOne({ _id: id, teacherId: tid });
}
