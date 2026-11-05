import { env } from '../config/env';
import { Exam } from '../models/Exam';
import { ExamAccess } from '../models/ExamAccess';
import { ExamAttempt } from '../models/ExamAttempt';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { ExamAccessLean } from '../types/attempt';
import { decrypt, encrypt } from '../utils/crypto';
import { conflict, notFound } from '../utils/errors';
import { generateToken } from '../utils/tokens';
import { CreateAccessInput, ListAccessQuery } from '../validators/examAccess';

const lean = <T>(v: unknown) => v as T;
type Stats = { attemptsUsed: number; bestPercentage: number | null };

function view(a: ExamAccessLean, student?: { id: string; name: string; email: string }, exam?: { id: string; title: string }, stats?: Stats) {
  return {
    id: String(a._id), status: a.status, maxAttempts: a.maxAttempts, expiresAt: a.expiresAt ?? null, revokedAt: a.revokedAt ?? null, createdAt: a.createdAt,
    student: student ?? { id: String(a.studentId) }, exam: exam ?? { id: String(a.examId) }, attemptsUsed: stats?.attemptsUsed ?? 0, bestPercentage: stats?.bestPercentage ?? null,
  };
}
async function owned(tid: string, id: string) {
  const a = lean<ExamAccessLean | null>(await ExamAccess.findOne({ _id: id, teacherId: tid }).lean());
  if (!a) throw notFound('Exam access not found');
  return a;
}

/** Gives specific students a personal QR link to one published exam. Both the exam and every student must belong to the caller. */
export async function createAccess(tid: string, input: CreateAccessInput) {
  const exam = await Exam.findOne({ _id: input.examId, teacherId: tid }).lean();
  if (!exam) throw notFound('Exam not found');
  if (exam.status !== 'published') throw conflict('Only published exams can be shared with students');

  const [profiles, live] = await Promise.all([
    StudentProfile.find({ userId: { $in: input.studentIds }, teacherId: tid }).select('userId status').lean(),
    ExamAccess.find({ examId: input.examId, studentId: { $in: input.studentIds }, revokedAt: { $exists: false } }).select('studentId').lean(),
  ]);
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) }, role: 'student' }).select('name email').lean();
  const found = new Map(users.map((s) => [String(s._id), s]));
  const disabled = new Set(profiles.filter((p) => p.status === 'disabled').map((p) => String(p.userId)));
  const already = new Set(live.map((a) => String(a.studentId)));

  const created = [];
  const skipped: { studentId: string; reason: string }[] = [];
  for (const sid of input.studentIds) {
    const s = found.get(sid);
    if (!s) { skipped.push({ studentId: sid, reason: 'Student not found' }); continue; } // also covers other teachers' students
    if (disabled.has(sid)) { skipped.push({ studentId: sid, reason: 'Student is disabled' }); continue; }
    if (already.has(sid)) { skipped.push({ studentId: sid, reason: 'Already has access' }); continue; }
    const { raw, hash } = generateToken();
    try {
      const a = await ExamAccess.create({
        examId: exam._id, studentId: s._id, teacherId: tid, tokenHash: hash, tokenEnc: encrypt(raw),
        expiresAt: input.expiresAt ?? null, maxAttempts: input.maxAttempts ?? exam.maxAttempts,
      });
      created.push(view(lean<ExamAccessLean>(a.toObject()), { id: String(s._id), name: s.name, email: s.email }, { id: String(exam._id), title: exam.title }));
    } catch (e) {
      if ((e as { code?: number }).code === 11000) skipped.push({ studentId: sid, reason: 'Already has access' });
      else throw e;
    }
  }
  return { created, skipped };
}

export async function listAccess(tid: string, q: ListAccessQuery) {
  const filter: Record<string, unknown> = { teacherId: tid };
  if (q.examId) filter.examId = q.examId;
  if (q.studentId) filter.studentId = q.studentId;
  if (q.status) filter.status = q.status;
  if (q.ids) filter._id = { $in: q.ids.split(',') };
  const [docs, total] = await Promise.all([
    ExamAccess.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    ExamAccess.countDocuments(filter),
  ]);
  const items = lean<ExamAccessLean[]>(docs);
  const [users, exams, attempts] = await Promise.all([
    User.find({ _id: { $in: items.map((a) => a.studentId) } }).select('name email').lean(),
    Exam.find({ _id: { $in: items.map((a) => a.examId) } }).select('title').lean(),
    ExamAttempt.find({ accessId: { $in: items.map((a) => a._id) }, status: { $ne: 'voided' } }).select('accessId percentage').lean(),
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name, email: u.email }]));
  const eMap = new Map(exams.map((e) => [String(e._id), { id: String(e._id), title: e.title }]));
  const sMap = new Map<string, Stats>();
  for (const t of attempts) {
    const s = sMap.get(String(t.accessId)) ?? { attemptsUsed: 0, bestPercentage: null };
    s.attemptsUsed++;
    if (t.percentage != null && (s.bestPercentage == null || t.percentage > s.bestPercentage)) s.bestPercentage = t.percentage;
    sMap.set(String(t.accessId), s);
  }
  return { items: items.map((a) => view(a, uMap.get(String(a.studentId)), eMap.get(String(a.examId)), sMap.get(String(a._id)))), page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

export async function getAccess(tid: string, id: string) {
  const a = await owned(tid, id);
  const [student, exam, attempts] = await Promise.all([
    User.findById(a.studentId).select('name email').lean(), Exam.findById(a.examId).select('title').lean(),
    ExamAttempt.find({ accessId: a._id }).sort({ attemptNumber: 1 }).select('attemptNumber status percentage score maxScore startedAt submittedAt timeTakenSec').lean(),
  ]);
  const real = attempts.filter((t) => t.status !== 'voided');
  return {
    ...view(a, student ? { id: String(student._id), name: student.name, email: student.email } : undefined, exam ? { id: String(exam._id), title: exam.title } : undefined,
      { attemptsUsed: real.length, bestPercentage: real.reduce<number | null>((m, t) => (t.percentage != null && (m == null || t.percentage > m) ? t.percentage : m), null) }),
    attempts: attempts.map((t) => ({ id: String(t._id), ...t, _id: undefined })),
  };
}

/** Revoking ends the link at once and voids any attempt still open. */
export async function revokeAccess(tid: string, id: string) {
  const a = await owned(tid, id); // 404 if it is not yours
  if (a.status === 'revoked') throw conflict('Already revoked');
  await ExamAccess.updateOne({ _id: id, teacherId: tid }, { status: 'revoked', revokedAt: new Date() });
  await ExamAttempt.updateMany({ accessId: a._id, status: 'in_progress' }, { status: 'voided' });
  return getAccess(tid, id);
}

export async function regenerateQr(tid: string, id: string) {
  const { raw, hash } = generateToken();
  const a = await owned(tid, id);
  if (a.status !== 'active') throw conflict('Only active exam access can have its QR regenerated');
  const r = await ExamAccess.updateOne({ _id: id, teacherId: tid, status: 'active' }, { tokenHash: hash, tokenEnc: encrypt(raw) });
  if (!r.matchedCount) throw conflict('Only active exam access can have its QR regenerated');
  return getAccess(tid, id);
}

export async function getAccessUrl(tid: string, id: string) {
  const a = await ExamAccess.findOne({ _id: id, teacherId: tid }).select('+tokenEnc status').lean();
  if (!a) throw notFound('Exam access not found');
  if (a.status === 'revoked') throw conflict('This exam access has been revoked');
  return `${env.CLIENT_URL}/exam/access/${decrypt(a.tokenEnc)}`;
}
