import { Types } from 'mongoose';
import { Assignment } from '../models/Assignment';
import { AssignmentSubmission } from '../models/AssignmentSubmission';
import { SubmitClaim } from '../models/SubmitClaim';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { StoredQuestion } from '../types/exam';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';
import { toStored, totalPoints } from '../utils/questions';
import { escapeRegex } from '../utils/regex';
import { cleanResponse, Response } from '../utils/responses';
import { adminQuestionView, toStudentQuestion } from '../utils/serializers';
import { CreateAssignmentInput, ListAssignmentsQuery, UpdateAssignmentInput } from '../validators/assignments';
import { gradeAnswer, round2 } from './grading.service';
import { notifyUser } from './notification.service';

// Homework Assignments. Nothing here touches exams, QR codes or exam attempts. Questions are stored inside the assignment.
interface AssignmentDoc {
  _id: Types.ObjectId; teacherId: Types.ObjectId; title: string; subject: string; description?: string | null; instructions?: string | null; questions: StoredQuestion[]; questionCount: number; totalPoints: number;
  studentIds: Types.ObjectId[]; dueDate?: Date | null; allowLate: boolean; status: 'draft' | 'published' | 'closed'; publishedAt?: Date | null; createdAt: Date; updatedAt: Date;
}
interface Grade { questionId: Types.ObjectId; points: number; isCorrect?: boolean | null; needsReview?: boolean; feedback?: string | null }
interface SubDoc {
  _id: Types.ObjectId; assignmentId: Types.ObjectId; studentId: Types.ObjectId; answers: { questionId: Types.ObjectId; response: Response }[]; status: 'draft' | 'submitted' | 'graded';
  submittedAt?: Date | null; late: boolean; grades: Grade[]; score?: number | null; maxScore?: number | null; feedback?: string | null; gradedAt?: Date | null;
}
const lean = <T>(v: unknown) => v as T;
const withQuestions = (q: ReturnType<typeof Assignment.findOne>) => q.select('+questions');

async function ownedAssignment(tid: string, id: string, questions = false) {
  const q = Assignment.findOne({ _id: id, teacherId: tid });
  const a = lean<AssignmentDoc | null>(await (questions ? withQuestions(q) : q).lean());
  if (!a) throw notFound('Assignment not found'); // other teachers' ids look the same as missing ones
  return a;
}
/** Recipients must be the caller's own students. Anything else is rejected without revealing whether the id exists. */
async function assertOwnStudents(tid: string, ids: string[]) {
  if (!ids.length) return;
  if ((await StudentProfile.countDocuments({ userId: { $in: ids }, teacherId: tid })) !== new Set(ids).size) throw badRequest('One or more students were not found');
}

const view = (a: AssignmentDoc, counts?: { submitted: number; graded: number }) => ({
  id: String(a._id), title: a.title, subject: a.subject, description: a.description ?? null, instructions: a.instructions ?? null, status: a.status, dueDate: a.dueDate ?? null, allowLate: a.allowLate,
  questionCount: a.questionCount ?? 0, totalPoints: a.totalPoints ?? 0, recipientCount: a.studentIds.length, submittedCount: counts?.submitted ?? 0, gradedCount: counts?.graded ?? 0,
  publishedAt: a.publishedAt ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt,
});
async function countsFor(ids: Types.ObjectId[]) {
  const subs = lean<Pick<SubDoc, 'assignmentId' | 'status'>[]>(await AssignmentSubmission.find({ assignmentId: { $in: ids }, status: { $ne: 'draft' } }).select('assignmentId status').lean());
  const m = new Map<string, { submitted: number; graded: number }>();
  for (const s of subs) { const c = m.get(String(s.assignmentId)) ?? { submitted: 0, graded: 0 }; c.submitted++; if (s.status === 'graded') c.graded++; m.set(String(s.assignmentId), c); }
  return m;
}

// ---------------- teacher ----------------
export async function createAssignment(tid: string, input: CreateAssignmentInput) {
  const studentIds = input.studentIds ?? [];
  await assertOwnStudents(tid, studentIds);
  if (input.publish && !studentIds.length) throw badRequest('Choose at least one student before publishing');
  if (input.dueDate && input.dueDate <= new Date()) throw badRequest('The due date must be in the future');
  const questions = toStored(input.questions);
  const a = await Assignment.create({
    teacherId: tid, title: input.title, subject: input.subject, description: input.description, instructions: input.instructions, questions, questionCount: questions.length, totalPoints: totalPoints(questions),
    studentIds, dueDate: input.dueDate ?? null, allowLate: input.allowLate ?? false, ...(input.publish ? { status: 'published', publishedAt: new Date() } : {}),
  });
  return getAssignment(tid, a.id);
}

export async function listAssignments(tid: string, q: ListAssignmentsQuery) {
  const filter: Record<string, unknown> = { teacherId: tid, ...(q.status ? { status: q.status } : {}), ...(q.search ? { title: new RegExp(escapeRegex(q.search), 'i') } : {}) };
  const [docs, total] = await Promise.all([Assignment.find(filter).sort({ updatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), Assignment.countDocuments(filter)]);
  const items = lean<AssignmentDoc[]>(docs);
  const counts = await countsFor(items.map((a) => a._id));
  return { items: items.map((a) => view(a, counts.get(String(a._id)))), page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

export async function getAssignment(tid: string, id: string) {
  const a = await ownedAssignment(tid, id, true);
  const [users, counts] = await Promise.all([User.find({ _id: { $in: a.studentIds } }).select('name email').lean(), countsFor([a._id])]);
  return { ...view(a, counts.get(String(a._id))), questions: a.questions.map(adminQuestionView), students: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email })) };
}

export async function updateAssignment(tid: string, id: string, input: UpdateAssignmentInput) {
  const a = await ownedAssignment(tid, id);
  if (a.status === 'closed') throw conflict('This assignment is closed. Reopen it by publishing again to edit it.');
  const hasSubs = !!(await AssignmentSubmission.exists({ assignmentId: id, status: { $ne: 'draft' } }));
  if ((input.questions || input.subject) && hasSubs) throw conflict('Questions cannot change after students have submitted.');
  const set: Record<string, unknown> = {};
  for (const k of ['title', 'subject', 'description', 'instructions', 'allowLate'] as const) if (input[k] !== undefined) set[k] = input[k];
  if (input.dueDate !== undefined) { if (input.dueDate && input.dueDate <= new Date()) throw badRequest('The due date must be in the future'); set.dueDate = input.dueDate; }
  if (input.questions) { const qs = toStored(input.questions, new Set((await ownedAssignment(tid, id, true)).questions.map((q) => String(q.questionId)))); set.questions = qs; set.questionCount = qs.length; set.totalPoints = totalPoints(qs); }
  if (input.studentIds) {
    await assertOwnStudents(tid, input.studentIds);
    const keep = new Set(input.studentIds);
    const withWork = await AssignmentSubmission.find({ assignmentId: id }).select('studentId').lean();
    if (withWork.some((s) => !keep.has(String(s.studentId)))) throw conflict('You cannot remove a student who already has work on this assignment.');
    set.studentIds = input.studentIds;
  }
  await Assignment.updateOne({ _id: id, teacherId: tid }, { $set: set });
  return getAssignment(tid, id);
}

export async function publishAssignment(tid: string, id: string) {
  const a = await ownedAssignment(tid, id);
  if (a.status === 'published') throw conflict('Already published');
  if (!a.studentIds.length) throw badRequest('Choose at least one student before publishing');
  await Assignment.updateOne({ _id: id, teacherId: tid }, { status: 'published', publishedAt: a.publishedAt ?? new Date() });
  return getAssignment(tid, id);
}
export async function closeAssignment(tid: string, id: string) {
  const a = await ownedAssignment(tid, id);
  if (a.status !== 'published') throw conflict('Only published assignments can be closed');
  await Assignment.updateOne({ _id: id, teacherId: tid, status: 'published' }, { status: 'closed' });
  return getAssignment(tid, id);
}
/** Deleting removes the assignment and every student's submission for it (all owned by this teacher). */
export async function deleteAssignment(tid: string, id: string) {
  await ownedAssignment(tid, id);
  await AssignmentSubmission.deleteMany({ assignmentId: id, teacherId: tid });
  await SubmitClaim.deleteMany({ assignmentId: id });
  await Assignment.deleteOne({ _id: id, teacherId: tid });
}

export async function listSubmissions(tid: string, id: string) {
  const a = await ownedAssignment(tid, id);
  const [users, subs] = await Promise.all([User.find({ _id: { $in: a.studentIds } }).select('name email').sort({ name: 1 }).lean(), lean<SubDoc[]>(await AssignmentSubmission.find({ assignmentId: id }).lean())]);
  const byStudent = new Map(subs.map((s) => [String(s.studentId), s]));
  return {
    assignment: { id: String(a._id), title: a.title, totalPoints: a.totalPoints, dueDate: a.dueDate ?? null },
    items: users.map((u) => { const s = byStudent.get(String(u._id)); return { student: { id: String(u._id), name: u.name, email: u.email },
      submission: s && s.status !== 'draft' ? { id: String(s._id), status: s.status, submittedAt: s.submittedAt ?? null, late: s.late, score: s.score ?? null, maxScore: s.maxScore ?? null } : null }; }),
  };
}

export async function getSubmission(tid: string, id: string, sid: string) {
  const a = await ownedAssignment(tid, id, true);
  const s = lean<SubDoc | null>(await AssignmentSubmission.findOne({ _id: sid, assignmentId: id, teacherId: tid, status: { $ne: 'draft' } }).lean());
  if (!s) throw notFound('Submission not found');
  const student = await User.findById(s.studentId).select('name email').lean();
  const ans = new Map((s.answers ?? []).map((x) => [String(x.questionId), x.response])); const gr = new Map((s.grades ?? []).map((g) => [String(g.questionId), g]));
  return {
    id: String(s._id), status: s.status, submittedAt: s.submittedAt, late: s.late, score: s.score ?? null, maxScore: s.maxScore ?? a.totalPoints, feedback: s.feedback ?? null,
    student: student ? { id: String(student._id), name: student.name, email: student.email } : null, assignment: { id: String(a._id), title: a.title },
    questions: a.questions.map((q) => { const g = gr.get(String(q.questionId)); return { ...adminQuestionView(q), response: ans.get(String(q.questionId)) ?? null, pointsAwarded: g?.points ?? null, isCorrect: g?.isCorrect ?? null, needsReview: !!g?.needsReview, feedback: g?.feedback ?? null }; }),
  };
}

export async function gradeSubmission(tid: string, id: string, sid: string, input: { grades: { questionId: string; points: number; feedback?: string }[]; feedback?: string }) {
  const a = await ownedAssignment(tid, id, true);
  const s = lean<SubDoc | null>(await AssignmentSubmission.findOne({ _id: sid, assignmentId: id, teacherId: tid, status: { $in: ['submitted', 'graded'] } }).lean());
  if (!s) throw notFound('Submission not found');
  const qs = new Map(a.questions.map((q) => [String(q.questionId), q]));
  const grades = new Map((s.grades ?? []).map((g) => [String(g.questionId), g]));
  for (const g of input.grades) {
    const q = qs.get(g.questionId);
    if (!q) throw badRequest('A graded question is not part of this assignment');
    if (g.points > q.points) throw badRequest(`Points cannot exceed ${q.points} for a question`);
    grades.set(g.questionId, { questionId: q.questionId, points: g.points, isCorrect: g.points >= q.points ? true : g.points <= 0 ? false : null, needsReview: false, feedback: g.feedback ?? grades.get(g.questionId)?.feedback ?? null });
  }
  const done = a.questions.every((q) => grades.has(String(q.questionId)) && !grades.get(String(q.questionId))!.needsReview);
  const score = round2([...grades.values()].reduce((x, g) => x + g.points, 0));
  await AssignmentSubmission.updateOne({ _id: sid, teacherId: tid }, { $set: { grades: [...grades.values()], score, maxScore: a.totalPoints, feedback: input.feedback ?? s.feedback, ...(done ? { status: 'graded', gradedAt: new Date() } : { status: 'submitted' }) } });
  return getSubmission(tid, id, sid);
}

// ---------------- student ----------------
/** Students only ever reach assignments addressed to them and not in draft; everything else is "not found". */
async function visibleToStudent(studentId: string, id: string) {
  const a = lean<AssignmentDoc | null>(await withQuestions(Assignment.findOne({ _id: id, studentIds: studentId, status: { $in: ['published', 'closed'] } })).lean());
  if (!a) throw notFound('Assignment not found');
  return a;
}
/** Answers are visible to the student always; grades, correct answers and explanations only once grading is finished. */
function studentSubmission(s: SubDoc | null, a: AssignmentDoc) {
  if (!s) return null;
  const base = { status: s.status, answers: (s.answers ?? []).map((x) => ({ questionId: String(x.questionId), response: x.response })), submittedAt: s.submittedAt ?? null, late: s.late };
  if (s.status !== 'graded') return base;
  const gr = new Map((s.grades ?? []).map((g) => [String(g.questionId), g]));
  return { ...base, score: s.score ?? null, maxScore: s.maxScore ?? null, feedback: s.feedback ?? null,
    results: a.questions.map((q) => { const g = gr.get(String(q.questionId)); return { questionId: String(q.questionId), points: g?.points ?? 0, isCorrect: g?.isCorrect ?? null, feedback: g?.feedback ?? null, correctOptionIds: q.correctOptionIds, acceptedAnswers: q.acceptedAnswers, explanation: q.explanation ?? null }; }) };
}

export async function listMine(studentId: string) {
  const items = lean<AssignmentDoc[]>(await Assignment.find({ studentIds: studentId, status: { $in: ['published', 'closed'] } }).sort({ dueDate: 1, updatedAt: -1 }).limit(200).lean());
  const subs = lean<SubDoc[]>(await AssignmentSubmission.find({ studentId, assignmentId: { $in: items.map((a) => a._id) } }).lean());
  const byA = new Map(subs.map((s) => [String(s.assignmentId), s]));
  const now = new Date();
  return items.map((a) => { const s = byA.get(String(a._id)) ?? null; return {
    id: String(a._id), title: a.title, dueDate: a.dueDate ?? null, status: a.status, questionCount: a.questionCount ?? 0, totalPoints: a.totalPoints ?? 0,
    overdue: !!a.dueDate && a.dueDate < now && (!s || s.status === 'draft'),
    submission: s && { status: s.status, submittedAt: s.submittedAt ?? null, late: s.late, score: s.status === 'graded' ? s.score ?? null : null, maxScore: s.status === 'graded' ? s.maxScore ?? null : null },
  }; });
}
export async function getMine(studentId: string, id: string) {
  const a = await visibleToStudent(studentId, id);
  const s = lean<SubDoc | null>(await AssignmentSubmission.findOne({ assignmentId: id, studentId }).lean());
  return {
    id: String(a._id), title: a.title, description: a.description ?? null, instructions: a.instructions ?? null, dueDate: a.dueDate ?? null, allowLate: a.allowLate, status: a.status,
    questions: a.questions.map(toStudentQuestion), totalPoints: a.totalPoints, submission: studentSubmission(s, a),
  };
}

async function writable(studentId: string, id: string, answers: { questionId: string; response: unknown }[]) {
  const a = await visibleToStudent(studentId, id);
  if (a.status === 'closed') throw conflict('This assignment is closed.');
  const late = !!a.dueDate && a.dueDate < new Date();
  if (late && !a.allowLate) throw new AppError(409, 'The due date has passed.', 'DUE_PASSED');
  const qs = new Map(a.questions.map((q) => [String(q.questionId), q]));
  if (new Set(answers.map((x) => x.questionId)).size !== answers.length) throw badRequest('Answers do not match this assignment');
  const cleaned = answers.map((x) => { const q = qs.get(x.questionId); if (!q) throw badRequest('Answers do not match this assignment'); return { questionId: q.questionId, response: cleanResponse(q, x.response) }; });
  return { a, late, cleaned };
}
/** Draft/submit are atomic upserts filtered on status 'draft': submitted work can never be overwritten, even by two tabs at once. */
async function write(a: AssignmentDoc, studentId: string, set: Record<string, unknown>) {
  try {
    return await AssignmentSubmission.findOneAndUpdate({ assignmentId: a._id, studentId, status: 'draft' },
      { $set: { teacherId: a.teacherId, ...set }, $setOnInsert: Object.fromEntries(Object.entries({ grades: [], late: false }).filter(([k]) => !(k in set))) }, { upsert: true, new: true });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('You have already submitted this assignment.');
    throw e;
  }
}
export async function saveDraft(studentId: string, id: string, answers: { questionId: string; response: unknown }[]) {
  const { a, cleaned } = await writable(studentId, id, answers);
  await write(a, studentId, { answers: cleaned });
  return { savedAt: new Date() };
}
export async function submitMine(studentId: string, id: string, answers: { questionId: string; response: unknown }[]) {
  const { a, late, cleaned } = await writable(studentId, id, answers);
  if (!cleaned.some((x) => x.response != null && (typeof x.response !== 'string' || x.response.trim()))) throw badRequest('Answer at least one question before submitting');
  // Server-side grading, same rules as exams: choice and short-answer questions are scored now; essays wait for the teacher.
  const given = new Map(cleaned.map((x) => [String(x.questionId), x.response]));
  const grades: Grade[] = a.questions.map((q) => { const g = gradeAnswer(q, given.get(String(q.questionId)) ?? null); return { questionId: q.questionId, points: g.points, isCorrect: g.isCorrect, needsReview: g.needsReview }; });
  const review = grades.some((g) => g.needsReview);
  const score = round2(grades.reduce((x, g) => x + g.points, 0));
  // Claim first: the unique index lets exactly one of several simultaneous submits continue.
  try { await SubmitClaim.create({ assignmentId: a._id, studentId }); }
  catch (e) { if ((e as { code?: number }).code === 11000) throw conflict('You have already submitted this assignment.'); throw e; }
  try {
    await write(a, studentId, { answers: cleaned, status: review ? 'submitted' : 'graded', submittedAt: new Date(), late, grades, score, maxScore: a.totalPoints, ...(review ? {} : { gradedAt: new Date() }) });
  } catch (e) { await SubmitClaim.deleteOne({ assignmentId: a._id, studentId }); throw e; } // a failed write must not lock the student out
  const student = await User.findById(studentId).select('name').lean();
  await notifyUser(a.teacherId, 'assignment_submitted', `${student?.name ?? 'A student'} submitted "${a.title}"`, review ? 'Some answers need your grading.' : late ? 'Submitted late and already graded.' : 'Automatically graded.', { type: 'Assignment', id: a._id });
  return getMine(studentId, id);
}
